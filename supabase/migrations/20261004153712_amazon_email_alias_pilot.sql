begin;

-- Pilot-only email aliases. These rows reserve inbound addresses for Amazon
-- onboarding without creating paid mailboxes or changing an existing associate.
create table public.workforce_amazon_email_aliases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  workforce_id uuid not null references public.workforce(id),
  station_id uuid not null references public.stations(id),
  alias_email text not null check (
    alias_email = lower(btrim(alias_email))
    and alias_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and length(alias_email) between 6 and 90
  ),
  status text not null default 'reserved' check (status in ('reserved','routed','receiving','route_failed','suspended')),
  routing_rule_id text check (routing_rule_id is null or length(routing_rule_id) <= 64),
  routing_error text check (routing_error is null or length(routing_error) <= 1000),
  routed_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  unique (company_id, workforce_id),
  unique (alias_email)
);
create index workforce_amazon_email_alias_station
  on public.workforce_amazon_email_aliases(company_id, station_id, status);

create table public.workforce_amazon_email_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  alias_id uuid not null references public.workforce_amazon_email_aliases(id) on delete cascade,
  workforce_id uuid not null references public.workforce(id),
  internet_message_id text not null check (length(internet_message_id) between 1 and 500),
  sender text not null check (length(sender) between 3 and 320),
  subject text not null default '' check (length(subject) <= 500),
  preview text not null default '' check (length(preview) <= 2000),
  action_url text check (action_url is null or (length(action_url) <= 2000 and action_url ~ '^https://')),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (alias_id, internet_message_id)
);
create index workforce_amazon_email_message_workforce
  on public.workforce_amazon_email_messages(company_id, workforce_id, received_at desc);

alter table public.workforce_amazon_email_aliases enable row level security;
alter table public.workforce_amazon_email_messages enable row level security;
revoke all on public.workforce_amazon_email_aliases, public.workforce_amazon_email_messages
  from public, anon, authenticated;
grant select, insert, update on public.workforce_amazon_email_aliases,
  public.workforce_amazon_email_messages to service_role;

create function public.workforce_amazon_alias_from_pattern(
  p_pattern text,
  p_full_name text,
  p_station_code text,
  p_unique_token text
) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  clean_name text;
  first_name text;
  last_name text;
  result text;
  local_part text;
  domain_part text;
begin
  clean_name := lower(regexp_replace(btrim(coalesce(p_full_name,'')),'[^a-zA-Z0-9 ]','','g'));
  first_name := regexp_replace(split_part(clean_name,' ',1),'[^a-z0-9]','','g');
  last_name := regexp_replace(regexp_replace(clean_name,'^[^ ]+ *',''),'[^a-z0-9]','','g');
  result := lower(btrim(coalesce(p_pattern,'')));
  result := replace(result,'{first_name}',first_name);
  result := replace(result,'{last_name}',last_name);
  result := replace(result,'{full_name}',replace(clean_name,' ',''));
  result := replace(result,'{station_code}',lower(regexp_replace(coalesce(p_station_code,''),'[^a-zA-Z0-9]','','g')));
  result := replace(result,'{unique}',lower(regexp_replace(coalesce(p_unique_token,''),'[^a-zA-Z0-9]','','g')));
  if position('{unique}' in lower(coalesce(p_pattern,''))) = 0 then
    local_part := split_part(result, '@', 1);
    domain_part := split_part(result, '@', 2);
    result := local_part || '.' || lower(p_unique_token) || '@' || domain_part;
  end if;
  return result;
end
$$;
revoke all on function public.workforce_amazon_alias_from_pattern(text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.workforce_amazon_alias_from_pattern(text,text,text,text)
  to service_role;

-- Generate and reserve the Amazon address atomically with the existing beta
-- onboarding record. The station master controls the full pattern/domain.
create function public.workforce_create_amazon_alias_pilot(
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
  wid uuid := (p_data->>'id')::uuid;
  sid uuid := (p_data->>'station_id')::uuid;
  full_name text := btrim(p_data->>'full_name');
  station_code text;
  email_pattern text;
  unique_token text := lower(right(replace(wid::text, '-', ''), 8));
  generated_email text;
  created_id uuid;
begin
  select s.station_code, cfg.associate_email_pattern
  into station_code, email_pattern
  from public.stations s
  join public.workforce_amazon_station_settings cfg
    on cfg.company_id = s.company_id
   and cfg.station_id = s.id
  where s.company_id = p_company
    and s.id = sid
    and cfg.invitation_enabled;

  if email_pattern is null or btrim(email_pattern) = '' then
    raise exception 'Configure the backend email alias pattern for this station before starting the pilot';
  end if;

  generated_email := public.workforce_amazon_alias_from_pattern(
    email_pattern,
    full_name,
    station_code,
    unique_token
  );
  if generated_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or length(generated_email) > 90 then
    raise exception 'The configured backend email alias pattern produced an invalid address';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_company::text || generated_email, 0));
  if exists (
    select 1 from public.workforce_amazon_email_aliases a
    where a.company_id = p_company and a.alias_email = generated_email
  ) then
    raise exception 'The generated backend email address is already reserved';
  end if;

  created_id := public.workforce_create_amazon_pilot(
    p_company,
    p_actor,
    p_data || jsonb_build_object('email', generated_email),
    p_locations
  );

  insert into public.workforce_amazon_email_aliases(
    company_id, workforce_id, station_id, alias_email, created_by
  ) values (
    p_company, created_id, sid, generated_email, p_actor
  );
  insert into public.workforce_amazon_pilot_history(company_id, workforce_id, event, evidence)
  values (
    p_company,
    created_id,
    'email_alias_reserved',
    jsonb_build_object('alias_email', generated_email, 'station_code', station_code)
  );
  return created_id;
end
$$;
revoke all on function public.workforce_create_amazon_alias_pilot(uuid, uuid, jsonb, uuid[])
  from public, anon, authenticated;
grant execute on function public.workforce_create_amazon_alias_pilot(uuid, uuid, jsonb, uuid[])
  to service_role;

-- Queue only the reserved alias. Existing beta rows retain their original
-- address so this migration cannot mutate or resend an earlier invitation.
create or replace function public.workforce_queue_amazon_pilot(p_company uuid,p_workforce uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare
  pilot public.workforce_amazon_pilots;
  w public.workforce;
  rid uuid;
  cfg public.workforce_amazon_station_settings;
  reserved_email text;
begin
 select * into pilot from public.workforce_amazon_pilots where company_id=p_company and workforce_id=p_workforce for update;
 if not found or pilot.closed_at is not null or (pilot.invitation_timing='after_trial' and pilot.trial_completed_at is null) then return null; end if;
 select * into w from public.workforce where id=p_workforce and company_id=p_company and deleted_at is null;
 if not found then return null; end if;
 select * into cfg from public.workforce_amazon_station_settings where station_id=pilot.station_id and company_id=p_company;
 if not coalesce(cfg.invitation_enabled,false) then raise exception 'Amazon invitation is disabled for this station'; end if;
 select alias_email into reserved_email from public.workforce_amazon_email_aliases where company_id=p_company and workforce_id=p_workforce;
 reserved_email := coalesce(reserved_email, w.email);
 select id into rid from public.workforce_amazon_invitation_requests where company_id=p_company and workforce_id=p_workforce order by requested_at desc limit 1;
 if rid is not null then return rid; end if;
 if exists(select 1 from public.workforce_amazon_portal_links where company_id=p_company and workforce_id=p_workforce) then return null; end if;
 insert into public.workforce_amazon_invitation_requests(company_id,workforce_id,station_id,source_portal,amazon_email,first_name,last_name,requested_by)
 values(p_company,p_workforce,pilot.station_id,'workforce',reserved_email,split_part(w.full_name,' ',1),coalesce(nullif(btrim(regexp_replace(w.full_name,'^[^ ]+ *','')),''),split_part(w.full_name,' ',1)),pilot.created_by) returning id into rid;
 insert into public.workforce_amazon_pilot_history(company_id,workforce_id,event,evidence)
 values(p_company,p_workforce,'invitation_queued',jsonb_build_object('request_id',rid,'alias_email',reserved_email));
 return rid;
end $$;
revoke all on function public.workforce_queue_amazon_pilot(uuid,uuid) from public,anon,authenticated;
grant execute on function public.workforce_queue_amazon_pilot(uuid,uuid) to service_role;

create function public.workforce_ingest_amazon_pilot_email(
  p_recipient text,
  p_sender text,
  p_message_id text,
  p_subject text,
  p_preview text,
  p_action_url text,
  p_received_at timestamptz
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  alias_row public.workforce_amazon_email_aliases;
  inserted_id uuid;
begin
  select * into alias_row
  from public.workforce_amazon_email_aliases
  where alias_email = lower(btrim(p_recipient))
    and status <> 'suspended'
  for update;
  if not found then return jsonb_build_object('accepted', false); end if;
  if p_sender is null or length(btrim(p_sender)) < 3
     or p_message_id is null or length(btrim(p_message_id)) < 1 then
    raise exception 'Sender and message ID are required';
  end if;
  if p_action_url is not null and p_action_url !~ '^https://' then
    raise exception 'Only HTTPS action links are accepted';
  end if;

  insert into public.workforce_amazon_email_messages(
    company_id, alias_id, workforce_id, internet_message_id, sender,
    subject, preview, action_url, received_at
  ) values (
    alias_row.company_id,
    alias_row.id,
    alias_row.workforce_id,
    left(btrim(p_message_id),500),
    left(btrim(p_sender),320),
    left(coalesce(p_subject,''),500),
    left(coalesce(p_preview,''),2000),
    nullif(left(coalesce(p_action_url,''),2000),''),
    coalesce(p_received_at,now())
  )
  on conflict(alias_id,internet_message_id) do nothing
  returning id into inserted_id;

  update public.workforce_amazon_email_aliases
  set status='receiving', last_message_at=greatest(coalesce(last_message_at,'-infinity'::timestamptz),coalesce(p_received_at,now()))
  where id=alias_row.id;
  if inserted_id is not null then
    insert into public.workforce_amazon_pilot_history(company_id,workforce_id,event,evidence)
    values(alias_row.company_id,alias_row.workforce_id,'email_received',jsonb_build_object('message_id',inserted_id,'sender',left(btrim(p_sender),320),'subject',left(coalesce(p_subject,''),500)));
  end if;
  return jsonb_build_object('accepted',true,'workforce_id',alias_row.workforce_id,'duplicate',inserted_id is null);
end
$$;
revoke all on function public.workforce_ingest_amazon_pilot_email(text,text,text,text,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.workforce_ingest_amazon_pilot_email(text,text,text,text,text,text,timestamptz)
  to service_role;

commit;
