begin;

-- New email-alias pilots stay outside the canonical Workforce registry until
-- the provider returns a real Driver ID and Workforce explicitly promotes the
-- person. The shared invitation queue remains the Amazon worker contract.
create table public.workforce_amazon_email_pilot_candidates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  station_id uuid not null references public.stations(id),
  designation_id uuid not null references public.designations(id),
  full_name text not null check (length(btrim(full_name)) between 2 and 120),
  mobile text not null check (mobile ~ '^[0-9]{10}$'),
  biometric_id text not null check (length(btrim(biometric_id)) between 2 and 80),
  reported_on date not null,
  alias_email text not null unique check (
    alias_email = lower(btrim(alias_email))
    and alias_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and length(alias_email) between 6 and 90
  ),
  inbox_status text not null default 'reserved' check (
    inbox_status in ('reserved','routed','receiving','route_failed','suspended')
  ),
  routing_rule_id text check (routing_rule_id is null or length(routing_rule_id) <= 160),
  routing_error text check (routing_error is null or length(routing_error) <= 1000),
  routed_at timestamptz,
  last_message_at timestamptz,
  status text not null default 'ready' check (
    status in ('ready','queued','sent','failed','email_received','closed')
  ),
  duplicate_identity_detected boolean not null default false,
  duplicate_identity_summary text check (
    duplicate_identity_summary is null or length(duplicate_identity_summary) <= 500
  ),
  invitation_request_id uuid,
  closed_at timestamptz,
  close_reason text check (close_reason is null or length(close_reason) <= 1000),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index workforce_amazon_email_pilot_open_mobile
  on public.workforce_amazon_email_pilot_candidates(company_id,mobile)
  where closed_at is null;
create index workforce_amazon_email_pilot_station
  on public.workforce_amazon_email_pilot_candidates(company_id,station_id,status,created_at desc);

create table public.workforce_amazon_email_pilot_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  candidate_id uuid not null references public.workforce_amazon_email_pilot_candidates(id) on delete cascade,
  internet_message_id text not null check (length(internet_message_id) between 1 and 500),
  sender text not null check (length(sender) between 3 and 320),
  subject text not null default '' check (length(subject) <= 500),
  preview text not null default '' check (length(preview) <= 2000),
  action_url text check (action_url is null or (length(action_url) <= 2000 and action_url ~ '^https://')),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(candidate_id,internet_message_id)
);
create index workforce_amazon_email_pilot_message_candidate
  on public.workforce_amazon_email_pilot_messages(company_id,candidate_id,received_at desc);

alter table public.workforce_amazon_email_pilot_candidates enable row level security;
alter table public.workforce_amazon_email_pilot_messages enable row level security;
revoke all on public.workforce_amazon_email_pilot_candidates,
  public.workforce_amazon_email_pilot_messages from public,anon,authenticated;
grant select,insert,update on public.workforce_amazon_email_pilot_candidates,
  public.workforce_amazon_email_pilot_messages to service_role;

alter table public.workforce_amazon_invitation_requests
  add column email_pilot_candidate_id uuid
    references public.workforce_amazon_email_pilot_candidates(id),
  alter column workforce_id drop not null;
alter table public.workforce_amazon_invitation_requests
  add constraint workforce_amazon_invitation_subject_check
  check (num_nonnulls(workforce_id,email_pilot_candidate_id)=1) not valid;
alter table public.workforce_amazon_invitation_requests
  validate constraint workforce_amazon_invitation_subject_check;
create unique index workforce_amazon_invitation_open_email_pilot
  on public.workforce_amazon_invitation_requests(company_id,email_pilot_candidate_id)
  where email_pilot_candidate_id is not null
    and status in ('queued','processing','sent');
alter table public.workforce_amazon_email_pilot_candidates
  add constraint workforce_amazon_email_pilot_invitation_fk
  foreign key (invitation_request_id)
  references public.workforce_amazon_invitation_requests(id);

create function public.workforce_create_isolated_amazon_email_pilot(
  p_company uuid,
  p_actor uuid,
  p_data jsonb,
  p_locations uuid[]
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  candidate_id uuid := (p_data->>'id')::uuid;
  v_station_id uuid := (p_data->>'station_id')::uuid;
  v_designation_id uuid := (p_data->>'designation_id')::uuid;
  person_name text := btrim(p_data->>'full_name');
  person_mobile text := regexp_replace(coalesce(p_data->>'mobile',''),'[^0-9]','','g');
  reported date := (p_data->>'reported_on')::date;
  station_code text;
  email_pattern text;
  generated_email text;
  duplicate_summary text;
begin
  if p_actor is null
     or length(person_name) not between 2 and 120
     or person_mobile !~ '^[0-9]{10}$'
     or length(btrim(coalesce(p_data->>'biometric_id',''))) not between 2 and 80
     or reported > (now() at time zone 'Asia/Kolkata')::date
     or reported < (now() at time zone 'Asia/Kolkata')::date-7 then
    raise exception 'Enter valid arrival details within the last seven days';
  end if;
  if p_locations is not null and not(v_station_id=any(p_locations)) then
    raise exception 'Station outside your access';
  end if;
  if not exists (
    select 1 from public.designations d
    join public.designation_categories c on c.id=d.designation_category_id
    where d.id=v_designation_id and d.company_id=p_company and d.is_active
      and c.people_module='delivery_network'
  ) then raise exception 'Select a Workforce designation'; end if;

  select s.station_code,cfg.associate_email_pattern
    into station_code,email_pattern
  from public.stations s
  join public.workforce_amazon_station_settings cfg
    on cfg.company_id=s.company_id and cfg.station_id=s.id
  where s.company_id=p_company and s.id=v_station_id and s.is_active
    and cfg.invitation_enabled;
  if email_pattern is null or btrim(email_pattern)='' then
    raise exception 'Configure the backend email alias pattern for this station before starting the pilot';
  end if;

  generated_email := public.workforce_amazon_alias_from_pattern(
    email_pattern,person_name,station_code,
    lower(right(replace(candidate_id::text,'-',''),8))
  );
  if generated_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or length(generated_email)>90 then
    raise exception 'The configured backend email alias pattern produced an invalid address';
  end if;

  select left(w.full_name||' · '||coalesce(w.designation,'Existing Workforce role'),500)
    into duplicate_summary
  from public.workforce w
  where w.company_id=p_company and w.deleted_at is null
    and right(regexp_replace(w.mobile,'[^0-9]','','g'),10)=person_mobile
  order by w.updated_at desc nulls last,w.created_at desc
  limit 1;

  perform pg_advisory_xact_lock(hashtextextended(p_company::text||person_mobile,0));
  insert into public.workforce_amazon_email_pilot_candidates(
    id,company_id,station_id,designation_id,full_name,mobile,biometric_id,
    reported_on,alias_email,duplicate_identity_detected,
    duplicate_identity_summary,created_by
  ) values (
    candidate_id,p_company,v_station_id,v_designation_id,person_name,person_mobile,
    btrim(p_data->>'biometric_id'),reported,generated_email,
    duplicate_summary is not null,duplicate_summary,p_actor
  );
  return candidate_id;
end
$$;
revoke all on function public.workforce_create_isolated_amazon_email_pilot(uuid,uuid,jsonb,uuid[])
  from public,anon,authenticated;
grant execute on function public.workforce_create_isolated_amazon_email_pilot(uuid,uuid,jsonb,uuid[])
  to service_role;

create function public.workforce_queue_isolated_amazon_email_pilot(
  p_company uuid,
  p_actor uuid,
  p_candidate uuid,
  p_locations uuid[]
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  candidate public.workforce_amazon_email_pilot_candidates;
  request_id uuid;
  request_status text;
  first_name text;
  last_name text;
begin
  select * into candidate
  from public.workforce_amazon_email_pilot_candidates
  where id=p_candidate and company_id=p_company
  for update;
  if not found or candidate.closed_at is not null then raise exception 'Pilot candidate is unavailable'; end if;
  if p_actor is null then raise exception 'A Workforce actor is required'; end if;
  if p_locations is not null and not(candidate.station_id=any(p_locations)) then
    raise exception 'Station outside your access';
  end if;
  select id,status into request_id,request_status
  from public.workforce_amazon_invitation_requests
  where company_id=p_company and email_pilot_candidate_id=p_candidate
  order by requested_at desc limit 1;
  if request_id is not null then
    if request_status='failed' then
      update public.workforce_amazon_invitation_requests
      set status='queued',requested_by=p_actor,requested_at=now(),claimed_at=null,
          claimed_by=null,completed_at=null,error_code=null,error_message=null,
          updated_at=now()
      where id=request_id;
      update public.workforce_amazon_email_pilot_candidates
      set status='queued',updated_at=now() where id=p_candidate;
    end if;
    return request_id;
  end if;
  first_name:=split_part(candidate.full_name,' ',1);
  last_name:=coalesce(nullif(btrim(regexp_replace(candidate.full_name,'^[^ ]+ *','')),''),first_name);
  insert into public.workforce_amazon_invitation_requests(
    company_id,workforce_id,email_pilot_candidate_id,station_id,source_portal,
    amazon_email,first_name,last_name,requested_by
  ) values (
    p_company,null,p_candidate,candidate.station_id,'workforce',candidate.alias_email,
    first_name,last_name,p_actor
  ) returning id into request_id;
  update public.workforce_amazon_email_pilot_candidates
  set status='queued',invitation_request_id=request_id,updated_at=now()
  where id=p_candidate;
  return request_id;
end
$$;
revoke all on function public.workforce_queue_isolated_amazon_email_pilot(uuid,uuid,uuid,uuid[])
  from public,anon,authenticated;
grant execute on function public.workforce_queue_isolated_amazon_email_pilot(uuid,uuid,uuid,uuid[])
  to service_role;

create function public.workforce_close_isolated_amazon_email_pilot(
  p_company uuid,
  p_actor uuid,
  p_candidate uuid,
  p_reason text,
  p_locations uuid[]
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare candidate public.workforce_amazon_email_pilot_candidates;
begin
  select * into candidate from public.workforce_amazon_email_pilot_candidates
  where id=p_candidate and company_id=p_company for update;
  if not found or candidate.closed_at is not null then raise exception 'Pilot candidate is unavailable'; end if;
  if p_actor is null or length(btrim(coalesce(p_reason,''))) not between 5 and 1000 then
    raise exception 'Record a reason for closing the pilot';
  end if;
  if p_locations is not null and not(candidate.station_id=any(p_locations)) then
    raise exception 'Station outside your access';
  end if;
  update public.workforce_amazon_invitation_requests
  set status='cancelled',completed_at=now(),error_code='pilot_closed',
      error_message='Pilot closed before invitation delivery',updated_at=now()
  where id=candidate.invitation_request_id and status='queued';
  update public.workforce_amazon_email_pilot_candidates
  set status='closed',closed_at=now(),close_reason=btrim(p_reason),
      inbox_status='suspended',updated_at=now()
  where id=p_candidate;
end
$$;
revoke all on function public.workforce_close_isolated_amazon_email_pilot(uuid,uuid,uuid,text,uuid[])
  from public,anon,authenticated;
grant execute on function public.workforce_close_isolated_amazon_email_pilot(uuid,uuid,uuid,text,uuid[])
  to service_role;

create or replace function public.workforce_finish_amazon_invitation(
  p_company uuid,p_request uuid,p_status text,p_external_reference text,
  p_error_code text,p_error_message text
) returns void
language plpgsql
security invoker
set search_path=''
as $$
declare r public.workforce_amazon_invitation_requests;
begin
  if p_status not in ('sent','failed') then raise exception 'Worker result must be sent or failed'; end if;
  select * into r from public.workforce_amazon_invitation_requests
  where id=p_request and company_id=p_company for update;
  if not found or r.status<>'processing' then raise exception 'Invitation request is not being processed'; end if;
  update public.workforce_amazon_invitation_requests
  set status=p_status,completed_at=now(),
      external_reference=nullif(btrim(p_external_reference),''),
      error_code=nullif(btrim(p_error_code),''),
      error_message=nullif(btrim(p_error_message),''),updated_at=now()
  where id=r.id;
  if r.workforce_id is not null then
    update public.workforce_joining_plans
    set provider_stage=case when p_status='sent' then 'invitation_sent' else 'blocked' end,
        provider_reference=case when p_status='sent' then nullif(btrim(p_external_reference),'') else provider_reference end,
        next_follow_up_on=case when p_status='sent' then (now() at time zone 'Asia/Kolkata')::date+1 else (now() at time zone 'Asia/Kolkata')::date end,
        version=version+1,updated_at=now()
    where workforce_id=r.workforce_id and company_id=p_company;
  else
    update public.workforce_amazon_email_pilot_candidates
    set status=case when p_status='sent' then 'sent' else 'failed' end,
        updated_at=now()
    where id=r.email_pilot_candidate_id and company_id=p_company;
  end if;
end
$$;
revoke all on function public.workforce_finish_amazon_invitation(uuid,uuid,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.workforce_finish_amazon_invitation(uuid,uuid,text,text,text,text)
  to service_role;

create or replace function public.workforce_ingest_amazon_pilot_email(
  p_recipient text,p_sender text,p_message_id text,p_subject text,
  p_preview text,p_action_url text,p_received_at timestamptz
) returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  alias_row public.workforce_amazon_email_aliases;
  candidate public.workforce_amazon_email_pilot_candidates;
  inserted_id uuid;
begin
  if p_sender is null or length(btrim(p_sender))<3
     or p_message_id is null or length(btrim(p_message_id))<1 then
    raise exception 'Sender and message ID are required';
  end if;
  if p_action_url is not null and p_action_url !~ '^https://' then
    raise exception 'Only HTTPS action links are accepted';
  end if;

  select * into alias_row from public.workforce_amazon_email_aliases
  where alias_email=lower(btrim(p_recipient)) and status<>'suspended' for update;
  if found then
    insert into public.workforce_amazon_email_messages(
      company_id,alias_id,workforce_id,internet_message_id,sender,subject,
      preview,action_url,received_at
    ) values (
      alias_row.company_id,alias_row.id,alias_row.workforce_id,
      left(btrim(p_message_id),500),left(btrim(p_sender),320),
      left(coalesce(p_subject,''),500),left(coalesce(p_preview,''),2000),
      nullif(left(coalesce(p_action_url,''),2000),''),coalesce(p_received_at,now())
    ) on conflict(alias_id,internet_message_id) do nothing returning id into inserted_id;
    update public.workforce_amazon_email_aliases
    set status='receiving',last_message_at=greatest(
      coalesce(last_message_at,'-infinity'::timestamptz),coalesce(p_received_at,now())
    ) where id=alias_row.id;
    if inserted_id is not null then
      insert into public.workforce_amazon_pilot_history(company_id,workforce_id,event,evidence)
      values(alias_row.company_id,alias_row.workforce_id,'email_received',
        jsonb_build_object('message_id',inserted_id,'sender',left(btrim(p_sender),320),
          'subject',left(coalesce(p_subject,''),500)));
    end if;
    return jsonb_build_object('accepted',true,'workforce_id',alias_row.workforce_id,
      'duplicate',inserted_id is null);
  end if;

  select * into candidate from public.workforce_amazon_email_pilot_candidates
  where alias_email=lower(btrim(p_recipient)) and closed_at is null for update;
  if not found then return jsonb_build_object('accepted',false); end if;
  insert into public.workforce_amazon_email_pilot_messages(
    company_id,candidate_id,internet_message_id,sender,subject,preview,
    action_url,received_at
  ) values (
    candidate.company_id,candidate.id,left(btrim(p_message_id),500),
    left(btrim(p_sender),320),left(coalesce(p_subject,''),500),
    left(coalesce(p_preview,''),2000),
    nullif(left(coalesce(p_action_url,''),2000),''),coalesce(p_received_at,now())
  ) on conflict(candidate_id,internet_message_id) do nothing returning id into inserted_id;
  update public.workforce_amazon_email_pilot_candidates
  set inbox_status='receiving',status='email_received',
      last_message_at=greatest(coalesce(last_message_at,'-infinity'::timestamptz),
        coalesce(p_received_at,now())),updated_at=now()
  where id=candidate.id;
  return jsonb_build_object('accepted',true,'candidate_id',candidate.id,
    'duplicate',inserted_id is null);
end
$$;
revoke all on function public.workforce_ingest_amazon_pilot_email(text,text,text,text,text,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.workforce_ingest_amazon_pilot_email(text,text,text,text,text,text,timestamptz)
  to service_role;

commit;
