begin;
-- No rates or claims are seeded. All writes go through authenticated server actions.
create table public.workforce_mileage_policies (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 station_id uuid not null references public.stations(id), name text not null check(length(name) between 3 and 120),
 rate_per_km numeric(12,2) not null check(rate_per_km>0 and rate_per_km<=1000000),
 maximum_daily_km numeric(10,2) not null check(maximum_daily_km>0 and maximum_daily_km<=10000),
 effective_from date not null, effective_to date not null,
 policy_reference text not null check(length(policy_reference) between 3 and 1000),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 check(effective_to>=effective_from and effective_to-effective_from<=365),
 exclude using gist(company_id with =,station_id with =,daterange(effective_from,effective_to,'[]') with &&)
);
create index workforce_mileage_policy_station_idx on public.workforce_mileage_policies(company_id,station_id,effective_from);
create table public.workforce_mileage_claims (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 workforce_id uuid not null references public.workforce(id),station_id uuid not null references public.stations(id),
 policy_id uuid not null references public.workforce_mileage_policies(id),adjustment_id uuid not null unique references public.workforce_adjustments(id),
 work_date date not null,kilometres numeric(12,2) not null check(kilometres>0 and kilometres<=10000),
 rate_per_km numeric(12,2) not null check(rate_per_km>0),reference text not null check(length(reference) between 3 and 200),
 evidence_reference text not null check(length(evidence_reference) between 3 and 500),notes text not null check(length(notes) between 10 and 1500),
 reported_by uuid not null references auth.users(id),reported_at timestamptz not null default now(),
 unique(company_id,workforce_id,reference)
);
create index workforce_mileage_claim_station_idx on public.workforce_mileage_claims(company_id,station_id,work_date desc);
create index workforce_mileage_claim_day_idx on public.workforce_mileage_claims(company_id,workforce_id,work_date);
alter table public.workforce_mileage_policies enable row level security;
alter table public.workforce_mileage_claims enable row level security;
revoke all on public.workforce_mileage_policies,public.workforce_mileage_claims from public,anon,authenticated,service_role;
grant select on public.workforce_mileage_policies,public.workforce_mileage_claims to service_role;

create function public.workforce_mileage_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Mileage evidence and policy versions are immutable. Reject an incorrect claim and submit a new reference; create a non-overlapping policy version for new terms'; end $$;
create trigger workforce_mileage_policy_immutable before update or delete on public.workforce_mileage_policies for each row execute function public.workforce_mileage_immutable();
create trigger workforce_mileage_claim_immutable before update or delete on public.workforce_mileage_claims for each row execute function public.workforce_mileage_immutable();

create function public.workforce_create_mileage_policy(p_company uuid,p_actor uuid,p_station uuid,p_name text,p_rate numeric,p_max_km numeric,p_from date,p_to date,p_reference text,p_locations uuid[])
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if p_actor is null then raise exception 'Policy actor is required'; end if;
 if p_station is null or (p_locations is not null and not(p_station=any(p_locations))) then raise exception 'Station is outside your scope'; end if;
 perform 1 from public.stations where company_id=p_company and id=p_station for update;
 if not found then raise exception 'Choose a company station'; end if;
 if p_rate is null or p_rate<=0 or p_rate>1000000 or p_rate::text in ('NaN','Infinity','-Infinity') or round(p_rate,2)<>p_rate
   or p_max_km is null or p_max_km<=0 or p_max_km>10000 or p_max_km::text in ('NaN','Infinity','-Infinity') or round(p_max_km,2)<>p_max_km then raise exception 'Use positive approved amounts and kilometre limits with at most two decimals'; end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>365 then raise exception 'Choose a dated policy window of at most 366 days'; end if;
 if length(coalesce(btrim(p_name),'')) not between 3 and 120 or length(coalesce(btrim(p_reference),'')) not between 3 and 1000 then raise exception 'Name and approved policy reference are required'; end if;
 insert into public.workforce_mileage_policies(company_id,station_id,name,rate_per_km,maximum_daily_km,effective_from,effective_to,policy_reference,created_by)
 values(p_company,p_station,btrim(p_name),p_rate,p_max_km,p_from,p_to,btrim(p_reference),p_actor) returning id into result;
 return result;
end $$;

-- Explicit zero-fuel rate cards are required; imported totals are not assumed to exclude fuel.
create function public.workforce_assert_mileage_eligible(p_company uuid,p_workforce uuid,p_station uuid,p_date date)
returns void language plpgsql security definer set search_path='' as $$
declare w public.workforce; provider uuid; card public.workforce_rate_cards; providers_found integer:=0;
begin
 select * into w from public.workforce where company_id=p_company and id=p_workforce and deleted_at is null and migration_state<>'reclassified';
 if not found or w.location_id is distinct from p_station or w.onboarding_status is distinct from 'active' then raise exception 'Choose an approved canonical associate at the policy station'; end if;
 if w.last_working_date is not null and p_date>w.last_working_date then raise exception 'Mileage cannot be earned after the last working date'; end if;
 if not exists(select 1 from public.designations d join public.designation_categories c on c.id=d.designation_category_id
  where d.company_id=p_company and c.company_id=p_company and c.people_module='delivery_network'
  and ((w.designation_id is not null and d.id=w.designation_id) or (w.designation_id is null and nullif(btrim(w.designation),'') is not null and lower(btrim(w.designation)) in(lower(btrim(d.code)),lower(btrim(d.name)))))) then raise exception 'The designation master must classify this person as Workforce'; end if;
 for provider in select distinct m.provider_id from public.field_executive_provider_mappings m
  where m.company_id=p_company and m.status<>'cancelled' and (m.station_id is null or m.station_id=p_station)
  and m.effective_from<=p_date and (m.effective_to is null or m.effective_to>=p_date)
  and (m.workforce_id=p_workforce or (m.workforce_id is null and ((w.source_profile_type='field_executive' and m.field_executive_id=w.source_profile_id) or (w.source_profile_type='contractor' and m.contractor_id=w.source_profile_id))))
 loop
  providers_found:=providers_found+1;
  select * into card from public.workforce_rate_cards r where r.company_id=p_company and r.provider_id=provider
   and (r.status='active' or (r.status in('paused','closed') and r.approved_at is not null and r.effective_to is not null))
   and r.effective_from<=p_date and (r.effective_to is null or r.effective_to>=p_date)
   and (r.station_id is null or r.station_id=p_station) and (r.designation_id is null or r.designation_id=w.designation_id)
   order by ((r.station_id is not null)::int*2+(r.designation_id is not null)::int) desc,r.effective_from desc,r.id limit 1;
  if not found then raise exception 'An explicit effective zero-fuel rate card is required; mapped or imported totals may already include fuel'; end if;
  if card.fuel_rate<>0 then raise exception 'The effective rate card already includes fuel. Mileage cannot pay it again'; end if;
  if exists(select 1 from public.workforce_rate_cards r where r.company_id=p_company and r.provider_id=provider and r.fuel_rate<>0
    and (r.status='active' or (r.status in('paused','closed') and r.approved_at is not null and r.effective_to is not null))
    and r.effective_from=card.effective_from and (r.effective_to is null or r.effective_to>=p_date)
    and (r.station_id is null or r.station_id=p_station) and (r.designation_id is null or r.designation_id=w.designation_id)
    and ((r.station_id is not null)::int*2+(r.designation_id is not null)::int)=((card.station_id is not null)::int*2+(card.designation_id is not null)::int)) then raise exception 'Equally specific rate cards disagree about fuel; resolve the rate-card ambiguity first'; end if;
 end loop;
 if providers_found=0 then raise exception 'An effective provider ID mapping is required for mileage; training is handled separately'; end if;
end $$;

create function public.workforce_submit_mileage(p_company uuid,p_actor uuid,p_workforce uuid,p_policy uuid,p_km numeric,p_date date,p_posting date,p_reference text,p_evidence text,p_notes text,p_locations uuid[])
returns uuid language plpgsql security definer set search_path='' as $$
declare policy public.workforce_mileage_policies; existing public.workforce_mileage_claims; adjustment uuid; result uuid; total numeric;
begin
 perform pg_advisory_xact_lock(hashtextextended('workforce-fuel:'||p_company::text,0));
 if p_actor is null then raise exception 'Reporter is required'; end if;
 select * into policy from public.workforce_mileage_policies where id=p_policy and company_id=p_company;
 if not found or (p_locations is not null and not(policy.station_id=any(p_locations))) then raise exception 'Policy is outside your company or station scope'; end if;
 if p_km is null or p_km<=0 or p_km>policy.maximum_daily_km or p_km::text in ('NaN','Infinity','-Infinity') or round(p_km,2)<>p_km then raise exception 'Distance must be positive, within the policy daily limit and have at most two decimals'; end if;
 if p_date is null or p_date>(now() at time zone 'Asia/Kolkata')::date or p_date not between policy.effective_from and policy.effective_to then raise exception 'Work date must be in the policy period and not in the future'; end if;
 if p_posting is null or p_posting<p_date then raise exception 'Posting date cannot precede the work date'; end if;
 p_reference:=upper(btrim(p_reference));p_evidence:=btrim(p_evidence);p_notes:=btrim(p_notes);
 if length(coalesce(p_reference,'')) not between 3 and 200 or length(coalesce(p_evidence,'')) not between 3 and 500 or length(coalesce(p_notes,'')) not between 10 and 1500 then raise exception 'Provide a unique reference, distance evidence reference and verification notes'; end if;
 perform 1 from public.workforce where company_id=p_company and id=p_workforce for update;
 select * into existing from public.workforce_mileage_claims where company_id=p_company and workforce_id=p_workforce and reference=p_reference;
 if found then
  if existing.policy_id<>p_policy or existing.work_date<>p_date or existing.kilometres<>p_km or existing.evidence_reference<>p_evidence or existing.notes<>p_notes then raise exception 'This reference already exists with different evidence; review the original claim'; end if;
  return existing.id;
 end if;
 perform public.workforce_assert_mileage_eligible(p_company,p_workforce,policy.station_id,p_date);
 if exists(select 1 from public.workforce_mileage_claims c join public.workforce_adjustments a on a.id=c.adjustment_id where c.company_id=p_company and c.workforce_id=p_workforce and c.work_date=p_date and a.status not in('rejected','cancelled')) then raise exception 'This associate already has a mileage claim for that day. Combine all journeys in one claim'; end if;
 if exists(select 1 from public.workforce_payroll_items i join public.workforce_payroll_runs r on r.id=i.payroll_run_id and r.company_id=i.company_id where i.company_id=p_company and i.workforce_id=p_workforce and r.status in('approved','paid') and p_posting between r.period_start and r.period_end) then raise exception 'Posting period is already confirmed; choose the next open payroll period'; end if;
 total:=round(p_km*policy.rate_per_km,2);
 if total<=0 then raise exception 'The calculated claim must be at least one paise'; end if;
 insert into public.workforce_adjustments(company_id,workforce_id,adjustment_type,category,amount,effective_date,reason,external_reference,status,requested_by)
 values(p_company,p_workforce,'earning','reimbursement',total,p_posting,'Mileage '||p_km::text||' km × ₹'||policy.rate_per_km::text||'/km · '||p_date::text||'. '||p_notes,'MILEAGE:'||p_reference,'pending',p_actor) returning id into adjustment;
 insert into public.workforce_mileage_claims(company_id,workforce_id,station_id,policy_id,adjustment_id,work_date,kilometres,rate_per_km,reference,evidence_reference,notes,reported_by)
 values(p_company,p_workforce,policy.station_id,p_policy,adjustment,p_date,p_km,policy.rate_per_km,p_reference,p_evidence,p_notes,p_actor) returning id into result;
 return result;
end $$;

create function public.workforce_mileage_review_gate() returns trigger language plpgsql security definer set search_path='' as $$
declare claim public.workforce_mileage_claims;
begin
 select * into claim from public.workforce_mileage_claims where adjustment_id=old.id;
 if not found then if tg_op='DELETE' then return old; end if;return new; end if;
 if tg_op='DELETE' then raise exception 'Mileage adjustments cannot be deleted; reject an incorrect claim'; end if;
 if new.status<>old.status and not ((old.status in('pending','draft') and new.status in('approved','rejected')) or (old.status='approved' and new.status='posted') or (old.status='posted' and new.status='approved')) then raise exception 'Use independent approval before posting mileage; reviewed claims cannot be reopened'; end if;
 if new.company_id<>old.company_id or new.workforce_id<>old.workforce_id or new.amount<>old.amount or new.category<>old.category or new.adjustment_type<>'earning' or new.external_reference is distinct from old.external_reference or new.requested_by is distinct from old.requested_by or new.reason<>old.reason then raise exception 'Submitted mileage amounts and evidence are immutable; reject and replace an incorrect claim'; end if;
 if old.status not in('pending','draft') and (new.effective_date<>old.effective_date or new.reviewed_by is distinct from old.reviewed_by or new.reviewed_at is distinct from old.reviewed_at or new.review_remarks is distinct from old.review_remarks) then raise exception 'Reviewed mileage terms are frozen'; end if;
 if old.status in('rejected','cancelled') and new.status<>old.status then raise exception 'Rejected mileage cannot be reopened; submit corrected evidence with a new reference'; end if;
 if old.status in('pending','draft') and new.status in('approved','rejected') then
  if new.reviewed_by is null or new.reviewed_by=claim.reported_by or length(coalesce(btrim(new.review_remarks),''))<10 then raise exception 'A different reviewer must record a documented verification decision'; end if;
 end if;
 if new.status='approved' and old.status in('pending','draft') then
  perform pg_advisory_xact_lock(hashtextextended('workforce-fuel:'||new.company_id::text,0));
  perform 1 from public.workforce where id=new.workforce_id and company_id=new.company_id for update;
  perform public.workforce_assert_mileage_eligible(new.company_id,new.workforce_id,claim.station_id,claim.work_date);
  if new.effective_date<claim.work_date then raise exception 'Posting date cannot precede work'; end if;
  if exists(select 1 from public.workforce_payroll_items i join public.workforce_payroll_runs r on r.id=i.payroll_run_id and r.company_id=i.company_id where i.company_id=new.company_id and i.workforce_id=new.workforce_id and r.status in('approved','paid') and new.effective_date between r.period_start and r.period_end) then raise exception 'Choose an open payroll posting period'; end if;
 end if;
 return new;
end $$;
create trigger workforce_mileage_review_gate before update or delete on public.workforce_adjustments for each row execute function public.workforce_mileage_review_gate();

create function public.workforce_mileage_rate_gate() returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- Historical versions used for mileage cannot be edited away to expose a fuel-inclusive fallback.
 if tg_op in('UPDATE','DELETE') then
  perform pg_advisory_xact_lock(hashtextextended('workforce-fuel:'||old.company_id::text,0));
  if tg_op='UPDATE' and (to_jsonb(new)-array['effective_to','status','updated_at'])=(to_jsonb(old)-array['effective_to','status','updated_at'])
    and old.approved_at is not null and new.status in('active','paused','closed') and new.effective_to is not null
    and not exists(select 1 from public.workforce_mileage_claims c join public.workforce_adjustments a on a.id=c.adjustment_id where c.company_id=old.company_id and (old.station_id is null or old.station_id=c.station_id) and a.status in('approved','posted') and c.work_date>=old.effective_from and (old.effective_to is null or c.work_date<=old.effective_to) and c.work_date>new.effective_to) then return new; end if;
  if exists(select 1 from public.workforce_mileage_claims c join public.workforce_adjustments a on a.id=c.adjustment_id where c.company_id=old.company_id and (old.station_id is null or old.station_id=c.station_id) and a.status in('approved','posted') and c.work_date>=old.effective_from and (old.effective_to is null or c.work_date<=old.effective_to)) then raise exception 'This historical rate window has approved mileage; preserve its version and create future-dated terms'; end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 if new.status='active' and new.fuel_rate>0 then
  perform pg_advisory_xact_lock(hashtextextended('workforce-fuel:'||new.company_id::text,0));
  if exists(select 1 from public.workforce_mileage_claims c join public.workforce_adjustments a on a.id=c.adjustment_id where c.company_id=new.company_id and (new.station_id is null or new.station_id=c.station_id) and a.status in('approved','posted') and c.work_date>=new.effective_from and (new.effective_to is null or c.work_date<=new.effective_to)) then raise exception 'This fuel-inclusive version overlaps approved mileage claims; resolve the conflict before activating it'; end if;
 end if;
 return new;
end $$;
create trigger workforce_mileage_rate_gate before insert or update or delete on public.workforce_rate_cards for each row execute function public.workforce_mileage_rate_gate();

create function public.workforce_mileage_mapping_gate() returns trigger language plpgsql security definer set search_path='' as $$
declare mapping public.field_executive_provider_mappings; pass integer;
begin
 -- Preserve paid source attribution, including protected legacy aliases, before mapping edits.
 if tg_op='UPDATE' and (to_jsonb(new)-array['effective_to','status','updated_at'])=(to_jsonb(old)-array['effective_to','status','updated_at']) and new.status<>'cancelled' and new.effective_to is not null then
  perform pg_advisory_xact_lock(hashtextextended('workforce-fuel:'||old.company_id::text,0));
  if not exists(select 1 from public.workforce_mileage_claims c join public.workforce_adjustments a on a.id=c.adjustment_id join public.workforce w on w.id=c.workforce_id and w.company_id=c.company_id
    where c.company_id=old.company_id and a.status in('approved','posted') and c.work_date>=old.effective_from and (old.effective_to is null or c.work_date<=old.effective_to) and c.work_date>new.effective_to
    and (old.workforce_id=c.workforce_id or (old.workforce_id is null and ((w.source_profile_type='field_executive' and old.field_executive_id=w.source_profile_id) or (w.source_profile_type='contractor' and old.contractor_id=w.source_profile_id))))) then return new; end if;
 end if;
 for pass in 1..2 loop
  if pass=1 and tg_op<>'INSERT' then mapping:=old;
  elsif pass=2 and tg_op<>'DELETE' then mapping:=new;
  else continue; end if;
  perform pg_advisory_xact_lock(hashtextextended('workforce-fuel:'||mapping.company_id::text,0));
  if exists(select 1 from public.workforce_mileage_claims c join public.workforce_adjustments a on a.id=c.adjustment_id join public.workforce w on w.id=c.workforce_id and w.company_id=c.company_id
    where c.company_id=mapping.company_id and a.status in('approved','posted') and c.work_date>=mapping.effective_from and (mapping.effective_to is null or c.work_date<=mapping.effective_to)
    and (mapping.workforce_id=c.workforce_id or (mapping.workforce_id is null and ((w.source_profile_type='field_executive' and mapping.field_executive_id=w.source_profile_id) or (w.source_profile_type='contractor' and mapping.contractor_id=w.source_profile_id))))) then raise exception 'Approved mileage protects this historical provider mapping; create a non-overlapping future mapping'; end if;
 end loop;
 if tg_op='DELETE' then return old; end if;return new;
end $$;
create trigger workforce_mileage_mapping_gate before insert or update or delete on public.field_executive_provider_mappings for each row execute function public.workforce_mileage_mapping_gate();

create function public.workforce_mileage_payroll_gate() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status in('review','approved') and new.status<>old.status then
  perform 1 from public.workforce w join public.workforce_payroll_items i on i.workforce_id=w.id and i.company_id=w.company_id where i.payroll_run_id=new.id and i.status<>'excluded' order by w.id for update of w;
  if exists(select 1 from public.workforce_adjustments a join public.workforce_mileage_claims c on c.adjustment_id=a.id join public.workforce_payroll_items i on i.workforce_id=a.workforce_id and i.company_id=a.company_id where i.payroll_run_id=new.id and i.status<>'excluded' and a.status='approved' and a.payroll_run_id is null and a.effective_date between new.period_start and new.period_end) then raise exception 'Approved mileage is missing from this snapshot. Return to draft and recalculate payroll'; end if;
 end if;
 return new;
end $$;
create trigger workforce_mileage_payroll_gate before update of status on public.workforce_payroll_runs for each row execute function public.workforce_mileage_payroll_gate();
revoke all on function public.workforce_mileage_immutable(),public.workforce_create_mileage_policy(uuid,uuid,uuid,text,numeric,numeric,date,date,text,uuid[]),public.workforce_assert_mileage_eligible(uuid,uuid,uuid,date),public.workforce_submit_mileage(uuid,uuid,uuid,uuid,numeric,date,date,text,text,text,uuid[]),public.workforce_mileage_review_gate(),public.workforce_mileage_rate_gate(),public.workforce_mileage_mapping_gate(),public.workforce_mileage_payroll_gate() from public,anon,authenticated;
grant execute on function public.workforce_create_mileage_policy(uuid,uuid,uuid,text,numeric,numeric,date,date,text,uuid[]),public.workforce_submit_mileage(uuid,uuid,uuid,uuid,numeric,date,date,text,text,text,uuid[]) to service_role;
commit;
