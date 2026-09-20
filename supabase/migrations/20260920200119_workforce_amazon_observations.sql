-- Provider observations are evidence, never authority to activate or change pay.
create table public.workforce_amazon_connections (
  company_id uuid primary key references public.companies(id),
  username text not null check(length(username) between 3 and 254),
  password_secret_id uuid not null references vault.secrets(id),
  session_secret_id uuid references vault.secrets(id),
  enabled boolean not null default false,
  login_requested_at timestamptz,
  login_attempted_at timestamptz,
  version integer not null default 1,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.workforce_amazon_connections enable row level security;
revoke all on public.workforce_amazon_connections from public,anon,authenticated;
grant select,insert,update on public.workforce_amazon_connections to service_role;
create index workforce_amazon_connections_actor_idx on public.workforce_amazon_connections(updated_by);
create index workforce_amazon_connections_password_idx on public.workforce_amazon_connections(password_secret_id);
create index workforce_amazon_connections_session_idx on public.workforce_amazon_connections(session_secret_id);
create table public.workforce_amazon_connection_events (
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
  actor_id uuid not null references auth.users(id),event_code text not null,
  created_at timestamptz not null default now()
);
alter table public.workforce_amazon_connection_events enable row level security;
revoke all on public.workforce_amazon_connection_events from public,anon,authenticated;
grant select,insert on public.workforce_amazon_connection_events to service_role;
create index workforce_amazon_connection_events_company_idx on public.workforce_amazon_connection_events(company_id,created_at desc);
create index workforce_amazon_connection_events_actor_idx on public.workforce_amazon_connection_events(actor_id);
create table public.workforce_amazon_sync_state (
  company_id uuid primary key references public.companies(id),
  lease_token uuid,
  lease_until timestamptz,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  status text not null default 'not_started' check(status in ('not_started','running','ok','no_linked_profiles','login_required','layout_changed','unavailable')),
  matched_count integer not null default 0 check(matched_count>=0),
  missing_count integer not null default 0 check(missing_count>=0)
);
create table public.workforce_amazon_observations (
  company_id uuid not null references public.companies(id),
  workforce_id uuid not null references public.workforce(id),
  provider_profile_id text not null,
  progress text not null check(length(progress)<=300),
  provider_status text not null check(length(provider_status)<=1000),
  observed_at timestamptz not null,
  primary key(company_id,workforce_id)
);
create index workforce_amazon_observations_workforce_idx on public.workforce_amazon_observations(workforce_id);
create table public.workforce_amazon_observation_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  workforce_id uuid not null references public.workforce(id),
  provider_profile_id text not null,
  progress text not null,
  provider_status text not null,
  observed_at timestamptz not null
);
create index workforce_amazon_observation_events_person_idx on public.workforce_amazon_observation_events(company_id,workforce_id,observed_at desc);
create index workforce_amazon_observation_events_workforce_idx on public.workforce_amazon_observation_events(workforce_id);
alter table public.workforce_amazon_sync_state enable row level security;
alter table public.workforce_amazon_observations enable row level security;
alter table public.workforce_amazon_observation_events enable row level security;
revoke all on public.workforce_amazon_sync_state,public.workforce_amazon_observations,public.workforce_amazon_observation_events from public,anon,authenticated;
grant select,insert,update on public.workforce_amazon_sync_state,public.workforce_amazon_observations to service_role;
grant select,insert on public.workforce_amazon_observation_events to service_role;

create function public.workforce_claim_amazon_sync(p_company uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare v_token uuid:=gen_random_uuid(); v_claim uuid;
begin
  if not exists(select 1 from public.workforce_amazon_connections where company_id=p_company and enabled) then return null; end if;
  insert into public.workforce_amazon_sync_state(company_id) values(p_company) on conflict do nothing;
  update public.workforce_amazon_sync_state set lease_token=v_token,lease_until=now()+interval '4 minutes',last_attempt_at=now(),status='running'
  where company_id=p_company and (lease_until is null or lease_until<now())
    and (last_attempt_at is null or last_attempt_at<now()-interval '5 minutes')
  returning lease_token into v_claim;
  return v_claim;
end $$;

create function public.workforce_finish_amazon_sync(p_company uuid,p_token uuid,p_status text,p_observations jsonb,p_missing integer default 0) returns void
language plpgsql security invoker set search_path='' as $$
declare s public.workforce_amazon_sync_state; o jsonb; p public.workforce_joining_plans;
  old public.workforce_amazon_observations; n integer:=0;
begin
  select * into s from public.workforce_amazon_sync_state where company_id=p_company for update;
  if not found or s.lease_token is distinct from p_token or p_token is null or s.lease_until<now() then
    raise exception 'Amazon sync lease expired or superseded';
  end if;
  if p_status not in ('ok','no_linked_profiles','login_required','layout_changed','unavailable') or p_status is null
    or jsonb_typeof(p_observations)<>'array' or p_observations is null or jsonb_array_length(p_observations)>5000
    or p_missing is null or p_missing<0 then raise exception 'Invalid Amazon observation result'; end if;
  if p_status<>'ok' and jsonb_array_length(p_observations)>0 then raise exception 'Incomplete scans cannot publish observations'; end if;
  for o in select value from jsonb_array_elements(p_observations) loop
    select * into p from public.workforce_joining_plans where company_id=p_company and workforce_id=(o->>'workforce_id')::uuid for share;
    if not found or p.provider_profile_id is distinct from o->>'provider_profile_id' then raise exception 'Amazon profile link changed; retry scan'; end if;
    if exists(select 1 from public.workforce_joining_plans x where x.company_id=p_company and x.provider_profile_id=p.provider_profile_id and x.workforce_id<>p.workforce_id) then
      raise exception 'Amazon profile linked to multiple associates';
    end if;
    select * into old from public.workforce_amazon_observations where company_id=p_company and workforce_id=p.workforce_id;
    insert into public.workforce_amazon_observations(company_id,workforce_id,provider_profile_id,progress,provider_status,observed_at)
    values(p_company,p.workforce_id,p.provider_profile_id,o->>'progress',o->>'provider_status',s.last_attempt_at)
    on conflict(company_id,workforce_id) do update set provider_profile_id=excluded.provider_profile_id,progress=excluded.progress,provider_status=excluded.provider_status,observed_at=excluded.observed_at;
    if old.workforce_id is null or old.provider_profile_id is distinct from p.provider_profile_id or old.progress is distinct from o->>'progress' or old.provider_status is distinct from o->>'provider_status' then
      insert into public.workforce_amazon_observation_events(company_id,workforce_id,provider_profile_id,progress,provider_status,observed_at)
      values(p_company,p.workforce_id,p.provider_profile_id,o->>'progress',o->>'provider_status',s.last_attempt_at);
    end if;
    n:=n+1;
  end loop;
  update public.workforce_amazon_sync_state set lease_token=null,lease_until=null,status=p_status,
    last_success_at=case when p_status='ok' then now() else last_success_at end,matched_count=n,missing_count=p_missing where company_id=p_company;
end $$;
revoke all on function public.workforce_claim_amazon_sync(uuid),public.workforce_finish_amazon_sync(uuid,uuid,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.workforce_claim_amazon_sync(uuid),public.workforce_finish_amazon_sync(uuid,uuid,text,jsonb,integer) to service_role;

-- Vault functions run only with the existing service role's Vault privileges.
-- No SECURITY DEFINER or browser Data API grant is introduced here.
create function public.workforce_save_amazon_connection(p_company uuid,p_actor uuid,p_username text,p_password text,p_enabled boolean,p_version integer,p_request_login boolean default false) returns void
language plpgsql security invoker set search_path='' as $$
declare c public.workforce_amazon_connections; v_secret uuid; v_changed boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company::text||':amazon-onboarding',0));
  perform 1 from public.workforce_amazon_sync_state where company_id=p_company for update;
  if p_actor is null or p_username is null or p_username!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(p_username)>254 or p_enabled is null then raise exception 'Valid owner, email and connection state required'; end if;
  select * into c from public.workforce_amazon_connections where company_id=p_company for update;
  if coalesce(c.version,0) is distinct from p_version then raise exception 'Connection changed; refresh before saving'; end if;
  if (c.company_id is null or c.username<>p_username) and coalesce(p_password,'')='' then raise exception 'Enter password for this login account'; end if;
  v_changed:=c.company_id is null or c.username<>p_username or coalesce(p_password,'')<>'';
  v_secret:=c.password_secret_id;
  if coalesce(p_password,'')<>'' then
    if length(p_password)>1024 then raise exception 'Password is too long'; end if;
    if v_secret is null then select vault.create_secret(p_password) into v_secret;
    else perform vault.update_secret(v_secret,p_password); end if;
  end if;
  insert into public.workforce_amazon_connections(company_id,username,password_secret_id,enabled,login_requested_at,updated_by)
  values(p_company,p_username,v_secret,p_enabled,case when p_request_login or v_changed then now() end,p_actor)
  on conflict(company_id) do update set username=excluded.username,password_secret_id=v_secret,enabled=p_enabled,
    session_secret_id=case when v_changed then null else c.session_secret_id end,
    login_requested_at=case when p_request_login or v_changed then now() else c.login_requested_at end,
    version=c.version+1,updated_by=p_actor,updated_at=now();
  update public.workforce_amazon_sync_state set lease_token=null,lease_until=null,last_attempt_at=null,status='not_started' where company_id=p_company;
  insert into public.workforce_amazon_connection_events(company_id,actor_id,event_code)
  values(p_company,p_actor,case when p_request_login then 'connection_test_requested' when p_enabled then 'connection_saved' else 'connection_paused' end);
end $$;
create function public.workforce_read_amazon_connection(p_company uuid,p_token uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.workforce_amazon_connections; password text; session text;
begin
  if not exists(select 1 from public.workforce_amazon_sync_state where company_id=p_company and lease_token=p_token and lease_until>now()) then raise exception 'Active sync lease required'; end if;
  select * into c from public.workforce_amazon_connections where company_id=p_company and enabled;
  if not found then raise exception 'Connection paused'; end if;
  select decrypted_secret into password from vault.decrypted_secrets where id=c.password_secret_id;
  select decrypted_secret into session from vault.decrypted_secrets where id=c.session_secret_id;
  return jsonb_build_object('username',c.username,'password',password,'session',session,'login_requested',c.login_requested_at is not null and (c.login_attempted_at is null or c.login_requested_at>c.login_attempted_at));
end $$;
create function public.workforce_store_amazon_session(p_company uuid,p_token uuid,p_cookie text) returns void
language plpgsql security invoker set search_path='' as $$
declare v_secret uuid;
begin
  perform 1 from public.workforce_amazon_sync_state where company_id=p_company and lease_token=p_token and lease_until>now() for update;
  if not found then raise exception 'Active sync lease required'; end if;
  select session_secret_id into v_secret from public.workforce_amazon_connections where company_id=p_company for update;
  if p_cookie is not null then
    if length(p_cookie)>20000 then raise exception 'Invalid session size'; end if;
    if v_secret is null then select vault.create_secret(p_cookie) into v_secret;
    else perform vault.update_secret(v_secret,p_cookie); end if;
  end if;
  update public.workforce_amazon_connections set session_secret_id=v_secret,login_attempted_at=now() where company_id=p_company;
end $$;
revoke all on function public.workforce_save_amazon_connection(uuid,uuid,text,text,boolean,integer,boolean),public.workforce_read_amazon_connection(uuid,uuid),public.workforce_store_amazon_session(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.workforce_save_amazon_connection(uuid,uuid,text,text,boolean,integer,boolean),public.workforce_read_amazon_connection(uuid,uuid),public.workforce_store_amazon_session(uuid,uuid,text) to service_role;
