begin;

-- Station-owned rules. Existing stations remain deliberately unconfigured until an
-- owner confirms the mailbox pattern used by that operation.
alter table public.workforce_amazon_station_settings
  add column if not exists associate_email_pattern text,
  add column if not exists invitation_enabled boolean not null default false;

alter table public.workforce_amazon_station_settings
  add constraint workforce_amazon_email_pattern_check
  check (
    associate_email_pattern is null or (
      length(btrim(associate_email_pattern)) between 8 and 254
      and position('@' in associate_email_pattern) > 1
      and position('{station_code}' in lower(associate_email_pattern)) > 0
      and (
        position('{first_name}' in lower(associate_email_pattern)) > 0
        or position('{full_name}' in lower(associate_email_pattern)) > 0
      )
    )
  ) not valid;

create table public.workforce_amazon_status_guidance (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  match_text text not null check (length(btrim(match_text)) between 2 and 160),
  stage_code text not null check (stage_code in (
    'invitation','account','basic_details','documents','licence','background_check',
    'video_verification','learning','provisioning','activated','failed','other'
  )),
  instruction text not null check (length(btrim(instruction)) between 5 and 1000),
  priority integer not null default 100 check (priority between 1 and 1000),
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,match_text)
);
create index workforce_amazon_guidance_match on public.workforce_amazon_status_guidance(company_id,is_active,priority);
alter table public.workforce_amazon_status_guidance enable row level security;
revoke all on public.workforce_amazon_status_guidance from public,anon,authenticated;
grant select,insert,update,delete on public.workforce_amazon_status_guidance to service_role;

create table public.workforce_amazon_invitation_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  workforce_id uuid not null references public.workforce(id),
  station_id uuid not null references public.stations(id),
  source_portal text not null check (source_portal in ('workforce','ops_pulse','recruit')),
  amazon_email text not null check (amazon_email = lower(btrim(amazon_email)) and length(amazon_email) between 6 and 254),
  first_name text not null check (length(btrim(first_name)) between 1 and 120),
  last_name text,
  suffix text,
  status text not null default 'queued' check (status in ('queued','processing','sent','failed','cancelled')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 100),
  requested_by uuid not null references auth.users(id),
  requested_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by text,
  completed_at timestamptz,
  external_reference text,
  error_code text,
  error_message text,
  updated_at timestamptz not null default now()
);
create unique index workforce_amazon_invitation_open
  on public.workforce_amazon_invitation_requests(company_id,workforce_id)
  where status in ('queued','processing','sent');
create index workforce_amazon_invitation_queue
  on public.workforce_amazon_invitation_requests(company_id,status,requested_at);
create index workforce_amazon_invitation_station
  on public.workforce_amazon_invitation_requests(company_id,station_id,status);
alter table public.workforce_amazon_invitation_requests enable row level security;
revoke all on public.workforce_amazon_invitation_requests from public,anon,authenticated;
grant select,insert,update on public.workforce_amazon_invitation_requests to service_role;

create table public.workforce_payment_method_sources (
  payment_method_id uuid primary key references public.payment_methods(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  source_of_truth text not null check (source_of_truth in ('biometric_attendance','amazon_daily_shipment','manual_approved')),
  calculation_basis text not null check (calculation_basis in ('attendance_day','shipment_activity','manual')),
  version integer not null default 1,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);
create index workforce_payment_method_sources_company on public.workforce_payment_method_sources(company_id,source_of_truth);
alter table public.workforce_payment_method_sources enable row level security;
revoke all on public.workforce_payment_method_sources from public,anon,authenticated;
grant select,insert,update on public.workforce_payment_method_sources to service_role;

create or replace function public.workforce_amazon_email_from_pattern(
  p_pattern text,p_full_name text,p_station_code text
) returns text language plpgsql immutable set search_path='' as $$
declare clean_name text; first_name text; last_name text; result text;
begin
  clean_name:=lower(regexp_replace(btrim(coalesce(p_full_name,'')),'[^a-zA-Z0-9 ]','','g'));
  first_name:=regexp_replace(split_part(clean_name,' ',1),'[^a-z0-9]','','g');
  last_name:=regexp_replace(regexp_replace(clean_name,'^[^ ]+ *',''),'[^a-z0-9]','','g');
  result:=lower(btrim(coalesce(p_pattern,'')));
  result:=replace(result,'{first_name}',first_name);
  result:=replace(result,'{last_name}',last_name);
  result:=replace(result,'{full_name}',replace(clean_name,' ',''));
  result:=replace(result,'{station_code}',lower(regexp_replace(coalesce(p_station_code,''),'[^a-zA-Z0-9]','','g')));
  return result;
end $$;
revoke all on function public.workforce_amazon_email_from_pattern(text,text,text) from public,anon,authenticated;
grant execute on function public.workforce_amazon_email_from_pattern(text,text,text) to service_role;

create or replace function public.workforce_save_amazon_station(p_company uuid,p_actor uuid,p_actor_name text,p_station uuid,p_version integer,p_settings jsonb,p_locations uuid[])
returns void language plpgsql security invoker set search_path='' as $$
declare old_settings public.workforce_amazon_station_settings; candidate public.workforce_amazon_station_settings;
begin
  perform 1 from public.stations where company_id=p_company and id=p_station for update;
  if not found or p_actor is null then raise exception 'Choose a station in this company'; end if;
  if p_locations is not null and not(p_station=any(p_locations)) then raise exception 'Station is outside your access scope'; end if;
  select * into old_settings from public.workforce_amazon_station_settings where station_id=p_station and company_id=p_company;
  if coalesce(old_settings.version,0) is distinct from p_version then raise exception 'Station settings changed. Refresh and try again'; end if;
  candidate:=jsonb_populate_record(null::public.workforce_amazon_station_settings,p_settings);
  if candidate.invitation_enabled and candidate.associate_email_pattern is null then raise exception 'Configure the associate email pattern before enabling invitations'; end if;
  insert into public.workforce_amazon_station_settings(station_id,company_id,service_area_code,service_type,supervisor_alias,contract_type,associate_email_pattern,invitation_enabled,version,updated_by)
    values(p_station,p_company,candidate.service_area_code,candidate.service_type,candidate.supervisor_alias,candidate.contract_type,candidate.associate_email_pattern,candidate.invitation_enabled,coalesce(old_settings.version,0)+1,p_actor)
    on conflict(station_id) do update set service_area_code=excluded.service_area_code,service_type=excluded.service_type,supervisor_alias=excluded.supervisor_alias,contract_type=excluded.contract_type,associate_email_pattern=excluded.associate_email_pattern,invitation_enabled=excluded.invitation_enabled,version=excluded.version,updated_by=p_actor,updated_at=now();
  insert into public.workforce_amazon_station_events(company_id,station_id,actor_id,actor_name,details)
    values(p_company,p_station,p_actor,p_actor_name,jsonb_build_object('before',to_jsonb(old_settings),'after',p_settings));
end $$;

create function public.workforce_queue_amazon_invitation(
  p_company uuid,p_actor uuid,p_actor_name text,p_workforce uuid,p_email text,p_source_portal text,p_locations uuid[]
) returns uuid language plpgsql security invoker set search_path='' as $$
declare w public.workforce; s public.stations; cfg public.workforce_amazon_station_settings; request_id uuid; expected text; first_name text; last_name text;
begin
  select * into w from public.workforce where id=p_workforce and company_id=p_company and deleted_at is null and migration_state<>'reclassified' for update;
  if not found or w.onboarding_status not in ('approved','active') then raise exception 'Approve the associate before creating the Amazon ID'; end if;
  if p_locations is not null and (w.location_id is null or not(w.location_id=any(p_locations))) then raise exception 'Associate is outside your station scope'; end if;
  select * into s from public.stations where id=w.location_id and company_id=p_company;
  select * into cfg from public.workforce_amazon_station_settings where station_id=w.location_id and company_id=p_company;
  if cfg.station_id is null or not cfg.invitation_enabled or cfg.associate_email_pattern is null then raise exception 'Complete and enable the Amazon station invitation master first'; end if;
  if p_source_portal not in ('workforce','ops_pulse','recruit') then raise exception 'Choose a valid source portal'; end if;
  expected:=public.workforce_amazon_email_from_pattern(cfg.associate_email_pattern,w.full_name,s.station_code);
  if lower(btrim(p_email)) is distinct from expected then raise exception 'Email must match the station pattern. Expected %',expected; end if;
  first_name:=split_part(btrim(w.full_name),' ',1);
  last_name:=nullif(btrim(regexp_replace(btrim(w.full_name),'^[^ ]+ *','')),'');
  insert into public.workforce_amazon_invitation_requests(company_id,workforce_id,station_id,source_portal,amazon_email,first_name,last_name,requested_by)
    values(p_company,p_workforce,w.location_id,p_source_portal,expected,first_name,last_name,p_actor) returning id into request_id;
  insert into public.workforce_joining_plans(workforce_id,company_id,station_id,mode,eligible_from,daily_rate,minimum_minutes,terms_reference,terms_accepted_on,provider_stage,contact_email,invitation_first_name,invitation_last_name,version,updated_by)
    values(w.id,p_company,w.location_id,'direct',coalesce(w.date_of_join,(now() at time zone 'Asia/Kolkata')::date),null,1,'Amazon ID activation',coalesce(w.date_of_join,(now() at time zone 'Asia/Kolkata')::date),'email_setup',expected,first_name,last_name,1,p_actor)
    on conflict(workforce_id) do update set contact_email=excluded.contact_email,invitation_first_name=excluded.invitation_first_name,invitation_last_name=excluded.invitation_last_name,provider_stage='email_setup',version=public.workforce_joining_plans.version+1,updated_by=p_actor,updated_at=now();
  insert into public.workforce_joining_events(company_id,workforce_id,event_code,actor_id,actor_name,details)
    values(p_company,w.id,'amazon_invitation_queued',p_actor,coalesce(nullif(btrim(p_actor_name),''),'Workforce'),jsonb_build_object('request_id',request_id,'source_portal',p_source_portal,'amazon_email',expected));
  return request_id;
end $$;
revoke all on function public.workforce_queue_amazon_invitation(uuid,uuid,text,uuid,text,text,uuid[]) from public,anon,authenticated;
grant execute on function public.workforce_queue_amazon_invitation(uuid,uuid,text,uuid,text,text,uuid[]) to service_role;

create function public.workforce_retry_amazon_invitation(p_company uuid,p_actor uuid,p_request uuid,p_locations uuid[])
returns void language plpgsql security invoker set search_path='' as $$
declare r public.workforce_amazon_invitation_requests;
begin
  select * into r from public.workforce_amazon_invitation_requests where id=p_request and company_id=p_company for update;
  if not found or r.status<>'failed' then raise exception 'Only a failed invitation can be retried'; end if;
  if p_locations is not null and not(r.station_id=any(p_locations)) then raise exception 'Invitation is outside your station scope'; end if;
  update public.workforce_amazon_invitation_requests set status='queued',requested_by=p_actor,requested_at=now(),claimed_at=null,claimed_by=null,completed_at=null,error_code=null,error_message=null,updated_at=now() where id=r.id;
end $$;
revoke all on function public.workforce_retry_amazon_invitation(uuid,uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.workforce_retry_amazon_invitation(uuid,uuid,uuid,uuid[]) to service_role;

-- Worker contract. Invoke with the service role from the Cloudflare worker.
create function public.workforce_claim_amazon_invitation(p_company uuid,p_worker text)
returns setof public.workforce_amazon_invitation_requests language plpgsql security invoker set search_path='' as $$
declare selected_id uuid;
begin
  select id into selected_id from public.workforce_amazon_invitation_requests
    where company_id=p_company and status='queued' order by requested_at,id for update skip locked limit 1;
  if selected_id is null then return; end if;
  return query update public.workforce_amazon_invitation_requests set status='processing',claimed_at=now(),claimed_by=left(btrim(p_worker),160),attempt_count=attempt_count+1,updated_at=now() where id=selected_id returning *;
end $$;
revoke all on function public.workforce_claim_amazon_invitation(uuid,text) from public,anon,authenticated;
grant execute on function public.workforce_claim_amazon_invitation(uuid,text) to service_role;

create function public.workforce_finish_amazon_invitation(p_company uuid,p_request uuid,p_status text,p_external_reference text,p_error_code text,p_error_message text)
returns void language plpgsql security invoker set search_path='' as $$
declare r public.workforce_amazon_invitation_requests;
begin
  if p_status not in ('sent','failed') then raise exception 'Worker result must be sent or failed'; end if;
  select * into r from public.workforce_amazon_invitation_requests where id=p_request and company_id=p_company for update;
  if not found or r.status<>'processing' then raise exception 'Invitation request is not being processed'; end if;
  update public.workforce_amazon_invitation_requests set status=p_status,completed_at=now(),external_reference=nullif(btrim(p_external_reference),''),error_code=nullif(btrim(p_error_code),''),error_message=nullif(btrim(p_error_message),''),updated_at=now() where id=r.id;
  update public.workforce_joining_plans set provider_stage=case when p_status='sent' then 'invitation_sent' else 'blocked' end,provider_reference=case when p_status='sent' then nullif(btrim(p_external_reference),'') else provider_reference end,next_follow_up_on=case when p_status='sent' then (now() at time zone 'Asia/Kolkata')::date+1 else (now() at time zone 'Asia/Kolkata')::date end,version=version+1,updated_at=now() where workforce_id=r.workforce_id and company_id=p_company;
end $$;
revoke all on function public.workforce_finish_amazon_invitation(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.workforce_finish_amazon_invitation(uuid,uuid,text,text,text,text) to service_role;

create function public.workforce_save_payment_method_v2(
  p_company_id uuid,p_actor uuid,p_method_id uuid,p_code text,p_name text,p_field_ids uuid[],p_source_of_truth text,p_calculation_basis text
) returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
  if p_source_of_truth not in ('biometric_attendance','amazon_daily_shipment','manual_approved') then raise exception 'Choose the payment source of truth'; end if;
  if (p_source_of_truth='biometric_attendance' and p_calculation_basis<>'attendance_day')
    or (p_source_of_truth='amazon_daily_shipment' and p_calculation_basis<>'shipment_activity')
    or (p_source_of_truth='manual_approved' and p_calculation_basis<>'manual') then raise exception 'Payment calculation does not match its source of truth'; end if;
  v_id:=public.workforce_save_payment_method(p_company_id,p_method_id,p_code,p_name,p_field_ids);
  insert into public.workforce_payment_method_sources(payment_method_id,company_id,source_of_truth,calculation_basis,updated_by)
    values(v_id,p_company_id,p_source_of_truth,p_calculation_basis,p_actor)
    on conflict(payment_method_id) do update set source_of_truth=excluded.source_of_truth,calculation_basis=excluded.calculation_basis,version=public.workforce_payment_method_sources.version+1,updated_by=p_actor,updated_at=now();
  return v_id;
end $$;
revoke all on function public.workforce_save_payment_method_v2(uuid,uuid,uuid,text,text,uuid[],text,text) from public,anon,authenticated;
grant execute on function public.workforce_save_payment_method_v2(uuid,uuid,uuid,text,text,uuid[],text,text) to service_role;

create function public.workforce_save_personal_payment_stage_v2(
  p_company uuid,p_actor uuid,p_actor_name text,p_workforce uuid,p_mapping uuid,p_expected timestamptz,
  p_mode text,p_from date,p_to date,p_method uuid,p_values jsonb,p_reason text,p_locations uuid[]
) returns void language plpgsql security invoker set search_path='' as $$
declare w public.workforce;m public.field_executive_provider_mappings;method public.payment_methods;source public.workforce_payment_method_sources;k text;v numeric;payload jsonb:='{}'::jsonb;replacement uuid;component_count integer;
begin
 select * into w from public.workforce where company_id=p_company and id=p_workforce and deleted_at is null and migration_state<>'reclassified' for update;
 if not found or w.onboarding_status not in ('approved','active') or p_actor is null then raise exception 'Choose an approved associate';end if;
 select * into m from public.field_executive_provider_mappings where company_id=p_company and id=p_mapping and workforce_id=p_workforce and status<>'cancelled' for update;
 if not found then raise exception 'Choose this associate''s canonical provider mapping';end if;
 if p_locations is not null and (w.location_id is null or m.station_id is null or not(w.location_id=any(p_locations)) or not(m.station_id=any(p_locations))) then raise exception 'Payment stage is outside your station scope';end if;
 if m.updated_at is distinct from p_expected then raise exception 'Payment mapping changed. Refresh before saving';end if;
 if p_mode not in ('next','edit') or p_from is null or p_to<p_from or p_from<m.effective_from or p_mode='next' and p_from<=m.effective_from or p_mode='edit' and p_from<>m.effective_from then raise exception 'Choose a valid dated payment stage';end if;
 if length(btrim(coalesce(p_reason,'')))<10 or length(p_reason)>1000 then raise exception 'Explain the agreed terms or reason for this change';end if;
 select * into method from public.payment_methods where id=p_method and company_id=p_company and is_active for share;
 select * into source from public.workforce_payment_method_sources where payment_method_id=p_method and company_id=p_company for share;
 if method.id is null or source.payment_method_id is null then raise exception 'Choose an active payment method with a configured source of truth';end if;
 select count(*) into component_count from public.payment_method_components where payment_method_id=method.id and company_id=p_company and is_active;
 if component_count=0 or (select count(*) from jsonb_object_keys(coalesce(p_values,'{}'::jsonb)))<>component_count then raise exception 'Complete exactly the fields configured for this payment method';end if;
 for k in select component_code from public.payment_method_components where payment_method_id=method.id and company_id=p_company and is_active order by sort_order loop
   if not(coalesce(p_values,'{}'::jsonb)?k) then raise exception 'Complete every configured payment field';end if;
   v:=(p_values->>k)::numeric;
   if v is null or v::text in ('NaN','Infinity','-Infinity') or v<0 or v>1000000 then raise exception 'Every payment value must be a valid nonnegative amount';end if;
   payload:=payload||jsonb_build_object(k,v);
 end loop;
 payload:=payload||jsonb_build_object('DROPX_PERSONAL_TERMS',1,'DROPX_SOURCE_OF_TRUTH',source.source_of_truth,'DROPX_CALCULATION_BASIS',source.calculation_basis);
 replacement:=case when p_mode='next' and m.effective_to is not null and m.effective_to<p_from then null else m.id end;
 perform public.workforce_save_joining_mapping(p_company,p_actor,p_workforce,replacement,w.dropx_id,jsonb_build_object('provider_id',m.provider_id,'station_id',m.station_id,'provider_member_id',m.provider_member_id,'effective_from',p_from,'effective_to',p_to,'payment_method_id',method.id,'payment_values',payload,'pay_type',method.code,'status',case when p_to is null then 'active' else 'closed' end),p_locations,p_actor_name);
 update public.field_executive_provider_mappings set reason=p_reason where company_id=p_company and workforce_id=p_workforce and provider_id=m.provider_id and provider_member_id=m.provider_member_id and station_id=m.station_id and effective_from=p_from and status<>'cancelled';
 insert into public.workforce_joining_events(company_id,workforce_id,event_code,actor_id,actor_name,details) values(p_company,p_workforce,'payment_stage_saved',p_actor,p_actor_name,jsonb_build_object('previous_mapping',to_jsonb(m),'from',p_from,'through',p_to,'payment_method_id',method.id,'payment_method_code',method.code,'source_of_truth',source.source_of_truth,'payment_values',payload,'reason',p_reason));
end $$;
revoke all on function public.workforce_save_personal_payment_stage_v2(uuid,uuid,text,uuid,uuid,timestamptz,text,date,date,uuid,jsonb,text,uuid[]) from public,anon,authenticated;
grant execute on function public.workforce_save_personal_payment_stage_v2(uuid,uuid,text,uuid,uuid,timestamptz,text,date,date,uuid,jsonb,text,uuid[]) to service_role;

commit;
