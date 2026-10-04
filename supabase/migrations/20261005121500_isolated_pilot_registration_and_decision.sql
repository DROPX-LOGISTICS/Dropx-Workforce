begin;

-- The private beta keeps registration, documents and exit decisions outside
-- every canonical Workforce/People table.  The candidate UUID is the only
-- identity used to join these records.
create table public.workforce_amazon_email_pilot_registrations (
  candidate_id uuid primary key references public.workforce_amazon_email_pilot_candidates(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  draft_data jsonb not null default '{}'::jsonb,
  verification_results jsonb not null default '[]'::jsonb,
  file_paths jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','submitted','confirmed','returned')),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  returned_at timestamptz,
  return_note text check (return_note is null or length(return_note) <= 1000),
  updated_at timestamptz not null default now()
);

alter table public.workforce_amazon_email_pilot_candidates
  add column continuation_status text not null default 'pending'
    check (continuation_status in ('pending','continuing','not_continuing')),
  add column continuation_decided_at timestamptz;

create table public.workforce_amazon_email_pilot_exit_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  candidate_id uuid not null references public.workforce_amazon_email_pilot_candidates(id) on delete cascade,
  reason_id uuid not null references public.workforce_onboarding_exit_reasons(id),
  note text check (note is null or length(note) <= 1000),
  alias_email text not null,
  station_id uuid not null references public.stations(id),
  invitation_request_id uuid references public.workforce_amazon_invitation_requests(id),
  amazon_profile_id text,
  status text not null default 'queued'
    check (status in ('queued','processing','completed','failed','manual_review','cancelled')),
  claimed_at timestamptz,
  claimed_by text,
  attempt_count integer not null default 0,
  completed_at timestamptz,
  error_code text,
  error_message text check (error_message is null or length(error_message) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index workforce_amazon_email_pilot_open_exit
  on public.workforce_amazon_email_pilot_exit_requests(company_id,candidate_id)
  where status in ('queued','processing','manual_review');

alter table public.workforce_amazon_email_pilot_registrations enable row level security;
alter table public.workforce_amazon_email_pilot_exit_requests enable row level security;
revoke all on public.workforce_amazon_email_pilot_registrations,
  public.workforce_amazon_email_pilot_exit_requests from public,anon,authenticated;
grant select,insert,update on public.workforce_amazon_email_pilot_registrations,
  public.workforce_amazon_email_pilot_exit_requests to service_role;

-- New aliases use a memorable collision-resistant token: the candidate's
-- mobile last four. Existing aliases are intentionally never renamed because
-- Amazon already treats them as account usernames.
create or replace function public.workforce_create_isolated_amazon_email_pilot(
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

  select s.station_code,cfg.associate_email_pattern into station_code,email_pattern
  from public.stations s
  join public.workforce_amazon_station_settings cfg
    on cfg.company_id=s.company_id and cfg.station_id=s.id
  where s.company_id=p_company and s.id=v_station_id and s.is_active
    and cfg.invitation_enabled;
  if email_pattern is null or btrim(email_pattern)='' then
    raise exception 'Configure the backend email alias pattern for this station before starting the pilot';
  end if;

  generated_email := public.workforce_amazon_alias_from_pattern(
    email_pattern,person_name,station_code,right(person_mobile,4)
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
  order by w.updated_at desc nulls last,w.created_at desc limit 1;

  perform pg_advisory_xact_lock(hashtextextended(p_company::text||generated_email,0));
  if exists(select 1 from public.workforce_amazon_email_pilot_candidates where alias_email=generated_email) then
    raise exception 'This Amazon sign-in ID is already reserved. Use a different mobile number or contact Workforce';
  end if;
  insert into public.workforce_amazon_email_pilot_candidates(
    id,company_id,station_id,designation_id,full_name,mobile,biometric_id,
    reported_on,alias_email,duplicate_identity_detected,duplicate_identity_summary,created_by
  ) values (
    candidate_id,p_company,v_station_id,v_designation_id,person_name,person_mobile,
    btrim(p_data->>'biometric_id'),reported,generated_email,
    duplicate_summary is not null,duplicate_summary,p_actor
  );
  return candidate_id;
end
$$;

create function public.workforce_update_isolated_amazon_email_pilot_decision(
  p_company uuid,
  p_candidate uuid,
  p_action text,
  p_reason uuid default null,
  p_note text default ''
) returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  candidate public.workforce_amazon_email_pilot_candidates;
  reason public.workforce_onboarding_exit_reasons;
  invitation public.workforce_amazon_invitation_requests;
  request_id uuid;
  request_status text;
  clean_note text := btrim(coalesce(p_note,''));
begin
  select * into candidate from public.workforce_amazon_email_pilot_candidates
  where company_id=p_company and id=p_candidate and closed_at is null for update;
  if not found then raise exception 'Pilot onboarding is unavailable'; end if;

  if p_action='continue_amazon' then
    update public.workforce_amazon_email_pilot_candidates
    set continuation_status='continuing',continuation_decided_at=now(),updated_at=now()
    where id=candidate.id;
    return jsonb_build_object('status','continuing');
  end if;
  if p_action<>'not_continuing' then raise exception 'Choose an available decision'; end if;
  if length(clean_note)>1000 then raise exception 'Keep the note under 1,000 characters'; end if;

  select * into reason from public.workforce_onboarding_exit_reasons
  where id=p_reason and company_id=p_company and client_code='AMAZON' and is_active;
  if not found then raise exception 'Choose an available reason'; end if;
  if reason.requires_note and length(clean_note)<3 then raise exception 'Add a short note for this reason'; end if;

  select * into invitation from public.workforce_amazon_invitation_requests
  where company_id=p_company and email_pilot_candidate_id=candidate.id
  order by requested_at desc limit 1;

  update public.workforce_amazon_invitation_requests
  set status='cancelled',completed_at=now(),error_code='associate_not_continuing',
      error_message='Associate chose not to continue',updated_at=now()
  where id=invitation.id and status='queued';

  request_status := case when nullif(btrim(invitation.external_reference),'') is null
    then 'manual_review' else 'queued' end;
  insert into public.workforce_amazon_email_pilot_exit_requests(
    company_id,candidate_id,reason_id,note,alias_email,station_id,
    invitation_request_id,amazon_profile_id,status,error_code,error_message
  ) values (
    p_company,candidate.id,reason.id,nullif(clean_note,''),candidate.alias_email,
    candidate.station_id,invitation.id,nullif(btrim(invitation.external_reference),''),request_status,
    case when request_status='manual_review' then 'missing_exact_amazon_profile' end,
    case when request_status='manual_review' then 'Exact Amazon profile ID is unavailable; no automated offboarding was attempted.' end
  ) on conflict (company_id,candidate_id) where status in ('queued','processing','manual_review')
    do update set reason_id=excluded.reason_id,note=excluded.note,updated_at=now()
  returning id,status into request_id,request_status;

  update public.workforce_amazon_email_pilot_candidates
  set continuation_status='not_continuing',continuation_decided_at=now(),updated_at=now()
  where id=candidate.id;
  return jsonb_build_object('status','not_continuing','exit_request_id',request_id,
    'offboarding_status',request_status);
end
$$;

revoke all on function public.workforce_update_isolated_amazon_email_pilot_decision(uuid,uuid,text,uuid,text)
  from public,anon,authenticated;
grant execute on function public.workforce_update_isolated_amazon_email_pilot_decision(uuid,uuid,text,uuid,text)
  to service_role;

commit;
