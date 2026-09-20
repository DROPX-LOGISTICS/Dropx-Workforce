-- Additive: existing invitation tokens, canonical identities and paid history stay intact.
create table public.workforce_training_policies (
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),station_id uuid not null references public.stations(id),
  name text not null check(length(btrim(name)) between 3 and 120),daily_rate numeric(12,2) not null check(daily_rate>0 and daily_rate<'Infinity'::numeric),
  minimum_minutes integer not null check(minimum_minutes between 1 and 1440),policy_reference text not null check(length(btrim(policy_reference)) between 3 and 1000),
  effective_from date not null,effective_to date check(effective_to>=effective_from),is_active boolean not null default true,
  created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),retired_by uuid references auth.users(id),retired_at timestamptz,
  unique(company_id,station_id,name,effective_from)
);
create index workforce_training_policies_station on public.workforce_training_policies(company_id,station_id,is_active);
alter table public.workforce_training_policies enable row level security;
revoke all on public.workforce_training_policies from public,anon,authenticated;
grant select,insert on public.workforce_training_policies to service_role;
grant update(is_active,retired_by,retired_at) on public.workforce_training_policies to service_role;
create function public.workforce_save_training_policy(p_company uuid,p_actor uuid,p_policy uuid,p_payload jsonb,p_locations uuid[])
returns uuid language plpgsql security invoker set search_path='' as $$
declare candidate public.workforce_training_policies; policy_id uuid;
begin
  if p_actor is null then raise exception 'Reviewer is required'; end if;
  if p_policy is not null then
    select * into candidate from public.workforce_training_policies where id=p_policy and company_id=p_company for update;
    if not found then raise exception 'Training policy not found'; end if;
  else candidate:=jsonb_populate_record(null::public.workforce_training_policies,p_payload); end if;
  if not exists(select 1 from public.stations where id=candidate.station_id and company_id=p_company) then raise exception 'Choose a station in this company'; end if;
  if p_locations is not null and not(candidate.station_id=any(p_locations)) then raise exception 'Station is outside your access scope'; end if;
  if p_policy is not null then
    update public.workforce_training_policies set is_active=false,retired_by=p_actor,retired_at=now() where id=p_policy and is_active;
    return p_policy;
  end if;
  insert into public.workforce_training_policies(company_id,station_id,name,daily_rate,minimum_minutes,policy_reference,effective_from,effective_to,created_by)
    values(p_company,candidate.station_id,candidate.name,candidate.daily_rate,candidate.minimum_minutes,candidate.policy_reference,candidate.effective_from,candidate.effective_to,p_actor) returning id into policy_id;
  return policy_id;
end $$;
revoke all on function public.workforce_save_training_policy(uuid,uuid,uuid,jsonb,uuid[]) from public,anon,authenticated;
grant execute on function public.workforce_save_training_policy(uuid,uuid,uuid,jsonb,uuid[]) to service_role;

create table public.workforce_joining_plans (
  workforce_id uuid primary key references public.workforce(id),
  company_id uuid not null references public.companies(id),
  station_id uuid not null references public.stations(id),
  training_policy_id uuid references public.workforce_training_policies(id),
  mode text not null check (mode in ('training','direct')),
  eligible_from date not null,
  daily_rate numeric(12,2),
  minimum_minutes integer not null check (minimum_minutes between 1 and 1440),
  terms_reference text not null check (length(btrim(terms_reference)) between 3 and 1000),
  terms_accepted_on date not null check (terms_accepted_on <= eligible_from),
  training_completed_on date,
  closed_on date,
  provider_stage text not null default 'not_started' check (provider_stage in ('not_started','email_setup','documents_pending','invitation_sent','invitation_accepted','app_details','submitted','verification_pending','background_check','course_pending','provisioning','activated','blocked','withdrawn')),
  provider_reference text,
  provider_submitted_on date,
  provider_activated_on date,
  next_follow_up_on date,
  owner_note text,
  contact_email text check (contact_email is null or length(contact_email) between 3 and 254),
  assigned_to text check (assigned_to is null or length(assigned_to)<=160),
  amazon_tasks jsonb not null default '{}'::jsonb check (jsonb_typeof(amazon_tasks)='object'),
  provider_profile_id text check (provider_profile_id is null or provider_profile_id ~ '^amzn1\.flex\.provider\.v1\.[0-9a-f-]{36}$'),
  invitation_first_name text check(invitation_first_name is null or length(invitation_first_name)<=120),
  invitation_last_name text check(invitation_last_name is null or length(invitation_last_name)<=120),
  invitation_suffix text check(invitation_suffix is null or length(invitation_suffix)<=20),
  version integer not null default 1,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint joining_rate_check check ((mode='direct' and daily_rate is null) or (mode='training' and daily_rate is not null and daily_rate>0 and daily_rate<'Infinity'::numeric)),
  constraint joining_completion_check check (training_completed_on is null or training_completed_on>=eligible_from),
  constraint joining_close_check check (closed_on is null or closed_on>=eligible_from),
  constraint joining_activation_check check (provider_stage<>'activated' or (provider_activated_on is not null and nullif(btrim(provider_reference),'') is not null)),
  constraint joining_provider_dates_check check (provider_activated_on is null or provider_submitted_on is null or provider_activated_on>=provider_submitted_on)
);
create index workforce_joining_company_station on public.workforce_joining_plans(company_id,station_id);
create table public.workforce_joining_events (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  workforce_id uuid not null references public.workforce(id), event_code text not null,
  actor_id uuid references auth.users(id), actor_name text not null,
  details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index workforce_joining_history on public.workforce_joining_events(company_id,workforce_id,created_at desc);
alter table public.workforce_joining_plans enable row level security;
alter table public.workforce_joining_events enable row level security;
revoke all on public.workforce_joining_plans,public.workforce_joining_events from public,anon,authenticated;
grant select,insert,update on public.workforce_joining_plans to service_role;
grant select,insert on public.workforce_joining_events to service_role;

create function public.workforce_save_joining_plan(p_company uuid,p_actor uuid,p_actor_name text,p_workforce uuid,p_expected_version integer,p_plan jsonb,p_locations uuid[])
returns void language plpgsql security invoker set search_path='' as $$
declare w public.workforce; old_plan public.workforce_joining_plans; candidate public.workforce_joining_plans; policy public.workforce_training_policies; financial_change boolean; today date:=(now() at time zone 'Asia/Kolkata')::date;
begin
  select * into w from public.workforce where company_id=p_company and id=p_workforce and deleted_at is null and migration_state<>'reclassified' for update;
  if not found or p_actor is null then raise exception 'Workforce profile and reviewer are required'; end if;
  if w.onboarding_status is null or w.onboarding_status not in ('approved','active') then raise exception 'Approve the submitted profile before configuring joining terms'; end if;
  candidate:=jsonb_populate_record(null::public.workforce_joining_plans,p_plan);
  if candidate.station_id is distinct from w.location_id or not exists(select 1 from public.stations where id=candidate.station_id and company_id=p_company) then raise exception 'Training station must match the approved Workforce station'; end if;
  if p_locations is not null and not(candidate.station_id=any(p_locations)) then raise exception 'Joining plan is outside your station scope'; end if;
  if candidate.terms_accepted_on>today or candidate.training_completed_on>today or candidate.closed_on>today or candidate.provider_submitted_on>today or candidate.provider_activated_on>today then raise exception 'Completed events cannot be future dated'; end if;
  select * into old_plan from public.workforce_joining_plans where workforce_id=p_workforce and company_id=p_company for update;
  if coalesce(old_plan.version,0) is distinct from p_expected_version then raise exception 'Joining plan changed. Refresh before saving'; end if;
  if candidate.mode='training' then
    select * into policy from public.workforce_training_policies where id=candidate.training_policy_id and company_id=p_company and station_id=candidate.station_id for share;
    if not found or (not policy.is_active and candidate.training_policy_id is distinct from old_plan.training_policy_id)
      or candidate.eligible_from<policy.effective_from or (policy.effective_to is not null and candidate.eligible_from>policy.effective_to) then raise exception 'Choose an eligible training policy from this station master'; end if;
    if candidate.daily_rate is distinct from policy.daily_rate or candidate.minimum_minutes is distinct from policy.minimum_minutes then raise exception 'Training terms must match the selected master policy'; end if;
  elsif candidate.training_policy_id is not null then raise exception 'Direct joining does not use a training policy'; end if;
  financial_change:=old_plan.workforce_id is null or row(old_plan.mode,old_plan.station_id,old_plan.training_policy_id,old_plan.daily_rate,old_plan.minimum_minutes,old_plan.eligible_from,old_plan.terms_accepted_on,old_plan.training_completed_on,old_plan.closed_on)
    is distinct from row(candidate.mode,candidate.station_id,candidate.training_policy_id,candidate.daily_rate,candidate.minimum_minutes,candidate.eligible_from,candidate.terms_accepted_on,candidate.training_completed_on,candidate.closed_on);
  if financial_change and exists(select 1 from public.workforce_payroll_items i join public.workforce_payroll_runs r on r.id=i.payroll_run_id
    where i.company_id=p_company and i.workforce_id=p_workforce and r.status in ('review','approved','paid') and r.period_end>=least(candidate.eligible_from,coalesce(old_plan.eligible_from,candidate.eligible_from))) then
    raise exception 'A submitted or settled payroll locks these terms. Use a reviewed correction; do not rewrite payment history';
  end if;
  insert into public.workforce_joining_plans(workforce_id,company_id,station_id,mode,eligible_from,daily_rate,minimum_minutes,terms_reference,terms_accepted_on,training_completed_on,closed_on,provider_stage,provider_reference,provider_submitted_on,provider_activated_on,next_follow_up_on,owner_note,contact_email,assigned_to,version,updated_by)
  values(p_workforce,p_company,candidate.station_id,candidate.mode,candidate.eligible_from,candidate.daily_rate,candidate.minimum_minutes,candidate.terms_reference,candidate.terms_accepted_on,candidate.training_completed_on,candidate.closed_on,candidate.provider_stage,candidate.provider_reference,candidate.provider_submitted_on,candidate.provider_activated_on,candidate.next_follow_up_on,candidate.owner_note,candidate.contact_email,candidate.assigned_to,coalesce(old_plan.version,0)+1,p_actor)
  on conflict(workforce_id) do update set station_id=excluded.station_id,mode=excluded.mode,eligible_from=excluded.eligible_from,daily_rate=excluded.daily_rate,minimum_minutes=excluded.minimum_minutes,terms_reference=excluded.terms_reference,terms_accepted_on=excluded.terms_accepted_on,training_completed_on=excluded.training_completed_on,closed_on=excluded.closed_on,provider_stage=excluded.provider_stage,provider_reference=excluded.provider_reference,provider_submitted_on=excluded.provider_submitted_on,provider_activated_on=excluded.provider_activated_on,next_follow_up_on=excluded.next_follow_up_on,owner_note=excluded.owner_note,contact_email=excluded.contact_email,assigned_to=excluded.assigned_to,version=excluded.version,updated_by=p_actor,updated_at=now();
  update public.workforce_joining_plans set amazon_tasks=coalesce(candidate.amazon_tasks,'{}'::jsonb),provider_profile_id=candidate.provider_profile_id,
    invitation_first_name=candidate.invitation_first_name,invitation_last_name=candidate.invitation_last_name,invitation_suffix=candidate.invitation_suffix,training_policy_id=candidate.training_policy_id where workforce_id=p_workforce;
  insert into public.workforce_joining_events(company_id,workforce_id,event_code,actor_id,actor_name,details)
  values(p_company,p_workforce,case when old_plan.workforce_id is null then 'joining_terms_confirmed' else 'joining_plan_updated' end,p_actor,coalesce(nullif(btrim(p_actor_name),''),'Workforce reviewer'),jsonb_build_object('before',to_jsonb(old_plan),'after',p_plan,'version',coalesce(old_plan.version,0)+1));
end $$;
revoke all on function public.workforce_save_joining_plan(uuid,uuid,text,uuid,integer,jsonb,uuid[]) from public,anon,authenticated;
grant execute on function public.workforce_save_joining_plan(uuid,uuid,text,uuid,integer,jsonb,uuid[]) to service_role;

-- Block retroactive mapping changes against submitted payroll, including other portals.
create function public.workforce_joining_mapping_person(p_company uuid,p_workforce uuid,p_field_executive uuid,p_contractor uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare identities uuid[];
begin
  if p_workforce is not null then return p_workforce; end if;
  select array_agg(id) into identities from public.workforce where company_id=p_company and deleted_at is null and migration_state<>'reclassified'
    and ((source_profile_type='field_executive' and source_profile_id=p_field_executive) or (source_profile_type='contractor' and source_profile_id=p_contractor));
  if cardinality(identities)>1 then raise exception 'Legacy mapping identity is ambiguous. Reconcile the canonical person first'; end if;
  return identities[1];
end $$;
revoke all on function public.workforce_joining_mapping_person(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.workforce_joining_mapping_person(uuid,uuid,uuid,uuid) to service_role;
create function public.workforce_joining_mapping_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare affected uuid; old_affected uuid; starting date; company uuid;
begin
  if TG_OP in ('UPDATE','DELETE') then old_affected:=public.workforce_joining_mapping_person(old.company_id,old.workforce_id,old.field_executive_id,old.contractor_id); end if;
  if TG_OP='DELETE' then affected:=old_affected; company:=old.company_id; starting:=old.effective_from;
  else affected:=public.workforce_joining_mapping_person(new.company_id,new.workforce_id,new.field_executive_id,new.contractor_id); company:=new.company_id; starting:=new.effective_from;
    if TG_OP='UPDATE' then
      if (to_jsonb(old)-'updated_at') is not distinct from (to_jsonb(new)-'updated_at') then return new; end if;
      if old_affected is distinct from affected and exists(select 1 from public.workforce_joining_plans where workforce_id=old_affected) then raise exception 'Do not reassign a joining profile mapping; close and create an audited mapping'; end if;
      starting:=least(starting,old.effective_from);
    end if;
  end if;
  if exists(select 1 from public.workforce_joining_plans where workforce_id=affected and company_id=company) then
    perform 1 from public.workforce where id=affected and company_id=company for update;
    if exists(select 1 from public.workforce_payroll_items i join public.workforce_payroll_runs r on r.id=i.payroll_run_id
      where i.company_id=company and i.workforce_id=affected and r.status in ('review','approved','paid') and r.period_end>=starting) then
      raise exception 'Mapping affects submitted payroll. Return the run to draft or use a reviewed financial correction';
    end if;
    update public.workforce_joining_plans set version=version+1,updated_at=now() where workforce_id=affected and company_id=company;
  end if;
  if TG_OP='DELETE' then return old; end if; return new;
end $$;
revoke all on function public.workforce_joining_mapping_guard() from public,anon,authenticated;
grant execute on function public.workforce_joining_mapping_guard() to service_role;
create trigger workforce_joining_mapping_guard before insert or update or delete on public.field_executive_provider_mappings for each row execute function public.workforce_joining_mapping_guard();

-- Same atomic mapping operation, with reviewer attribution and effective-date history.
create function public.workforce_save_joining_mapping(p_company uuid,p_actor uuid,p_workforce uuid,p_mapping uuid,p_dropx text,p_payload jsonb,p_locations uuid[],p_actor_name text)
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform public.workforce_save_mapping(p_company,p_actor,p_workforce,p_mapping,p_dropx,p_payload,p_locations);
  -- Approved trainees become operational only after a verified provider activation
  -- and an effective mapping. Future-dated mappings do not activate someone early.
  if (p_payload->>'effective_from')::date <= (now() at time zone 'Asia/Kolkata')::date
    and ((p_payload->>'effective_to') is null or (p_payload->>'effective_to')::date >= (now() at time zone 'Asia/Kolkata')::date)
    and exists(select 1 from public.workforce_joining_plans where workforce_id=p_workforce and company_id=p_company and provider_stage='activated' and closed_on is null) then
    update public.workforce set onboarding_status='active',is_active=true,lifecycle_status='active',provider_id_status='created',provider_employee_id=p_payload->>'provider_member_id',updated_at=now()
      where id=p_workforce and company_id=p_company and onboarding_status='approved' and lifecycle_status='onboarding' and last_working_date is null;
  end if;
  insert into public.workforce_joining_events(company_id,workforce_id,event_code,actor_id,actor_name,details)
  values(p_company,p_workforce,'provider_mapping_saved',p_actor,coalesce(nullif(btrim(p_actor_name),''),'Workforce mapping reviewer'),jsonb_build_object('effective_from',p_payload->>'effective_from','effective_to',p_payload->>'effective_to','provider_id',p_payload->>'provider_id','provider_member_id',p_payload->>'provider_member_id','station_id',p_payload->>'station_id'));
end $$;
revoke all on function public.workforce_save_joining_mapping(uuid,uuid,uuid,uuid,text,jsonb,uuid[],text) from public,anon,authenticated;
grant execute on function public.workforce_save_joining_mapping(uuid,uuid,uuid,uuid,text,jsonb,uuid[],text) to service_role;

alter table public.workforce_payroll_lines drop constraint workforce_payroll_lines_source_check;
alter table public.workforce_payroll_lines add constraint workforce_payroll_lines_source_check check(source_type in ('shipment','adjustment','training'));
alter table public.workforce_payroll_lines drop constraint workforce_payroll_lines_calculation_source_check;
alter table public.workforce_payroll_lines add constraint workforce_payroll_lines_calculation_source_check check(calculation_source in ('rate_card','mapped_rate','imported_payout','adjustment','unresolved','training_attendance'));

-- A draft may be stale. Recheck at review/approval while holding the same worker
-- locks used by plan and mapping updates; paid snapshots are never recalculated.
create function public.workforce_joining_payroll_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.status not in ('review','approved') or new.status=old.status then return new; end if;
  perform 1 from public.workforce w where w.company_id=new.company_id and w.id in
    (select i.workforce_id from public.workforce_payroll_items i where i.payroll_run_id=new.id and i.status<>'excluded') order by w.id for update;
  if exists(select 1 from public.workforce_payroll_lines l
    join public.workforce_payroll_items i on i.id=l.payroll_item_id and i.status<>'excluded'
    join public.workforce_joining_plans p on p.workforce_id=l.workforce_id and p.company_id=l.company_id
    where l.payroll_run_id=new.id and (l.calculation_snapshot->>'joining_plan_version')::integer is distinct from p.version) then
    raise exception 'Joining terms or provider mapping changed since calculation. Recalculate the draft before review';
  end if;
  if exists(select 1 from public.workforce_payroll_lines l
    join public.workforce_payroll_items i on i.id=l.payroll_item_id and i.status<>'excluded'
    left join public.attendance_daily a on a.id=l.source_id and a.company_id=l.company_id
    where l.payroll_run_id=new.id and l.source_type='training'
    and (a.id is null or a.updated_at is distinct from (l.calculation_snapshot->>'attendance_updated_at')::timestamptz
      or exists(select 1 from public.attendance_punches b where b.company_id=l.company_id and b.enrolment_id=a.enrolment_id and b.punch_date=a.punch_date and b.is_flagged))) then
    raise exception 'Training attendance changed or contains a flagged punch. Recalculate and review';
  end if;
  return new;
end $$;
revoke all on function public.workforce_joining_payroll_guard() from public,anon,authenticated;
grant execute on function public.workforce_joining_payroll_guard() to service_role;
create trigger workforce_joining_payroll_guard before update of status on public.workforce_payroll_runs for each row execute function public.workforce_joining_payroll_guard();

create table public.workforce_amazon_station_settings (
  station_id uuid primary key references public.stations(id),company_id uuid not null references public.companies(id),
  service_area_code text not null check(service_area_code ~ '^[A-Z0-9_-]{2,24}$'),
  service_type text not null check(service_type='Amazon Logistics'),
  supervisor_alias text not null check(supervisor_alias ~ '^[a-zA-Z0-9._-]{2,80}$'),
  contract_type text not null check(contract_type in ('Independent Contractor','Subcontractor','DSP Employed')),
  version integer not null default 1,updated_by uuid not null references auth.users(id),updated_at timestamptz not null default now()
);
create index workforce_amazon_station_company on public.workforce_amazon_station_settings(company_id);
create table public.workforce_amazon_station_events (
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),station_id uuid not null references public.stations(id),
  actor_id uuid not null references auth.users(id),actor_name text not null,details jsonb not null,created_at timestamptz not null default now()
);
create index workforce_amazon_station_history on public.workforce_amazon_station_events(company_id,station_id,created_at desc);
alter table public.workforce_amazon_station_settings enable row level security;
alter table public.workforce_amazon_station_events enable row level security;
revoke all on public.workforce_amazon_station_settings,public.workforce_amazon_station_events from public,anon,authenticated;
grant select,insert,update on public.workforce_amazon_station_settings to service_role;
grant select,insert on public.workforce_amazon_station_events to service_role;
create function public.workforce_save_amazon_station(p_company uuid,p_actor uuid,p_actor_name text,p_station uuid,p_version integer,p_settings jsonb,p_locations uuid[])
returns void language plpgsql security invoker set search_path='' as $$
declare old_settings public.workforce_amazon_station_settings; candidate public.workforce_amazon_station_settings;
begin
  perform 1 from public.stations where company_id=p_company and id=p_station for update;
  if not found or p_actor is null then raise exception 'Choose a station in this company'; end if;
  if p_locations is not null and not(p_station=any(p_locations)) then raise exception 'Station is outside your access scope'; end if;
  select * into old_settings from public.workforce_amazon_station_settings where station_id=p_station and company_id=p_company;
  if coalesce(old_settings.version,0) is distinct from p_version then raise exception 'Station settings changed. Refresh and try again'; end if;
  candidate:=jsonb_populate_record(null::public.workforce_amazon_station_settings,p_settings);
  insert into public.workforce_amazon_station_settings(station_id,company_id,service_area_code,service_type,supervisor_alias,contract_type,version,updated_by)
    values(p_station,p_company,candidate.service_area_code,candidate.service_type,candidate.supervisor_alias,candidate.contract_type,coalesce(old_settings.version,0)+1,p_actor)
    on conflict(station_id) do update set service_area_code=excluded.service_area_code,service_type=excluded.service_type,supervisor_alias=excluded.supervisor_alias,contract_type=excluded.contract_type,version=excluded.version,updated_by=p_actor,updated_at=now();
  insert into public.workforce_amazon_station_events(company_id,station_id,actor_id,actor_name,details)
    values(p_company,p_station,p_actor,p_actor_name,jsonb_build_object('before',to_jsonb(old_settings),'after',p_settings));
end $$;
revoke all on function public.workforce_save_amazon_station(uuid,uuid,text,uuid,integer,jsonb,uuid[]) from public,anon,authenticated;
grant execute on function public.workforce_save_amazon_station(uuid,uuid,text,uuid,integer,jsonb,uuid[]) to service_role;
