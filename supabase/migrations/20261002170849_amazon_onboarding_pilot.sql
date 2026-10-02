begin;
-- Additive, opt-in cohort. Never backfill existing associates into the pilot.
create table public.workforce_amazon_pilots (
 workforce_id uuid primary key references public.workforce(id),
 company_id uuid not null references public.companies(id),
 station_id uuid not null references public.stations(id),
 reported_on date not null,
 trial_completed_at timestamptz,
 trial_days integer not null default 2 check(trial_days between 0 and 7),
 readiness_note text,
 closed_at timestamptz,
 invitation_timing text not null default 'on_arrival' check(invitation_timing in ('after_trial','on_arrival')),
 payroll_mode text not null default 'observation' check(payroll_mode='observation'),
 evidence jsonb not null default '{}',
 last_checked_at timestamptz,
 sync_error text,
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now()
);
create index on public.workforce_amazon_pilots(company_id,station_id);
create table public.workforce_amazon_pilot_trials (
 id uuid primary key default gen_random_uuid(),
 workforce_id uuid not null references public.workforce_amazon_pilots(workforce_id),
 company_id uuid not null references public.companies(id),
 work_date date not null,
 minutes integer not null check(minutes between 1 and 1440),
 notes text not null default '' check(length(notes)<=1000),
 recorded_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 unique(workforce_id,work_date)
);
create table public.workforce_amazon_pilot_history (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 workforce_id uuid not null references public.workforce_amazon_pilots(workforce_id),
 event text not null,
 evidence jsonb not null,
 observed_at timestamptz not null default now()
);
create index on public.workforce_amazon_pilot_history(workforce_id,observed_at desc);
alter table public.workforce_amazon_pilots enable row level security;
alter table public.workforce_amazon_pilot_trials enable row level security;
alter table public.workforce_amazon_pilot_history enable row level security;
revoke all on public.workforce_amazon_pilots,public.workforce_amazon_pilot_trials,public.workforce_amazon_pilot_history from public,anon,authenticated;
grant select,insert,update on public.workforce_amazon_pilots,public.workforce_amazon_pilot_trials,public.workforce_amazon_pilot_history to service_role;

-- Identity creation is atomic; no legacy joining plan, pay mapping or attendance backfill.
create function public.workforce_create_amazon_pilot(p_company uuid,p_actor uuid,p_data jsonb,p_locations uuid[])
returns uuid language plpgsql security invoker set search_path='' as $$
declare wid uuid := (p_data->>'id')::uuid; sid uuid := (p_data->>'station_id')::uuid; did uuid := (p_data->>'designation_id')::uuid; role_name text; v_mobile text := p_data->>'mobile'; v_email text := lower(btrim(p_data->>'email')); reported date := (p_data->>'reported_on')::date;
begin
 if p_actor is null or length(btrim(p_data->>'full_name')) not between 2 and 120 or v_mobile !~ '^[0-9]{10}$' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or reported > (now() at time zone 'Asia/Kolkata')::date or reported < (now() at time zone 'Asia/Kolkata')::date-7 then raise exception 'Enter valid arrival details within the last seven days'; end if;
 if p_locations is not null and not(sid=any(p_locations)) then raise exception 'Station outside your access'; end if;
 if not exists(select 1 from public.stations s join public.workforce_amazon_station_settings a on a.station_id=s.id and a.company_id=s.company_id where s.id=sid and s.company_id=p_company) then raise exception 'Configure Amazon onboarding for this station first'; end if;
 select d.name into role_name from public.designations d join public.designation_categories c on c.id=d.designation_category_id where d.id=did and d.company_id=p_company and d.is_active and c.people_module='delivery_network';
 if role_name is null then raise exception 'Select a Workforce designation'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company::text||v_mobile,0));
 if exists(select 1 from public.workforce w where w.company_id=p_company and w.deleted_at is null and (right(regexp_replace(w.mobile,'[^0-9]','','g'),10)=v_mobile or lower(btrim(w.email))=v_email)) then raise exception 'An associate already uses this mobile or email. Keep their existing onboarding flow; do not create a duplicate.'; end if;
 insert into public.workforce(id,company_id,full_name,mobile,mobile_country_code,email,date_of_join,location_id,designation_id,designation,source_profile_type,source_profile_id,compatibility_mode,migration_state,is_active,onboarding_status,lifecycle_status,approval_required,created_by,biometric_id,dropx_id,onboarding_application_source,onboarding_token_hash,onboarding_token_expires_at)
 values(wid,p_company,btrim(p_data->>'full_name'),v_mobile,'91',v_email,reported,sid,did,role_name,'canonical',wid,false,'canonical',false,'pending','onboarding',true,p_actor,p_data->>'biometric_id',p_data->>'dropx_id','workforce',p_data->>'token_hash',now()+interval '7 days');
 insert into public.workforce_amazon_pilots(workforce_id,company_id,station_id,reported_on,created_by,invitation_timing,trial_days) values(wid,p_company,sid,reported,p_actor,'on_arrival',coalesce((p_data->>'trial_days')::integer,2));
 insert into public.biometric_enrolments(company_id,enrolment_id,worker_type,profile_type,account_id,location_id,status,effective_from,created_by) values(p_company,p_data->>'biometric_id','individual_contract','workforce',wid,sid,'Active',reported,p_actor);
 insert into public.workforce_amazon_pilot_history(company_id,workforce_id,event,evidence) values(p_company,wid,'reported',jsonb_build_object('reported_on',reported,'actor',p_actor));
 return wid;
end $$;
revoke all on function public.workforce_create_amazon_pilot(uuid,uuid,jsonb,uuid[]) from public,anon,authenticated;
grant execute on function public.workforce_create_amazon_pilot(uuid,uuid,jsonb,uuid[]) to service_role;

-- The trigger needs a private cohort lookup even for legacy authenticated callers;
-- it cannot be invoked as an RPC and all direct execution grants are revoked.
-- Protect the pilot from existing approval and payroll-entry paths. Legacy rows pass through.
create function public.workforce_amazon_pilot_payroll_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare wid uuid;
begin
 if tg_table_name='workforce' then
  if new.is_active or new.onboarding_status in ('approved','active') or new.onboarding_approved_at is not null then
   if exists(select 1 from public.workforce_amazon_pilots where workforce_id=new.id) then raise exception 'Amazon onboarding pilot is observation-only. Payroll cutover has not been enabled.'; end if;
  end if;
 else
  wid:=(to_jsonb(new)->>'workforce_id')::uuid;
  if exists(select 1 from public.workforce_amazon_pilots where workforce_id=wid) then raise exception 'Pilot records cannot enter payroll until a separately reviewed cutover.'; end if;
 end if;
 return new;
end $$;
create trigger amazon_pilot_activation_guard before update of is_active,onboarding_status,onboarding_approved_at on public.workforce for each row execute function public.workforce_amazon_pilot_payroll_guard();
create trigger amazon_pilot_mapping_guard before insert or update on public.field_executive_provider_mappings for each row execute function public.workforce_amazon_pilot_payroll_guard();
create trigger amazon_pilot_adjustment_guard before insert or update on public.workforce_adjustments for each row execute function public.workforce_amazon_pilot_payroll_guard();
revoke all on function public.workforce_amazon_pilot_payroll_guard() from public,anon,authenticated;
grant execute on function public.workforce_amazon_pilot_payroll_guard() to service_role;

-- Reuse the established LSC delivery queue only for new, explicitly opted-in people.
create function public.workforce_queue_amazon_pilot(p_company uuid,p_workforce uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare pilot public.workforce_amazon_pilots; w public.workforce; rid uuid; cfg public.workforce_amazon_station_settings;
begin
 select * into pilot from public.workforce_amazon_pilots where company_id=p_company and workforce_id=p_workforce for update;
 if not found or pilot.closed_at is not null or (pilot.invitation_timing='after_trial' and pilot.trial_completed_at is null) then return null; end if;
 select * into w from public.workforce where id=p_workforce and company_id=p_company and deleted_at is null;
 if not found then return null; end if;
 select * into cfg from public.workforce_amazon_station_settings where station_id=pilot.station_id and company_id=p_company;
 if not coalesce(cfg.invitation_enabled,false) then raise exception 'Amazon invitation is disabled for this station'; end if;
 select id into rid from public.workforce_amazon_invitation_requests where company_id=p_company and workforce_id=p_workforce order by requested_at desc limit 1;
 -- Failed or ambiguous attempts require review, never blindly resend an external invitation.
 if rid is not null then return rid; end if;
 if exists(select 1 from public.workforce_amazon_portal_links where company_id=p_company and workforce_id=p_workforce) then return null; end if;
 insert into public.workforce_amazon_invitation_requests(company_id,workforce_id,station_id,source_portal,amazon_email,first_name,last_name,requested_by)
 values(p_company,p_workforce,pilot.station_id,'workforce',w.email,split_part(w.full_name,' ',1),coalesce(nullif(btrim(regexp_replace(w.full_name,'^[^ ]+ *','')),''),split_part(w.full_name,' ',1)),pilot.created_by) returning id into rid;
 insert into public.workforce_amazon_pilot_history(company_id,workforce_id,event,evidence) values(p_company,p_workforce,'invitation_queued',jsonb_build_object('request_id',rid));
 return rid;
end $$;
revoke all on function public.workforce_queue_amazon_pilot(uuid,uuid) from public,anon,authenticated;
grant execute on function public.workforce_queue_amazon_pilot(uuid,uuid) to service_role;

-- Exact identifiers only. Cache evidence is dated; its absence is never activation.
create function public.workforce_amazon_pilot_sources(p_company uuid,p_workforce uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 with person as (
 select p.*,s.station_code,w.email from public.workforce_amazon_pilots p join public.workforce w on w.id=p.workforce_id and w.company_id=p.company_id join public.stations s on s.id=p.station_id and s.company_id=p.company_id where p.company_id=p_company and p.workforce_id=p_workforce
 ), identity as (
 select p.*,coalesce(l.amazon_provider_id,case when i.status='sent' then i.external_reference end) provider_id,l.transporter_id linked_transporter,i.status invitation_status,i.error_message invitation_error,i.completed_at invitation_at
 from person p left join public.workforce_amazon_portal_links l on l.company_id=p.company_id and l.workforce_id=p.workforce_id
 left join lateral(select * from public.workforce_amazon_invitation_requests x where x.company_id=p.company_id and x.workforce_id=p.workforce_id order by x.requested_at desc limit 1)i on true
 ), evidence as (
 select p.*,coalesce(r.raw_data,'{}'::jsonb)||coalesce(r.normalized_data,'{}'::jsonb) report,r.created_at report_synced_at,r.work_date report_date,coalesce(nullif(p.linked_transporter,''),a.transporter_id) transporter_id,a.operational_status lsc_status
 from identity p left join public.workforce_associates a on a.provider_id=p.provider_id
 left join lateral(select * from public.report_import_rows x where x.company_id=p.company_id and x.source_type='da_inapp_onboarding' and coalesce(x.normalized_data->>'accountid',x.raw_data->>'accountid')=p.provider_id and x.work_date>=p.reported_on and x.work_date<=(now() at time zone 'Asia/Kolkata')::date order by x.work_date desc,x.created_at desc limit 1)r on true
 ), snapshot as (
 select c.cache_key,c.created_at,c.payload from public.api_response_cache c,person p where c.cache_key like 'exec:recon:'||p.station_code||':%' and c.created_at >= greatest(p.created_at-interval '1 day',now()-interval '7 days') order by c.created_at desc limit 1
 ), drivers as (
 select d,s.created_at,s.cache_key from snapshot s cross join lateral jsonb_array_elements(coalesce(s.payload->'drivers','[]')) d
 ), matched as (
 select e.*, (select count(distinct d->>'employeeId') from drivers where d->>'tasId'=e.transporter_id and nullif(d->>'employeeId','') is not null) matches,
 (select min(d->>'employeeId') from drivers where d->>'tasId'=e.transporter_id and nullif(d->>'employeeId','') is not null) employee_id,
 (select max(created_at) from drivers where d->>'tasId'=e.transporter_id) scc_at,
 (select max(cache_key) from drivers where d->>'tasId'=e.transporter_id) scc_source
 from evidence e
 )
 select jsonb_build_object('providerId',provider_id,'transporterId',transporter_id,'lscStatus',lsc_status,'invitationStatus',invitation_status,'invitationError',invitation_error,'invitationAt',invitation_at,'report',report,'reportDate',report_date,'reportSyncedAt',report_synced_at,'employeeId',case when matches=1 then employee_id end,'sccAt',scc_at,'sccSource',scc_source,
 'conflict',matches>1 or (nullif(report->>'transporter_id','') is not null and transporter_id is not null and report->>'transporter_id'<>transporter_id) or (select count(distinct a.transporter_id) from public.workforce_associates a where a.provider_id=m.provider_id)>1 or exists(select 1 from public.field_executive_provider_mappings pm where pm.company_id=p_company and pm.provider_member_id=m.employee_id and pm.workforce_id is distinct from p_workforce and pm.status='active' and pm.effective_from <= (now() at time zone 'Asia/Kolkata')::date and (pm.effective_to is null or pm.effective_to >= (now() at time zone 'Asia/Kolkata')::date)) or exists(select 1 from drivers d where d.d->>'employeeId'=m.employee_id and d.d->>'tasId'<>m.transporter_id) or exists(select 1 from public.workforce_amazon_portal_links l where l.company_id=p_company and l.workforce_id<>p_workforce and (l.amazon_provider_id=m.provider_id or l.transporter_id=m.transporter_id)),
 'firstDelivery',case when matches=1 then (select min(c.work_date) from public.cps_shipment_daily c where c.company_id=p_company and c.provider_employee_id=m.employee_id and c.station_code=m.station_code and c.work_date>=greatest(m.reported_on,right(m.scc_source,10)::date) and c.total_delivery>0) end)
 from matched m limit 1
$$;
revoke all on function public.workforce_amazon_pilot_sources(uuid,uuid) from public,anon,authenticated;
grant execute on function public.workforce_amazon_pilot_sources(uuid,uuid) to service_role;
create function public.workforce_update_amazon_pilot(p_company uuid,p_actor uuid,p_workforce uuid,p_action text,p_data jsonb,p_locations uuid[]) returns void language plpgsql security invoker set search_path='' as $$
declare p public.workforce_amazon_pilots; days integer; day date; note text:=btrim(p_data->>'notes');
begin
 select * into p from public.workforce_amazon_pilots where workforce_id=p_workforce and company_id=p_company for update;
 if not found or p.closed_at is not null or p_actor is null then raise exception 'Trial is unavailable'; end if;
 if p_locations is not null and not(p.station_id=any(p_locations)) then raise exception 'Station outside your access'; end if;
 if p_action='trial' then
  day:=(p_data->>'work_date')::date;
  if day<p.reported_on or day>(now() at time zone 'Asia/Kolkata')::date then raise exception 'Choose a trial date between arrival and today'; end if;
  insert into public.workforce_amazon_pilot_trials(workforce_id,company_id,work_date,minutes,notes,recorded_by) values(p_workforce,p_company,day,(p_data->>'minutes')::integer,coalesce(note,''),p_actor)
  on conflict(workforce_id,work_date) do update set minutes=excluded.minutes,notes=excluded.notes,recorded_by=excluded.recorded_by;
 elsif p_action='plan' then
  if p.trial_completed_at is not null then raise exception 'Readiness has already been confirmed'; end if;
  update public.workforce_amazon_pilots set trial_days=(p_data->>'trial_days')::integer where workforce_id=p_workforce;
 elsif p_action='ready' then
  select count(*) into days from public.workforce_amazon_pilot_trials where workforce_id=p_workforce;
  if days<p.trial_days and length(coalesce(note,''))<10 then raise exception 'Record a reason for early readiness (for example, prior delivery experience)'; end if;
  update public.workforce_amazon_pilots set trial_completed_at=coalesce(trial_completed_at,now()),readiness_note=note where workforce_id=p_workforce;
 elsif p_action='close' then
  if length(coalesce(note,''))<5 then raise exception 'Record a reason for closing the trial'; end if;
  if exists(select 1 from public.workforce_amazon_invitation_requests where workforce_id=p_workforce and status='processing') then raise exception 'The invitation is being processed. Wait for it to finish before closing.'; end if;
  update public.workforce_amazon_invitation_requests set status='failed',error_code='pilot_closed',error_message='Trial closed before invitation delivery',updated_at=now() where workforce_id=p_workforce and status='queued';
  update public.workforce_amazon_pilots set closed_at=now() where workforce_id=p_workforce;
  update public.biometric_enrolments set status='Inactive',effective_to=(now() at time zone 'Asia/Kolkata')::date where company_id=p_company and profile_type='workforce' and account_id=p_workforce;
 else raise exception 'Unknown onboarding action'; end if;
 insert into public.workforce_amazon_pilot_history(company_id,workforce_id,event,evidence) values(p_company,p_workforce,p_action,p_data||jsonb_build_object('actor',p_actor));
end $$;
revoke all on function public.workforce_update_amazon_pilot(uuid,uuid,uuid,text,jsonb,uuid[]) from public,anon,authenticated;
grant execute on function public.workforce_update_amazon_pilot(uuid,uuid,uuid,text,jsonb,uuid[]) to service_role;
commit;
