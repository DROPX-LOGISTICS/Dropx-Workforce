begin;

-- Amazon service area UUID from get-company-service-areas (non-hardcoded station map).
alter table public.workforce_amazon_station_settings
  add column if not exists amazon_service_area_id uuid;

-- Seed supervisor alias for rows that somehow lack one (constraint requires not null;
-- update empty-looking placeholders only if column allows blank historically — no-op safe).
update public.workforce_amazon_station_settings
set supervisor_alias = 'anbaba'
where supervisor_alias is null or btrim(supervisor_alias) = '';

create table if not exists public.workforce_amazon_service_areas (
  company_id uuid not null references public.companies(id),
  service_area_id uuid not null,
  service_area_name text not null,
  station_code text not null,
  service_groups text[] not null default '{}',
  station_state text,
  synced_at timestamptz not null default now(),
  primary key (company_id, service_area_id)
);
create index if not exists workforce_amazon_service_areas_station
  on public.workforce_amazon_service_areas(company_id, station_code);
alter table public.workforce_amazon_service_areas enable row level security;
revoke all on public.workforce_amazon_service_areas from public, anon, authenticated;
grant select, insert, update, delete on public.workforce_amazon_service_areas to service_role;

create table if not exists public.workforce_amazon_portal_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  workforce_id uuid not null references public.workforce(id),
  amazon_provider_id text not null,
  amazon_email text,
  transporter_id text,
  station_mapped boolean not null default false,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, workforce_id)
);
create index if not exists workforce_amazon_portal_links_provider
  on public.workforce_amazon_portal_links(company_id, amazon_provider_id);
alter table public.workforce_amazon_portal_links enable row level security;
revoke all on public.workforce_amazon_portal_links from public, anon, authenticated;
grant select, insert, update on public.workforce_amazon_portal_links to service_role;

create table if not exists public.workforce_idfy_observations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  workforce_id uuid references public.workforce(id),
  idfy_profile_id text,
  candidate_name text not null,
  candidate_email text,
  status text not null,
  has_insufficiency boolean not null default false,
  highlight text,
  respond_url text,
  observed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, idfy_profile_id)
);
create index if not exists workforce_idfy_observations_name
  on public.workforce_idfy_observations(company_id, lower(candidate_name));
create index if not exists workforce_idfy_observations_issues
  on public.workforce_idfy_observations(company_id, has_insufficiency) where has_insufficiency;
alter table public.workforce_idfy_observations enable row level security;
revoke all on public.workforce_idfy_observations from public, anon, authenticated;
grant select, insert, update, delete on public.workforce_idfy_observations to service_role;

create table if not exists public.idfy_sessions (
  id uuid primary key default gen_random_uuid(),
  account_key text not null default 'default',
  cookie text not null,
  uploaded_by text not null,
  status text not null default 'active' check (status in ('active', 'expired')),
  created_at timestamptz not null default now(),
  expired_at timestamptz
);
create index if not exists idfy_sessions_active
  on public.idfy_sessions(account_key, status, created_at desc);
alter table public.idfy_sessions enable row level security;
revoke all on public.idfy_sessions from public, anon, authenticated;
grant select, insert, update on public.idfy_sessions to service_role;

create table if not exists public.idfy_login_state (
  account_key text primary key default 'default',
  login_locked_until timestamptz,
  last_login_at timestamptz,
  last_login_error text,
  updated_at timestamptz not null default now()
);
alter table public.idfy_login_state enable row level security;
revoke all on public.idfy_login_state from public, anon, authenticated;
grant select, insert, update on public.idfy_login_state to service_role;

-- Company-level default supervisor for UI placeholder (no station row required).
create table if not exists public.workforce_amazon_supervisor_defaults (
  company_id uuid primary key references public.companies(id),
  supervisor_alias text not null check (supervisor_alias ~ '^[a-zA-Z0-9._-]{2,80}$'),
  updated_at timestamptz not null default now()
);
alter table public.workforce_amazon_supervisor_defaults enable row level security;
revoke all on public.workforce_amazon_supervisor_defaults from public, anon, authenticated;
grant select, insert, update on public.workforce_amazon_supervisor_defaults to service_role;

insert into public.workforce_amazon_supervisor_defaults(company_id, supervisor_alias)
select c.id, 'anbaba'
from public.companies c
on conflict (company_id) do update
set supervisor_alias = excluded.supervisor_alias, updated_at = now();

create or replace function public.workforce_save_amazon_station(
  p_company uuid,p_actor uuid,p_actor_name text,p_station uuid,p_version integer,p_settings jsonb,p_locations uuid[]
) returns void language plpgsql security invoker set search_path='' as $$
declare old_settings public.workforce_amazon_station_settings; candidate public.workforce_amazon_station_settings;
begin
  perform 1 from public.stations where company_id=p_company and id=p_station for update;
  if not found or p_actor is null then raise exception 'Choose a station in this company'; end if;
  if p_locations is not null and not(p_station=any(p_locations)) then raise exception 'Station is outside your access scope'; end if;
  select * into old_settings from public.workforce_amazon_station_settings where station_id=p_station and company_id=p_company;
  if coalesce(old_settings.version,0) is distinct from p_version then raise exception 'Station settings changed. Refresh and try again'; end if;
  candidate:=jsonb_populate_record(null::public.workforce_amazon_station_settings,p_settings);
  if candidate.invitation_enabled and candidate.associate_email_pattern is null then raise exception 'Configure the associate email pattern before enabling invitations'; end if;
  insert into public.workforce_amazon_station_settings(
    station_id,company_id,service_area_code,amazon_service_area_id,service_type,supervisor_alias,contract_type,
    associate_email_pattern,invitation_enabled,version,updated_by
  )
    values(
      p_station,p_company,candidate.service_area_code,candidate.amazon_service_area_id,candidate.service_type,
      candidate.supervisor_alias,candidate.contract_type,candidate.associate_email_pattern,candidate.invitation_enabled,
      coalesce(old_settings.version,0)+1,p_actor
    )
    on conflict(station_id) do update set
      service_area_code=excluded.service_area_code,
      amazon_service_area_id=excluded.amazon_service_area_id,
      service_type=excluded.service_type,
      supervisor_alias=excluded.supervisor_alias,
      contract_type=excluded.contract_type,
      associate_email_pattern=excluded.associate_email_pattern,
      invitation_enabled=excluded.invitation_enabled,
      version=excluded.version,
      updated_by=p_actor,
      updated_at=now();
  insert into public.workforce_amazon_station_events(company_id,station_id,actor_id,actor_name,details)
    values(p_company,p_station,p_actor,p_actor_name,jsonb_build_object('before',to_jsonb(old_settings),'after',p_settings));
end $$;

commit;
