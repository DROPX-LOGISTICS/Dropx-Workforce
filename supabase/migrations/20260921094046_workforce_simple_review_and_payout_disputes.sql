begin;

-- Publications survive draft recalculation, so associates retain the exact version disputed.
alter table public.workforce_payroll_runs add column associate_review_required boolean not null default false;
create table public.workforce_payout_publications (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 payroll_run_id uuid not null references public.workforce_payroll_runs(id), workforce_id uuid not null references public.workforce(id),
 station_id uuid not null references public.stations(id), revision integer not null, snapshot jsonb not null,
 published_by uuid not null references auth.users(id), published_at timestamptz not null default now(),
 review_until timestamptz not null, notify_at timestamptz not null, source_calculated_at timestamptz not null,
 notification_status text not null default 'pending' check(notification_status in ('pending','sending','sent','failed','uncertain','superseded')),
 notification_error text, notification_reference text, notification_attempted_at timestamptz,
 unique(payroll_run_id,workforce_id,revision)
);
create index workforce_payout_publications_person on public.workforce_payout_publications(company_id,workforce_id,published_at desc);
create table public.workforce_payout_disputes (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 publication_id uuid not null references public.workforce_payout_publications(id), payroll_run_id uuid not null references public.workforce_payroll_runs(id),
 workforce_id uuid not null references public.workforce(id), station_id uuid not null references public.stations(id),
 category text not null check(category in ('counts','training','loss','tds','other')),
 reason text not null check(length(btrim(reason)) between 10 and 2000),
 status text not null default 'open' check(status in ('open','in_review','resolved','rejected')),
 resolution text, resolved_by uuid references auth.users(id), resolved_at timestamptz,
 correction_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index workforce_payout_disputes_scope on public.workforce_payout_disputes(company_id,station_id,status);
create table public.workforce_payout_dispute_events (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 dispute_id uuid not null references public.workforce_payout_disputes(id), actor_id uuid,
 actor_name text not null, portal text not null check(portal in ('one','workforce','ops')),
 message text not null check(length(btrim(message)) between 3 and 2000), created_at timestamptz not null default now()
);
create table public.workforce_payout_corrections (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 payroll_run_id uuid not null references public.workforce_payroll_runs(id), workforce_id uuid not null references public.workforce(id),
 station_id uuid not null references public.stations(id), dispute_id uuid references public.workforce_payout_disputes(id),
 source_id uuid not null, kind text not null check(kind in ('counts','loss','tds','other')),
 payload jsonb not null, reason text not null check(length(btrim(reason)) between 10 and 2000),
 status text not null default 'pending' check(status in ('pending','approved','rejected','superseded')),
 requested_by uuid not null references auth.users(id), reviewed_by uuid references auth.users(id),
 review_remarks text, created_at timestamptz not null default now(), reviewed_at timestamptz
);
create unique index workforce_payout_correction_open_source on public.workforce_payout_corrections(company_id,payroll_run_id,workforce_id,source_id) where status='pending';
create unique index workforce_payout_correction_approved_source on public.workforce_payout_corrections(company_id,payroll_run_id,workforce_id,source_id) where status='approved';
create index workforce_payout_correction_dispute on public.workforce_payout_corrections(dispute_id);
create index workforce_payout_disputes_run on public.workforce_payout_disputes(payroll_run_id,status);
create index workforce_payout_disputes_person on public.workforce_payout_disputes(company_id,workforce_id,created_at);
create index workforce_payout_dispute_event_history on public.workforce_payout_dispute_events(dispute_id,created_at);
create index workforce_payout_notification_queue on public.workforce_payout_publications(notify_at) where notification_status='pending';
alter table public.workforce_payout_disputes add constraint payout_dispute_correction_fk foreign key(correction_id) references public.workforce_payout_corrections(id);

alter table public.workforce_payout_publications enable row level security;
alter table public.workforce_payout_disputes enable row level security;
alter table public.workforce_payout_dispute_events enable row level security;
alter table public.workforce_payout_corrections enable row level security;
revoke all on public.workforce_payout_publications,public.workforce_payout_disputes,public.workforce_payout_dispute_events,public.workforce_payout_corrections from public,anon,authenticated;
grant select,insert,update on public.workforce_payout_publications,public.workforce_payout_disputes,public.workforce_payout_dispute_events,public.workforce_payout_corrections to service_role;

create function public.workforce_publish_payout(p_company uuid,p_run uuid,p_actor uuid,p_review_until timestamptz,p_notify_at timestamptz)
returns integer language plpgsql security invoker set search_path='' as $$
declare r public.workforce_payroll_runs; n integer; rev integer;
begin
 select * into r from public.workforce_payroll_runs where company_id=p_company and id=p_run for update;
 if not found or r.status<>'review' or p_actor is null then raise exception 'Submit payroll for review before publishing';end if;
 if p_review_until is null or p_review_until<=now() or p_notify_at is null or p_notify_at>=p_review_until then raise exception 'Notification time must precede a future review deadline';end if;
 if exists(select 1 from public.workforce_payout_publications where payroll_run_id=p_run and source_calculated_at=r.calculated_at) then raise exception 'This calculation is already published';end if;
 select coalesce(max(revision),0)+1 into rev from public.workforce_payout_publications where payroll_run_id=p_run;
 update public.workforce_payout_publications set notification_status='superseded' where payroll_run_id=p_run and notification_status in ('pending','failed');
 insert into public.workforce_payout_publications(company_id,payroll_run_id,workforce_id,station_id,revision,snapshot,published_by,review_until,notify_at,source_calculated_at)
 select p_company,p_run,i.workforce_id,w.location_id,rev,
 jsonb_build_object('item',to_jsonb(i),'run',jsonb_build_object('id',r.id,'run_number',r.run_number,'period_start',r.period_start,'period_end',r.period_end),
 'lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.work_date,l.id) from public.workforce_payroll_lines l where l.payroll_item_id=i.id),'[]'::jsonb)),
 p_actor,p_review_until,p_notify_at,r.calculated_at
 from public.workforce_payroll_items i join public.workforce w on w.id=i.workforce_id and w.company_id=i.company_id
 where i.company_id=p_company and i.payroll_run_id=p_run and i.status='ready';
 get diagnostics n=row_count;
 if n=0 then raise exception 'No ready associates to publish';end if;
 update public.workforce_payroll_runs set associate_review_required=true where id=p_run;
 insert into public.workforce_payroll_events(company_id,payroll_run_id,event_code,actor_user_id,metadata)
 values(p_company,p_run,'associate_review_published',p_actor,jsonb_build_object('revision',rev,'review_until',p_review_until,'notify_at',p_notify_at));
 return n;
end $$;

create function public.workforce_raise_payout_dispute(p_company uuid,p_workforce uuid,p_publication uuid,p_category text,p_reason text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare pub public.workforce_payout_publications;r public.workforce_payroll_runs;did uuid;
begin
 select * into pub from public.workforce_payout_publications where id=p_publication and company_id=p_company and workforce_id=p_workforce;
 if not found then raise exception 'Payout is not available for this associate';end if;
 select * into r from public.workforce_payroll_runs where id=pub.payroll_run_id and company_id=p_company for update;
 if r.status not in ('draft','review') then raise exception 'This payout is already confirmed. Contact support for a correction in the next open period';end if;
 if exists(select 1 from public.workforce_payout_publications where payroll_run_id=pub.payroll_run_id and workforce_id=p_workforce and revision>pub.revision) then raise exception 'Open the latest payout version before raising a dispute';end if;
 if exists(select 1 from public.workforce_payout_disputes where publication_id=p_publication and category=p_category and status in ('open','in_review')) then raise exception 'An open dispute already exists for this category. Add a reply to it';end if;
 insert into public.workforce_payout_disputes(company_id,publication_id,payroll_run_id,workforce_id,station_id,category,reason)
 values(p_company,p_publication,pub.payroll_run_id,p_workforce,pub.station_id,p_category,btrim(p_reason)) returning id into did;
 insert into public.workforce_payout_dispute_events(company_id,dispute_id,actor_name,portal,message)
 values(p_company,did,coalesce(pub.snapshot->'item'->>'worker_name','Associate'),'one',btrim(p_reason));
 return did;
end $$;

create function public.workforce_update_payout_dispute(p_company uuid,p_dispute uuid,p_actor uuid,p_actor_name text,p_portal text,p_status text,p_message text,p_correction uuid,p_locations uuid[])
returns void language plpgsql security invoker set search_path='' as $$
declare d public.workforce_payout_disputes;c public.workforce_payout_corrections;r public.workforce_payroll_runs;
begin
 select * into d from public.workforce_payout_disputes where id=p_dispute and company_id=p_company;
 if not found or p_actor is null or p_portal not in ('workforce','ops') or p_locations is not null and not(d.station_id=any(p_locations)) then raise exception 'Dispute is outside your scope';end if;
 select * into r from public.workforce_payroll_runs where id=d.payroll_run_id for update;
 select * into d from public.workforce_payout_disputes where id=p_dispute for update;
 if d.status in ('resolved','rejected') then raise exception 'This dispute is already closed';end if;
 if length(btrim(coalesce(p_message,'')))<3 or p_status not in ('in_review','resolved','rejected') then raise exception 'Record a reply and valid decision';end if;
 if p_correction is not null then
   select * into c from public.workforce_payout_corrections where id=p_correction and company_id=p_company and payroll_run_id=d.payroll_run_id and workforce_id=d.workforce_id and dispute_id=d.id;
   if not found or c.status<>'approved' then raise exception 'Correction must be independently approved';end if;
   if not exists(select 1 from public.workforce_payroll_lines where payroll_run_id=d.payroll_run_id and workforce_id=d.workforce_id and calculation_snapshot->>'correction_id'=c.id::text) then raise exception 'Recalculate payroll to include the correction before resolving';end if;
 end if;
 if p_status='resolved' and exists(select 1 from public.workforce_payout_corrections where dispute_id=d.id and status='pending') then raise exception 'Review the pending correction first';end if;
 if p_status='resolved' and exists(select 1 from public.workforce_payout_corrections where dispute_id=d.id and status='approved' and id is distinct from p_correction) then raise exception 'Select the approved correction when resolving';end if;
 update public.workforce_payout_disputes set status=p_status,resolution=case when p_status in ('resolved','rejected') then p_message else null end,
 resolved_by=case when p_status in ('resolved','rejected') then p_actor else null end,resolved_at=case when p_status in ('resolved','rejected') then now() else null end,correction_id=p_correction,updated_at=now() where id=d.id;
 insert into public.workforce_payout_dispute_events(company_id,dispute_id,actor_id,actor_name,portal,message) values(p_company,d.id,p_actor,p_actor_name,p_portal,p_message);
end $$;

create function public.workforce_propose_payout_correction(p_company uuid,p_run uuid,p_workforce uuid,p_actor uuid,p_portal text,p_source uuid,p_kind text,p_payload jsonb,p_reason text,p_dispute uuid,p_locations uuid[])
returns uuid language plpgsql security invoker set search_path='' as $$
declare r public.workforce_payroll_runs;w public.workforce;l public.workforce_payroll_lines;cid uuid;key text;v numeric;
begin
 select * into r from public.workforce_payroll_runs where id=p_run and company_id=p_company for update;
 select * into w from public.workforce where id=p_workforce and company_id=p_company;
 if r.id is null or r.status not in ('draft','review') or w.id is null or p_actor is null or p_portal not in ('ops','workforce') or p_locations is not null and not(w.location_id=any(p_locations)) then raise exception 'Choose an open payout within your station scope';end if;
 select * into l from public.workforce_payroll_lines where payroll_run_id=p_run and workforce_id=p_workforce and source_id=p_source;
 if not found then raise exception 'Choose an existing payout source line';end if;
 if p_dispute is not null and not exists(select 1 from public.workforce_payout_disputes where id=p_dispute and payroll_run_id=p_run and workforce_id=p_workforce and company_id=p_company and status in ('open','in_review')) then raise exception 'Dispute does not belong to this payout';end if;
 if p_kind='loss' then
   if p_portal<>'ops' then raise exception 'OpsPulse owns loss revisions';end if;
   if not exists(select 1 from public.workforce_station_loss_claims where company_id=p_company and adjustment_id=p_source and workforce_id=p_workforce) then raise exception 'Choose a station loss line';end if;
   v:=(p_payload->>'amount')::numeric;
   if v is null or v<0 or v>999999999 or v::text in ('NaN','Infinity','-Infinity') or round(v,2)<>v then raise exception 'Enter the revised loss amount; use zero to remove';end if;
 elsif p_kind='counts' then
   if l.source_type<>'shipment' then raise exception 'Choose a shipment day';end if;
   foreach key in array array['totalDelivery','customerReturn','mfn','mfnReturn'] loop
     v:=(p_payload->>key)::numeric;
     if v is null or v<0 or v>100000 or trunc(v)<>v then raise exception 'All four corrected counts must be nonnegative whole numbers';end if;
   end loop;
 else
   if p_portal<>'workforce' then raise exception 'Workforce owns pay and tax corrections';end if;
   v:=(p_payload->>'amount')::numeric;
   if v is null or abs(v)>999999999 or v::text in ('NaN','Infinity','-Infinity') or round(v,2)<>v then raise exception 'Enter a valid signed correction amount';end if;
 end if;
 insert into public.workforce_payout_corrections(company_id,payroll_run_id,workforce_id,station_id,dispute_id,source_id,kind,payload,reason,requested_by)
 values(p_company,p_run,p_workforce,w.location_id,p_dispute,p_source,p_kind,p_payload,btrim(p_reason),p_actor) returning id into cid;
 return cid;
end $$;

create function public.workforce_review_payout_correction(p_company uuid,p_id uuid,p_actor uuid,p_decision text,p_remarks text,p_locations uuid[])
returns void language plpgsql security invoker set search_path='' as $$
declare c public.workforce_payout_corrections;r public.workforce_payroll_runs;
begin
 select * into c from public.workforce_payout_corrections where id=p_id and company_id=p_company;
 if not found or p_actor is null or p_locations is not null and not(c.station_id=any(p_locations)) then raise exception 'Correction is outside your scope';end if;
 select * into r from public.workforce_payroll_runs where id=c.payroll_run_id for update;
 select * into c from public.workforce_payout_corrections where id=p_id for update;
 if r.status not in ('draft','review') or c.status<>'pending' then raise exception 'Correction is no longer editable';end if;
 if c.requested_by=p_actor then raise exception 'Another reviewer must approve this correction';end if;
 if p_decision not in ('approved','rejected') or length(btrim(coalesce(p_remarks,'')))<3 then raise exception 'Record a decision and reason';end if;
 if p_decision='approved' then
  update public.workforce_payout_corrections set status='superseded' where payroll_run_id=c.payroll_run_id and workforce_id=c.workforce_id and source_id=c.source_id and status='approved';
 end if;
 update public.workforce_payout_corrections set status=p_decision,reviewed_by=p_actor,reviewed_at=now(),review_remarks=p_remarks where id=p_id;
 if p_decision='approved' and r.status='review' then
   update public.workforce_payroll_runs set status='draft',submitted_by=null,submitted_at=null,updated_at=now() where id=r.id;
 end if;
 insert into public.workforce_payroll_events(company_id,payroll_run_id,event_code,actor_user_id,remarks,metadata)
 values(p_company,r.id,'correction_'||p_decision,p_actor,p_remarks,jsonb_build_object('correction_id',p_id,'reason',c.reason,'payload',c.payload));
end $$;

create function public.workforce_payout_review_gate() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then new.associate_review_required:=true;return new;end if;
 if new.status='approved' and old.status<>'approved' and new.associate_review_required then
  if exists(select 1 from public.workforce_payout_disputes where payroll_run_id=new.id and status in ('open','in_review')) then raise exception 'Resolve all associate disputes before Finance release';end if;
  if exists(select 1 from public.workforce_payout_corrections c where c.payroll_run_id=new.id and (c.status='pending' or c.status='approved' and not exists(select 1 from public.workforce_payroll_lines l where l.payroll_run_id=new.id and l.workforce_id=c.workforce_id and l.calculation_snapshot->>'correction_id'=c.id::text))) then raise exception 'Approve and recalculate all payout corrections before release';end if;
  if exists(select 1 from public.workforce_payroll_items i where i.payroll_run_id=new.id and i.status='ready' and not exists(select 1 from public.workforce_payout_publications p where p.payroll_run_id=new.id and p.workforce_id=i.workforce_id and p.source_calculated_at=new.calculated_at and p.review_until<=now())) then raise exception 'Publish the latest calculation and allow the associate review window to finish';end if;
 end if;
 return new;
end $$;
create trigger workforce_payout_review_gate before insert or update of status on public.workforce_payroll_runs for each row execute function public.workforce_payout_review_gate();

-- One review form writes a station-specific version and delegates to the existing audited plan.
create function public.workforce_save_review_terms(p_company uuid,p_actor uuid,p_actor_name text,p_workforce uuid,p_version integer,p_terms jsonb,p_locations uuid[])
returns void language plpgsql security invoker set search_path='' as $$
declare w public.workforce;old_plan public.workforce_joining_plans;policy uuid;plan jsonb;rate numeric;minutes integer;
begin
 select * into w from public.workforce where id=p_workforce and company_id=p_company for update;
 if not found or p_locations is not null and not(w.location_id=any(p_locations)) then raise exception 'Associate is outside your station scope';end if;
 select * into old_plan from public.workforce_joining_plans where workforce_id=p_workforce and company_id=p_company;
 rate:=(p_terms->>'daily_rate')::numeric;minutes:=(p_terms->>'minimum_minutes')::integer;
 if p_terms->>'mode'='training' then
   select id into policy from public.workforce_training_policies where company_id=p_company and station_id=w.location_id and is_active and daily_rate=rate and minimum_minutes=minutes and effective_from<=(p_terms->>'eligible_from')::date and (effective_to is null or effective_to>=(p_terms->>'eligible_from')::date) order by created_at desc limit 1;
   if policy is null then
     insert into public.workforce_training_policies(company_id,station_id,name,daily_rate,minimum_minutes,policy_reference,effective_from,created_by)
     values(p_company,w.location_id,'Associate terms '||coalesce(w.dropx_id,left(w.id::text,8))||' '||left(gen_random_uuid()::text,8),rate,minutes,p_terms->>'terms_reference',(p_terms->>'eligible_from')::date,p_actor) returning id into policy;
   end if;
 end if;
 plan:=coalesce(to_jsonb(old_plan),'{}'::jsonb)||p_terms||jsonb_build_object('station_id',w.location_id,'training_policy_id',policy,'terms_accepted_on',p_terms->>'eligible_from','provider_stage',coalesce(p_terms->>'provider_stage',old_plan.provider_stage,'not_started'));
 perform public.workforce_save_joining_plan(p_company,p_actor,p_actor_name,p_workforce,p_version,plan,p_locations);
end $$;

revoke all on function public.workforce_publish_payout(uuid,uuid,uuid,timestamptz,timestamptz),public.workforce_raise_payout_dispute(uuid,uuid,uuid,text,text),public.workforce_update_payout_dispute(uuid,uuid,uuid,text,text,text,text,uuid,uuid[]),public.workforce_propose_payout_correction(uuid,uuid,uuid,uuid,text,uuid,text,jsonb,text,uuid,uuid[]),public.workforce_review_payout_correction(uuid,uuid,uuid,text,text,uuid[]),public.workforce_payout_review_gate(),public.workforce_save_review_terms(uuid,uuid,text,uuid,integer,jsonb,uuid[]) from public,anon,authenticated;
grant execute on function public.workforce_publish_payout(uuid,uuid,uuid,timestamptz,timestamptz),public.workforce_raise_payout_dispute(uuid,uuid,uuid,text,text),public.workforce_update_payout_dispute(uuid,uuid,uuid,text,text,text,text,uuid,uuid[]),public.workforce_propose_payout_correction(uuid,uuid,uuid,uuid,text,uuid,text,jsonb,text,uuid,uuid[]),public.workforce_review_payout_correction(uuid,uuid,uuid,text,text,uuid[]),public.workforce_payout_review_gate(),public.workforce_save_review_terms(uuid,uuid,text,uuid,integer,jsonb,uuid[]) to service_role;
create function public.workforce_reply_payout_dispute(p_company uuid,p_workforce uuid,p_dispute uuid,p_message text)
returns void language plpgsql security invoker set search_path='' as $$
declare d public.workforce_payout_disputes;
begin
 select * into d from public.workforce_payout_disputes where company_id=p_company and workforce_id=p_workforce and id=p_dispute;
 if not found then raise exception 'Dispute not found';end if;
 perform 1 from public.workforce_payroll_runs where id=d.payroll_run_id for update;
 select * into d from public.workforce_payout_disputes where id=p_dispute for update;
 if d.status not in ('open','in_review') then raise exception 'This dispute is closed';end if;
 insert into public.workforce_payout_dispute_events(company_id,dispute_id,actor_name,portal,message) values(p_company,d.id,'Associate','one',btrim(p_message));
end $$;
revoke all on function public.workforce_reply_payout_dispute(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.workforce_reply_payout_dispute(uuid,uuid,uuid,text) to service_role;
-- A reviewed correction is evidence, not an unreconciled original loss at exit.
create or replace function public.workforce_exit_recorded_checks(p_company uuid,p_workforce uuid,p_locations uuid[])
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare w public.workforce; total_items bigint; unresolved_items bigint; unposted bigint; broken_posted bigint; holds bigint; windows bigint;
begin
 select * into w from public.workforce where company_id=p_company and id=p_workforce and deleted_at is null and migration_state<>'reclassified';
 if not found then raise exception 'Choose a canonical Workforce associate';end if;
 if p_locations is not null and (w.location_id is null or not(w.location_id=any(p_locations))) then raise exception 'Associate is outside your station scope';end if;
 select count(*),count(*) filter(where not (
   r.status in('approved','paid') and i.status='paid' and i.net_amount>0
   and i.net_amount::text not in('NaN','Infinity','-Infinity')
   and i.gross_amount::text not in('NaN','Infinity','-Infinity') and i.deduction_amount::text not in('NaN','Infinity','-Infinity')
   and i.gross_amount-i.deduction_amount=i.net_amount
   and exists(select 1 from public.workforce_payroll_finance_links l join public.payment_requests p on p.id=l.payment_request_id and p.company_id=l.company_id
     where l.company_id=i.company_id and l.payroll_item_id=i.id and l.payroll_run_id=i.payroll_run_id
       and p.status='processed' and p.amount=i.net_amount and nullif(btrim(p.utr_cin),'') is not null and p.processed_at is not null and isfinite(p.processed_at))
 ) is true) into total_items,unresolved_items
 from public.workforce_payroll_items i left join public.workforce_payroll_runs r on r.id=i.payroll_run_id and r.company_id=i.company_id
 where i.company_id=p_company and i.workforce_id=p_workforce and coalesce(r.status,'missing')<>'cancelled';
 select count(*) filter(where a.status in('draft','pending','approved')),
 count(*) filter(where a.status='posted' and 1<>(select count(*) from public.workforce_payroll_lines l
   join public.workforce_payroll_items i on i.id=l.payroll_item_id and i.company_id=l.company_id and i.payroll_run_id=l.payroll_run_id
   join public.workforce_payroll_runs r on r.id=i.payroll_run_id and r.company_id=i.company_id
   where l.company_id=a.company_id and l.workforce_id=a.workforce_id and i.workforce_id=a.workforce_id
     and l.payroll_run_id=a.payroll_run_id and l.source_type='adjustment' and l.source_id=a.id
     and l.work_date=a.effective_date and l.base_amount=0 and l.incentive_amount=0
     and (l.adjustment_amount=(case when a.adjustment_type='deduction' then -a.amount else a.amount end)
       or exists(select 1 from public.workforce_payout_corrections c where c.company_id=a.company_id and c.workforce_id=a.workforce_id and c.payroll_run_id=a.payroll_run_id and c.source_id=a.id and c.status='approved' and l.calculation_snapshot->>'correction_id'=c.id::text and l.adjustment_amount=case when c.kind='loss' then -(c.payload->>'amount')::numeric else (case when a.adjustment_type='deduction' then -a.amount else a.amount end)+(c.payload->>'amount')::numeric end))
     and l.net_amount=l.adjustment_amount and r.status in('approved','paid') and i.status='paid'))
 into unposted,broken_posted from public.workforce_adjustments a where a.company_id=p_company and a.workforce_id=p_workforce;
 select count(*) into holds from public.workforce_payment_holds where company_id=p_company and workforce_id=p_workforce and status<>'released';
 select count(*) into windows from public.workforce_pooled_agreements a where a.company_id=p_company and a.workforce_id=p_workforce
   and not exists(select 1 from public.workforce_pooled_settlements s where s.company_id=a.company_id and s.agreement_id=a.id and s.status='approved');
 return jsonb_build_object('payroll_items',total_items,'unreconciled_payroll',unresolved_items,'unposted_adjustments',unposted,
   'unreconciled_posted_adjustments',broken_posted,'active_holds',holds,'unsettled_windows',windows);
end $$;

-- Dated personal terms reuse the existing ID mapping and its payroll-lock guards.
create or replace function public.workforce_joining_mapping_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare affected uuid;old_affected uuid;starting date;company uuid;
begin
 if tg_op in ('UPDATE','DELETE') then old_affected:=public.workforce_joining_mapping_person(old.company_id,old.workforce_id,old.field_executive_id,old.contractor_id);end if;
 if tg_op='DELETE' then affected:=old_affected;company:=old.company_id;starting:=old.effective_from;
 else
  affected:=public.workforce_joining_mapping_person(new.company_id,new.workforce_id,new.field_executive_id,new.contractor_id);company:=new.company_id;starting:=new.effective_from;
  if tg_op='UPDATE' then
   if (to_jsonb(old)-'updated_at') is not distinct from (to_jsonb(new)-'updated_at') then return new;end if;
   if old_affected is distinct from affected then raise exception 'Do not reassign a mapping; close and create an audited mapping';end if;
   starting:=least(starting,old.effective_from);
   -- Closing only the future portion preserves every earlier paid day.
   if new.effective_to is not null and (old.effective_to is null or new.effective_to<old.effective_to) and new.status='closed'
    and (to_jsonb(new)-array['effective_to','status','updated_at'])=(to_jsonb(old)-array['effective_to','status','updated_at']) then starting:=new.effective_to+1;end if;
  end if;
 end if;
 if affected is not null then
  perform 1 from public.workforce where id=affected and company_id=company for update;
  if exists(select 1 from public.workforce_payroll_items i join public.workforce_payroll_runs r on r.id=i.payroll_run_id where i.company_id=company and i.workforce_id=affected and r.status in ('review','approved','paid') and r.period_end>=starting) then raise exception 'Mapping affects submitted payroll. Return the run to draft or use a reviewed financial correction';end if;
  update public.workforce_joining_plans set version=version+1,updated_at=now() where workforce_id=affected and company_id=company;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create function public.workforce_save_personal_payment_stage(p_company uuid,p_actor uuid,p_actor_name text,p_workforce uuid,p_mapping uuid,p_expected timestamptz,p_mode text,p_from date,p_to date,p_type text,p_values jsonb,p_reason text,p_locations uuid[])
returns void language plpgsql security invoker set search_path='' as $$
declare w public.workforce;m public.field_executive_provider_mappings;method uuid;required text[];k text;v numeric;payload jsonb;replacement uuid;
begin
 select * into w from public.workforce where company_id=p_company and id=p_workforce and deleted_at is null and migration_state<>'reclassified' for update;
 if not found or w.onboarding_status not in ('approved','active') or p_actor is null then raise exception 'Choose an approved associate';end if;
 select * into m from public.field_executive_provider_mappings where company_id=p_company and id=p_mapping and workforce_id=p_workforce and status<>'cancelled' for update;
 if not found then raise exception 'Choose this associate''s canonical provider mapping';end if;
 if p_locations is not null and (w.location_id is null or m.station_id is null or not(w.location_id=any(p_locations)) or not(m.station_id=any(p_locations))) then raise exception 'Payment stage is outside your station scope';end if;
 if m.updated_at is distinct from p_expected then raise exception 'Payment mapping changed. Refresh before saving';end if;
 if p_mode not in ('next','edit') or p_mode is null or p_from is null or p_to<p_from or p_from<m.effective_from or p_mode='next' and p_from<=m.effective_from or p_mode='edit' and p_from<>m.effective_from then raise exception 'Choose a valid dated payment stage';end if;
 if length(btrim(coalesce(p_reason,'')))<10 or length(p_reason)>1000 then raise exception 'Explain the agreed terms or reason for this change';end if;
 if p_type not in ('MG_PER_DAY','PER_PACKET') or p_type is null then raise exception 'Choose daily pay or per-activity rates';end if;
 select id into method from public.payment_methods where company_id=p_company and code=p_type and is_active limit 1;
 if method is null then raise exception 'Configure this payment method in the master first';end if;
 required:=case when p_type='MG_PER_DAY' then array['MG_PER_DAY'] else array['DELIVERY','CRETURN','SELLER_PICKUP','SLLLER_RETURN'] end;
 payload:='{}'::jsonb;
 foreach k in array required loop
   v:=(p_values->>k)::numeric;
   if v is null or v::text in ('NaN','Infinity','-Infinity') or v<0 or v>1000000 or p_type='MG_PER_DAY' and v<=0 then raise exception 'Complete each rate with a valid nonnegative amount; daily pay must be positive';end if;
   payload:=payload||jsonb_build_object(k,v);
 end loop;
 payload:=payload||jsonb_build_object('DROPX_PERSONAL_TERMS',1);
 -- Never extend an already-closed historical stage across a deliberate gap.
 replacement:=case when p_mode='next' and m.effective_to is not null and m.effective_to<p_from then null else m.id end;
 perform public.workforce_save_joining_mapping(p_company,p_actor,p_workforce,replacement,w.dropx_id,jsonb_build_object('provider_id',m.provider_id,'station_id',m.station_id,'provider_member_id',m.provider_member_id,'effective_from',p_from,'effective_to',p_to,'payment_method_id',method,'payment_values',payload,'pay_type',p_type,'status',case when p_to is null then 'active' else 'closed' end),p_locations,p_actor_name);
 update public.field_executive_provider_mappings set reason=p_reason where company_id=p_company and workforce_id=p_workforce and provider_id=m.provider_id and provider_member_id=m.provider_member_id and station_id=m.station_id and effective_from=p_from and status<>'cancelled';
 insert into public.workforce_joining_events(company_id,workforce_id,event_code,actor_id,actor_name,details) values(p_company,p_workforce,'payment_stage_saved',p_actor,p_actor_name,jsonb_build_object('previous_mapping',to_jsonb(m),'from',p_from,'through',p_to,'pay_type',p_type,'payment_values',payload,'reason',p_reason));
end $$;
revoke all on function public.workforce_save_personal_payment_stage(uuid,uuid,text,uuid,uuid,timestamptz,text,date,date,text,jsonb,text,uuid[]) from public,anon,authenticated;
grant execute on function public.workforce_save_personal_payment_stage(uuid,uuid,text,uuid,uuid,timestamptz,text,date,date,text,jsonb,text,uuid[]) to service_role;
create function public.workforce_retry_payout_notice(p_company uuid,p_actor uuid,p_id uuid,p_locations uuid[])
returns void language plpgsql security invoker set search_path='' as $$
declare p public.workforce_payout_publications;r public.workforce_payroll_runs;
begin
 select * into p from public.workforce_payout_publications where id=p_id and company_id=p_company;
 if not found or p_actor is null or p_locations is not null and (p.station_id is null or not(p.station_id=any(p_locations))) then raise exception 'Publication is outside your station scope';end if;
 select * into r from public.workforce_payroll_runs where id=p.payroll_run_id and company_id=p_company for update;
 if r.status<>'review' or r.calculated_at is distinct from p.source_calculated_at or p.review_until<=now() then raise exception 'Only a current payout within its review window can be notified';end if;
 update public.workforce_payout_publications set notification_status='pending',notification_error=null,notify_at=now() where id=p_id and notification_status='failed';
 if not found then raise exception 'Only definite failures can be retried. Uncertain deliveries require operator verification';end if;
 insert into public.workforce_payroll_events(company_id,payroll_run_id,event_code,actor_user_id,metadata) values(p_company,r.id,'payout_notification_requeued',p_actor,jsonb_build_object('publication_id',p_id));
end $$;
revoke all on function public.workforce_retry_payout_notice(uuid,uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.workforce_retry_payout_notice(uuid,uuid,uuid,uuid[]) to service_role;
commit;
