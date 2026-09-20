begin;
-- No business terms or associate agreements are seeded by this release.
create table public.workforce_pooled_policies (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),station_id uuid not null references public.stations(id),
 name text not null check(length(name) between 3 and 120),formula text not null check(formula in('guarantee_plus_excess','pooled_floor')),
 daily_guarantee numeric(12,2) not null check(daily_guarantee>0 and daily_guarantee<=1000000),packages_per_day integer not null check(packages_per_day between 0 and 100000),
 package_rate numeric(12,2) not null check(package_rate>=0 and package_rate<=1000000),effective_from date not null,effective_to date not null,
 policy_reference text not null check(length(policy_reference) between 3 and 1000),created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 check(effective_to>=effective_from and effective_to-effective_from<=365),check(formula<>'pooled_floor' or packages_per_day=0),
 exclude using gist(company_id with =,station_id with =,daterange(effective_from,effective_to,'[]') with &&)
);
create table public.workforce_pooled_agreements (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),station_id uuid not null references public.stations(id),
 workforce_id uuid not null references public.workforce(id),policy_id uuid not null references public.workforce_pooled_policies(id),
 window_start date not null,window_end date not null,accepted_on date not null,acceptance_reference text not null check(length(acceptance_reference) between 3 and 1000),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 check(window_end>=window_start and window_end-window_start<=92 and accepted_on<=window_start),
 exclude using gist(company_id with =,workforce_id with =,daterange(window_start,window_end,'[]') with &&)
);
create index workforce_pooled_agreement_station_idx on public.workforce_pooled_agreements(company_id,station_id,window_end);
create table public.workforce_pooled_settlements (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),agreement_id uuid not null references public.workforce_pooled_agreements(id),
 station_id uuid not null references public.stations(id),workforce_id uuid not null references public.workforce(id),adjustment_id uuid unique references public.workforce_adjustments(id),
 reference text not null check(length(reference) between 3 and 180),posting_date date not null,snapshot jsonb not null,
 supplemental_amount numeric(14,2) not null check(supplemental_amount>=0),status text not null default 'pending' check(status in('pending','approved','rejected')),
 requested_by uuid not null references auth.users(id),requested_at timestamptz not null default now(),reviewed_by uuid references auth.users(id),reviewed_at timestamptz,review_note text,
 unique(company_id,reference),
 check((supplemental_amount=0 and adjustment_id is null) or (supplemental_amount>0 and adjustment_id is not null)),
 check((status='pending' and reviewed_by is null and reviewed_at is null) or (status<>'pending' and reviewed_by is not null and reviewed_at is not null and reviewed_by<>requested_by and length(review_note) between 10 and 2000))
);
create unique index workforce_pooled_settlement_live_idx on public.workforce_pooled_settlements(agreement_id) where status<>'rejected';
create index workforce_pooled_settlement_scope_idx on public.workforce_pooled_settlements(company_id,station_id,requested_at desc);
alter table public.workforce_pooled_policies enable row level security;
alter table public.workforce_pooled_agreements enable row level security;
alter table public.workforce_pooled_settlements enable row level security;
revoke all on public.workforce_pooled_policies,public.workforce_pooled_agreements,public.workforce_pooled_settlements from public,anon,authenticated,service_role;
grant select on public.workforce_pooled_policies,public.workforce_pooled_agreements,public.workforce_pooled_settlements to service_role;

create function public.workforce_pooled_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Pooled policies and accepted windows are immutable; create a non-overlapping version for new terms'; end $$;
create trigger workforce_pooled_policy_immutable before update or delete on public.workforce_pooled_policies for each row execute function public.workforce_pooled_immutable();
create trigger workforce_pooled_agreement_immutable before update or delete on public.workforce_pooled_agreements for each row execute function public.workforce_pooled_immutable();

create function public.workforce_create_pooled_policy(p_company uuid,p_actor uuid,p_station uuid,p_name text,p_formula text,p_guarantee numeric,p_packages integer,p_rate numeric,p_from date,p_to date,p_reference text,p_locations uuid[])
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if p_actor is null or p_station is null or (p_locations is not null and not(p_station=any(p_locations))) then raise exception 'An actor and station inside your scope are required'; end if;
 perform 1 from public.stations where id=p_station and company_id=p_company for update;if not found then raise exception 'Choose a company station'; end if;
 if p_guarantee is null or p_rate is null or p_guarantee::text in('NaN','Infinity','-Infinity') or p_rate::text in('NaN','Infinity','-Infinity') or round(p_guarantee,2)<>p_guarantee or round(p_rate,2)<>p_rate then raise exception 'Use finite approved amounts with at most two decimals'; end if;
 insert into public.workforce_pooled_policies(company_id,station_id,name,formula,daily_guarantee,packages_per_day,package_rate,effective_from,effective_to,policy_reference,created_by)
 values(p_company,p_station,btrim(p_name),p_formula,p_guarantee,p_packages,p_rate,p_from,p_to,btrim(p_reference),p_actor) returning id into result;
 return result;
end $$;

create function public.workforce_accept_pooled_window(p_company uuid,p_actor uuid,p_policy uuid,p_workforce uuid,p_from date,p_to date,p_accepted date,p_reference text,p_locations uuid[])
returns uuid language plpgsql security definer set search_path='' as $$
declare policy public.workforce_pooled_policies;w public.workforce;result uuid;
begin
 if p_actor is null then raise exception 'An actor is required'; end if;
 select * into policy from public.workforce_pooled_policies where company_id=p_company and id=p_policy;
 if not found or (p_locations is not null and not(policy.station_id=any(p_locations))) then raise exception 'Policy is outside your company or station scope'; end if;
 select * into w from public.workforce where id=p_workforce and company_id=p_company and deleted_at is null and migration_state<>'reclassified';
 if not found or w.location_id is distinct from policy.station_id or w.onboarding_status is distinct from 'active' then raise exception 'Select an approved canonical associate at this station'; end if;
 if not exists(select 1 from public.designations d join public.designation_categories c on c.id=d.designation_category_id where d.company_id=p_company and c.company_id=p_company and c.people_module='delivery_network' and d.id=w.designation_id) then raise exception 'A canonical Workforce designation is required'; end if;
 if p_from<policy.effective_from or p_to>policy.effective_to or p_accepted>(now() at time zone 'Asia/Kolkata')::date then raise exception 'The accepted window must fit the policy dates; consent cannot be dated in the future'; end if;
 insert into public.workforce_pooled_agreements(company_id,station_id,workforce_id,policy_id,window_start,window_end,accepted_on,acceptance_reference,created_by)
 values(p_company,policy.station_id,p_workforce,p_policy,p_from,p_to,p_accepted,btrim(p_reference),p_actor) returning id into result;
 return result;
end $$;

-- Read-only calculation over confirmed, immutable base payroll, never over browser-supplied totals.
create function public.workforce_calculate_pooled_window(p_company uuid,p_agreement uuid,p_locations uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.workforce_pooled_agreements;p public.workforce_pooled_policies;w public.workforce;expected_station_code text;
 source jsonb;daily jsonb;n integer;packages numeric;base numeric;extra numeric;result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('workforce-pool:'||p_company::text,0));
 select * into a from public.workforce_pooled_agreements where company_id=p_company and id=p_agreement;
 if not found or (p_locations is not null and not(a.station_id=any(p_locations))) then raise exception 'Agreement is outside your company or station scope'; end if;
 if a.window_end>=(now() at time zone 'Asia/Kolkata')::date then raise exception 'The entire agreed window must finish before settlement'; end if;
 select * into p from public.workforce_pooled_policies where id=a.policy_id and company_id=p_company;
 select * into w from public.workforce where id=a.workforce_id and company_id=p_company and deleted_at is null and migration_state<>'reclassified';
 if not found then raise exception 'Canonical associate cannot be reconciled'; end if;
 select s.station_code into expected_station_code from public.stations s where s.id=a.station_id and s.company_id=p_company;
 if exists(select 1 from public.workforce_payroll_lines l join public.workforce_payroll_items i on i.id=l.payroll_item_id and i.company_id=l.company_id join public.workforce_payroll_runs r on r.id=l.payroll_run_id and r.company_id=l.company_id
   where l.company_id=p_company and l.workforce_id=a.workforce_id and l.source_type='shipment' and l.work_date between a.window_start and a.window_end and r.status<>'cancelled'
   and (r.status not in('approved','paid') or i.status not in('ready','paid') or i.station_code is distinct from expected_station_code)) then raise exception 'Confirm all base payroll and resolve held, excluded or other-station work before settlement'; end if;
 select jsonb_agg(jsonb_build_object('lineId',l.id,'sourceId',l.source_id,'runId',l.payroll_run_id,'date',l.work_date,'memberId',l.provider_member_id,'packages',l.shipment_count,'activity',l.activity_count,'base',l.base_amount,'card',l.calculation_snapshot->'policyVersion') order by l.work_date,l.id)
 into source from public.workforce_payroll_lines l join public.workforce_payroll_items i on i.id=l.payroll_item_id and i.company_id=l.company_id join public.workforce_payroll_runs r on r.id=l.payroll_run_id and r.company_id=l.company_id
 where l.company_id=p_company and l.workforce_id=a.workforce_id and l.source_type='shipment' and l.work_date between a.window_start and a.window_end and r.status in('approved','paid') and i.status in('ready','paid');
 if source is null then raise exception 'No confirmed production payroll exists for this window; training-only pay is separate'; end if;
 if exists(select 1 from jsonb_array_elements(source) x where coalesce(x->>'packages','NaN') in('NaN','Infinity','-Infinity') or coalesce(x->>'activity','NaN') in('NaN','Infinity','-Infinity') or (x->>'packages')::numeric<0 or (x->>'activity')::numeric<0) then raise exception 'Package and activity counts must be complete, finite and nonnegative';end if;
 if exists(select 1 from jsonb_array_elements(source) x where x->'card'->>'pay_type' is distinct from 'fixed_daily' or (x->'card'->>'fixed_amount')::numeric is distinct from p.daily_guarantee or coalesce((x->'card'->>'fuel_rate')::numeric,-1)<>0 or (x->>'packages')::numeric<>trunc((x->>'packages')::numeric)) then raise exception 'This settlement requires a confirmed fixed-daily base at the agreed guarantee, with fuel paid separately'; end if;
 if (select count(*) from jsonb_array_elements(source))<>(select count(distinct x->>'sourceId') from jsonb_array_elements(source) x) then raise exception 'Duplicate source rows would count packages twice'; end if;
 if exists(select 1 from jsonb_array_elements(source) x left join public.cps_shipment_daily s on s.id=(x->>'sourceId')::uuid and s.company_id=p_company
   where s.id is null or s.work_date is distinct from (x->>'date')::date or s.provider_employee_id is distinct from x->>'memberId' or s.station_code is distinct from expected_station_code
    or s.total_delivery is distinct from (x->>'packages')::numeric or s.total_activity is distinct from (x->>'activity')::numeric
    or (w.last_working_date is not null and s.work_date>w.last_working_date)) then raise exception 'Delivery source changed or is incomplete. Reconcile it with the confirmed base payroll before settlement'; end if;
 if exists(select 1 from public.cps_shipment_daily s where s.company_id=p_company and s.work_date between a.window_start and a.window_end and s.total_activity>0
   and exists(select 1 from public.field_executive_provider_mappings m where m.company_id=p_company and m.provider_member_id=s.provider_employee_id and m.status<>'cancelled' and m.effective_from<=s.work_date and (m.effective_to is null or m.effective_to>=s.work_date)
    and (m.workforce_id=a.workforce_id or (m.workforce_id is null and ((w.source_profile_type='contractor' and m.contractor_id=w.source_profile_id) or (w.source_profile_type='field_executive' and m.field_executive_id=w.source_profile_id)))))
   and not exists(select 1 from jsonb_array_elements(source) x where (x->>'sourceId')::uuid=s.id)) then raise exception 'Some mapped delivery work is missing from confirmed base payroll'; end if;
 select jsonb_agg(to_jsonb(d) order by d.date),count(*)::int,sum(d.packages),sum(d.base) into daily,n,packages,base from (
  select x->>'date' as date,sum((x->>'packages')::numeric) packages,sum((x->>'base')::numeric) base,sum((x->>'activity')::numeric) activity
  from jsonb_array_elements(source) x group by x->>'date') d;
 if exists(select 1 from jsonb_array_elements(daily) d where (d->>'base')::numeric<>p.daily_guarantee or (d->>'activity')::numeric<=0) then raise exception 'Each qualifying day must contain exactly one daily guarantee across all provider IDs'; end if;
 extra:=round(case when p.formula='guarantee_plus_excess' then greatest(0,packages-p.packages_per_day*n)*p.package_rate else greatest(0,packages*p.package_rate-base) end,2);
 result:=jsonb_build_object('version','pooled-confirmed-base-v1','agreementId',a.id,'policyId',p.id,'from',a.window_start,'to',a.window_end,'formula',p.formula,'qualifyingDays',n,'packages',packages,'packageAllowance',p.packages_per_day*n,'baseAlreadyInPayroll',base,'supplement',extra,'combinedEntitlement',base+extra,'days',daily,'source',source);
 return result||jsonb_build_object('fingerprint',md5(result::text));
end $$;

create function public.workforce_submit_pooled_settlement(p_company uuid,p_actor uuid,p_agreement uuid,p_posting date,p_reference text,p_fingerprint text,p_locations uuid[])
returns uuid language plpgsql security definer set search_path='' as $$
declare a public.workforce_pooled_agreements;existing public.workforce_pooled_settlements;snapshot jsonb;adjustment uuid;result uuid;amount numeric;
begin
 if p_actor is null then raise exception 'Requester is required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('workforce-pool:'||p_company::text,0));
 select * into a from public.workforce_pooled_agreements where company_id=p_company and id=p_agreement for update;
 if not found or (p_locations is not null and not(a.station_id=any(p_locations))) then raise exception 'Agreement is outside your company or station scope'; end if;
 p_reference:=upper(btrim(p_reference));if length(coalesce(p_reference,'')) not between 3 and 180 then raise exception 'Provide a unique settlement reference'; end if;
 select * into existing from public.workforce_pooled_settlements where company_id=p_company and reference=p_reference;
 if found then
  if existing.agreement_id<>p_agreement or existing.posting_date<>p_posting or existing.snapshot->>'fingerprint' is distinct from p_fingerprint then raise exception 'This reference already describes a different settlement'; end if;
  return existing.id;
 end if;
 if exists(select 1 from public.workforce_pooled_settlements where agreement_id=a.id and status<>'rejected') then raise exception 'This window already has a pending or approved settlement'; end if;
 snapshot:=public.workforce_calculate_pooled_window(p_company,p_agreement,p_locations);
 if snapshot->>'fingerprint' is distinct from p_fingerprint then raise exception 'The calculation changed; refresh and review it before submitting'; end if;
 if p_posting is null or p_posting<=a.window_end then raise exception 'Post the supplement after the agreed window, in an open payroll period'; end if;
 if exists(select 1 from public.workforce_payroll_items i join public.workforce_payroll_runs r on r.id=i.payroll_run_id and r.company_id=i.company_id where i.company_id=p_company and i.workforce_id=a.workforce_id and r.status in('approved','paid') and p_posting between r.period_start and r.period_end) then raise exception 'Posting period is already confirmed'; end if;
 amount:=(snapshot->>'supplement')::numeric;
 if amount>0 then
  insert into public.workforce_adjustments(company_id,workforce_id,adjustment_type,category,amount,effective_date,reason,external_reference,status,requested_by)
  values(p_company,a.workforce_id,'earning','other',amount,p_posting,'Pooled MG supplement for '||a.window_start||' to '||a.window_end||'; confirmed base pay is not paid again.','POOLED-MG:'||p_reference,'pending',p_actor) returning id into adjustment;
 end if;
 insert into public.workforce_pooled_settlements(company_id,agreement_id,station_id,workforce_id,adjustment_id,reference,posting_date,snapshot,supplemental_amount,requested_by)
 values(p_company,a.id,a.station_id,a.workforce_id,adjustment,p_reference,p_posting,snapshot,amount,p_actor) returning id into result;
 return result;
end $$;

create function public.workforce_review_pooled_settlement(p_company uuid,p_actor uuid,p_settlement uuid,p_decision text,p_note text,p_locations uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare s public.workforce_pooled_settlements;latest jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('workforce-pool:'||p_company::text,0));
 select * into s from public.workforce_pooled_settlements where company_id=p_company and id=p_settlement for update;
 if not found or (p_locations is not null and not(s.station_id=any(p_locations))) then raise exception 'Settlement is outside your company or station scope'; end if;
 if p_actor is null or p_actor=s.requested_by then raise exception 'A different authorised reviewer must decide this settlement'; end if;
 if p_decision not in('approved','rejected') or length(coalesce(btrim(p_note),'')) not between 10 and 2000 then raise exception 'Choose a decision and record the independent source-completeness review'; end if;
 if s.status=p_decision and s.reviewed_by=p_actor and s.review_note=btrim(p_note) then return; end if;
 if s.status<>'pending' then raise exception 'This settlement was already reviewed'; end if;
 if p_decision='approved' then
  latest:=public.workforce_calculate_pooled_window(p_company,s.agreement_id,p_locations);
  if latest->>'fingerprint' is distinct from s.snapshot->>'fingerprint' then raise exception 'Source evidence changed since submission; reject and prepare a fresh settlement'; end if;
  if exists(select 1 from public.workforce_payroll_items i join public.workforce_payroll_runs r on r.id=i.payroll_run_id and r.company_id=i.company_id where i.company_id=p_company and i.workforce_id=s.workforce_id and r.status in('approved','paid') and s.posting_date between r.period_start and r.period_end) then raise exception 'Posting period is now confirmed; reject and resubmit to an open period'; end if;
 end if;
 update public.workforce_pooled_settlements set status=p_decision,reviewed_by=p_actor,reviewed_at=now(),review_note=btrim(p_note) where id=s.id;
 if s.adjustment_id is not null then
  update public.workforce_adjustments set status=p_decision,reviewed_by=p_actor,reviewed_at=now(),review_remarks=btrim(p_note),updated_at=now() where id=s.adjustment_id and company_id=p_company and status='pending';
  if not found then raise exception 'Adjustment state changed; refresh before reviewing'; end if;
 end if;
end $$;

create function public.workforce_pooled_adjustment_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare s public.workforce_pooled_settlements;
begin
 select * into s from public.workforce_pooled_settlements where adjustment_id=old.id;
 if not found then if tg_op='DELETE' then return old;end if;return new;end if;
 if tg_op='DELETE' then raise exception 'Pooled settlement adjustments cannot be deleted'; end if;
 if (to_jsonb(new)-array['status','reviewed_by','reviewed_at','review_remarks','payroll_run_id','updated_at']) is distinct from (to_jsonb(old)-array['status','reviewed_by','reviewed_at','review_remarks','payroll_run_id','updated_at']) then raise exception 'Pooled amounts and evidence are immutable'; end if;
 if old.status='pending' then
  if new.status not in('approved','rejected') or s.status<>new.status or s.reviewed_by is distinct from new.reviewed_by or s.review_note is distinct from new.review_remarks then raise exception 'Use the independent pooled-settlement review'; end if;
 elsif not ((old.status='approved' and new.status='posted') or (old.status='posted' and new.status='approved') or old.status=new.status)
  or (new.reviewed_by,new.reviewed_at,new.review_remarks) is distinct from (old.reviewed_by,old.reviewed_at,old.review_remarks) then raise exception 'Reviewed settlement decisions cannot be reopened'; end if;
 return new;
end $$;
create trigger workforce_pooled_adjustment_guard before update or delete on public.workforce_adjustments for each row execute function public.workforce_pooled_adjustment_guard();

-- Source imports and settlement release checks share a lock. No import is blocked merely
-- because history changed: changed history instead blocks an unreconciled new disbursement.
create function public.workforce_pooled_source_lock() returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 for target in select distinct v from unnest(case when tg_op='INSERT' then array[new.company_id] when tg_op='DELETE' then array[old.company_id] else array[old.company_id,new.company_id] end) v order by v
 loop perform pg_advisory_xact_lock(hashtextextended('workforce-pool:'||target::text,0));end loop;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger workforce_pooled_source_lock before insert or update or delete on public.cps_shipment_daily for each row execute function public.workforce_pooled_source_lock();

create function public.workforce_assert_pooled_snapshot(p_company uuid,p_run uuid,p_item uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare s public.workforce_pooled_settlements;latest jsonb;r public.workforce_payroll_runs;
begin
 perform pg_advisory_xact_lock(hashtextextended('workforce-pool:'||p_company::text,0));
 select * into r from public.workforce_payroll_runs where id=p_run and company_id=p_company;
 for s in select st.* from public.workforce_pooled_settlements st join public.workforce_adjustments a on a.id=st.adjustment_id and a.company_id=st.company_id
  join public.workforce_payroll_items i on i.workforce_id=st.workforce_id and i.company_id=st.company_id
  where st.company_id=p_company and st.status='approved' and i.payroll_run_id=p_run and i.status<>'excluded' and (p_item is null or i.id=p_item)
   and ((a.status='approved' and a.payroll_run_id is null and a.effective_date between r.period_start and r.period_end) or a.payroll_run_id=p_run)
 loop
  if not exists(select 1 from public.workforce_payroll_lines l where l.company_id=p_company and l.payroll_run_id=p_run and l.source_type='adjustment' and l.source_id=s.adjustment_id and l.adjustment_amount=s.supplemental_amount) then raise exception 'Approved pooled supplement is missing from the snapshot; recalculate payroll';end if;
  latest:=public.workforce_calculate_pooled_window(p_company,s.agreement_id,null);
  if latest->>'fingerprint' is distinct from s.snapshot->>'fingerprint' then raise exception 'Pooled source evidence changed; reconcile before payroll or Finance processing';end if;
 end loop;
end $$;
create function public.workforce_pooled_payroll_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin if new.status in('review','approved') and new.status<>old.status then perform public.workforce_assert_pooled_snapshot(new.company_id,new.id);end if;return new;end $$;
create trigger aaa_workforce_pooled_payroll_guard before update of status on public.workforce_payroll_runs for each row execute function public.workforce_pooled_payroll_guard();
create function public.workforce_pooled_finance_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare link public.workforce_payroll_finance_links;
begin
 if new.status in('processing','processed') and new.status<>old.status then
  select * into link from public.workforce_payroll_finance_links where company_id=new.company_id and payment_request_id=new.id;
  if found then perform public.workforce_assert_pooled_snapshot(new.company_id,link.payroll_run_id,link.payroll_item_id);end if;
 end if;return new;
end $$;
create trigger aaa_workforce_pooled_finance_guard before update of status on public.payment_requests for each row execute function public.workforce_pooled_finance_guard();

create function public.workforce_pooled_exit_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare s public.workforce_pooled_settlements;latest jsonb;
begin
 if new.profile_type='workforce' and new.status='settled' and old.status is distinct from new.status then
  perform pg_advisory_xact_lock(hashtextextended('workforce-pool:'||new.company_id::text,0));
  if exists(select 1 from public.workforce_pooled_agreements a where a.company_id=new.company_id and a.workforce_id=new.profile_id
   and not exists(select 1 from public.workforce_pooled_settlements settled where settled.company_id=a.company_id and settled.agreement_id=a.id and settled.status='approved')) then
   raise exception 'Reconcile every accepted pooled earning window, including zero supplements, before closing the exit';end if;
  for s in select * from public.workforce_pooled_settlements where company_id=new.company_id and workforce_id=new.profile_id and status='approved'
  loop
   latest:=public.workforce_calculate_pooled_window(new.company_id,s.agreement_id,null);
   if latest->>'fingerprint' is distinct from s.snapshot->>'fingerprint' then raise exception 'Pooled source evidence changed; reconcile it before closing the exit';end if;
  end loop;
 end if;return new;
end $$;
create trigger workforce_pooled_exit_guard before update of status on public.workforce_lifecycle_cases for each row execute function public.workforce_pooled_exit_guard();
revoke all on function public.workforce_pooled_exit_guard() from public,anon,authenticated,service_role;

revoke all on function public.workforce_pooled_immutable(),public.workforce_create_pooled_policy(uuid,uuid,uuid,text,text,numeric,integer,numeric,date,date,text,uuid[]),public.workforce_accept_pooled_window(uuid,uuid,uuid,uuid,date,date,date,text,uuid[]),public.workforce_calculate_pooled_window(uuid,uuid,uuid[]),public.workforce_submit_pooled_settlement(uuid,uuid,uuid,date,text,text,uuid[]),public.workforce_review_pooled_settlement(uuid,uuid,uuid,text,text,uuid[]),public.workforce_pooled_adjustment_guard(),public.workforce_pooled_source_lock(),public.workforce_assert_pooled_snapshot(uuid,uuid,uuid),public.workforce_pooled_payroll_guard(),public.workforce_pooled_finance_guard() from public,anon,authenticated,service_role;
grant execute on function public.workforce_create_pooled_policy(uuid,uuid,uuid,text,text,numeric,integer,numeric,date,date,text,uuid[]),public.workforce_accept_pooled_window(uuid,uuid,uuid,uuid,date,date,date,text,uuid[]),public.workforce_calculate_pooled_window(uuid,uuid,uuid[]),public.workforce_submit_pooled_settlement(uuid,uuid,uuid,date,text,text,uuid[]),public.workforce_review_pooled_settlement(uuid,uuid,uuid,text,text,uuid[]) to service_role;
commit;
