begin;

create extension if not exists pgcrypto;
create extension if not exists supabase_vault with schema vault;

create table if not exists public.amazon_connectors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  portal_code text not null check (portal_code in ('yms', 'lsc', 'scc')),
  portal_name text not null,
  base_url text not null,
  login_url text not null,
  username text,
  password_secret_id uuid references vault.secrets(id) on delete set null,
  mfa_secret_id uuid references vault.secrets(id) on delete set null,
  auth_mode text not null default 'credential_login' check (auth_mode in ('credential_login', 'manual_session', 'api_token')),
  is_enabled boolean not null default false,
  sync_enabled boolean not null default false,
  sync_interval_minutes integer not null default 30 check (sync_interval_minutes between 5 and 1440),
  timezone text not null default 'Asia/Kolkata',
  status text not null default 'Not configured' check (status in ('Not configured', 'Ready', 'Running', 'Connected', 'Error', 'Paused')),
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_message text,
  notes text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists amazon_connectors_company_portal_uidx
  on public.amazon_connectors(company_id, portal_code);

create index if not exists amazon_connectors_company_status_idx
  on public.amazon_connectors(company_id, status, is_enabled);

create table if not exists public.amazon_connector_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  connector_id uuid not null references public.amazon_connectors(id) on delete cascade,
  task_code text not null,
  task_name text not null,
  source_url text not null,
  is_enabled boolean not null default false,
  sync_interval_minutes integer not null default 30 check (sync_interval_minutes between 5 and 1440),
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_status text not null default 'Not configured',
  last_message text,
  worker_payload jsonb not null default '{}'::jsonb,
  notes text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists amazon_connector_tasks_company_connector_task_uidx
  on public.amazon_connector_tasks(company_id, connector_id, task_code);

create index if not exists amazon_connector_tasks_due_idx
  on public.amazon_connector_tasks(company_id, is_enabled, next_run_at);

create table if not exists public.amazon_connector_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  connector_id uuid references public.amazon_connectors(id) on delete set null,
  task_id uuid references public.amazon_connector_tasks(id) on delete set null,
  run_type text not null default 'manual',
  status text not null default 'Queued',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  rows_seen integer not null default 0,
  rows_imported integer not null default 0,
  rows_skipped integer not null default 0,
  message text,
  artifact_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists amazon_connector_runs_company_started_idx
  on public.amazon_connector_runs(company_id, started_at desc);

create table if not exists public.amazon_connector_run_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  run_id uuid not null references public.amazon_connector_runs(id) on delete cascade,
  event_level text not null default 'info' check (event_level in ('debug', 'info', 'warn', 'error')),
  event_name text not null,
  message text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists amazon_connector_run_events_run_idx
  on public.amazon_connector_run_events(run_id, created_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists amazon_connectors_set_updated_at on public.amazon_connectors;
create trigger amazon_connectors_set_updated_at
before update on public.amazon_connectors
for each row execute function public.set_updated_at();

drop trigger if exists amazon_connector_tasks_set_updated_at on public.amazon_connector_tasks;
create trigger amazon_connector_tasks_set_updated_at
before update on public.amazon_connector_tasks
for each row execute function public.set_updated_at();

insert into public.amazon_connectors (company_id, portal_code, portal_name, base_url, login_url, timezone, status)
select companies.id, defaults.portal_code, defaults.portal_name, defaults.base_url, defaults.login_url, 'Asia/Kolkata', 'Not configured'
from public.companies
cross join (
  values
    ('yms', 'Amazon YMS', 'https://www.amazonlogistics.eu/', 'https://www.amazonlogistics.eu/'),
    ('lsc', 'Amazon LSC', 'https://logistics.amazon.in/', 'https://logistics.amazon.in/'),
    ('scc', 'Amazon SCC', 'https://www.amazonlogistics.eu/', 'https://www.amazonlogistics.eu/station/dashboard/workitemsvisibility')
) as defaults(portal_code, portal_name, base_url, login_url)
where coalesce(companies.is_active, true) = true
on conflict (company_id, portal_code) do update
set
  portal_name = excluded.portal_name,
  base_url = coalesce(nullif(public.amazon_connectors.base_url, ''), excluded.base_url),
  login_url = coalesce(nullif(public.amazon_connectors.login_url, ''), excluded.login_url),
  updated_at = now();

insert into public.amazon_connector_tasks (company_id, connector_id, task_code, task_name, source_url, sync_interval_minutes)
select connectors.company_id, connectors.id, tasks.task_code, tasks.task_name, tasks.source_url, tasks.sync_interval_minutes
from public.amazon_connectors connectors
join (
  values
    ('yms', 'yard_management', 'Yard management', 'https://www.amazonlogistics.eu/', 30),
    ('yms', 'vehicle_movement', 'Vehicle movement', 'https://www.amazonlogistics.eu/', 30),
    ('lsc', 'daily_shipment_count', 'Daily shipment count', 'https://logistics.amazon.in/', 60),
    ('lsc', 'performance_reports', 'Performance reports', 'https://logistics.amazon.in/', 60),
    ('scc', 'work_items_visibility', 'Work items visibility', 'https://www.amazonlogistics.eu/station/dashboard/workitemsvisibility', 30),
    ('scc', 'driver_reconciliation', 'Driver reconciliation', 'https://www.amazonlogistics.eu/station/dashboard/driverreconciliation', 30),
    ('scc', 'prepared_deposit', 'Prepared deposit', 'https://www.amazonlogistics.eu/station/dashboard/bankdeposits', 30)
) as tasks(portal_code, task_code, task_name, source_url, sync_interval_minutes)
  on tasks.portal_code = connectors.portal_code
on conflict (company_id, connector_id, task_code) do update
set
  task_name = excluded.task_name,
  source_url = excluded.source_url,
  sync_interval_minutes = excluded.sync_interval_minutes,
  updated_at = now();

insert into public.app_pages (company_id, code, name, sort_order, is_active, created_at, updated_at)
select companies.id, 'amazon_connector', 'Amazon Connector', 134, true, now(), now()
from public.companies
where coalesce(companies.is_active, true) = true
  and not exists (
    select 1
    from public.app_pages pages
    where pages.company_id = companies.id
      and pages.code = 'amazon_connector'
  );

update public.app_pages
set name = 'Amazon Connector', sort_order = 134, is_active = true, updated_at = now()
where code = 'amazon_connector';

insert into public.role_page_permissions (company_id, role_id, page_id, can_view, can_add, can_edit, created_at, updated_at)
select roles.company_id, roles.id, pages.id, true, true, true, now(), now()
from public.user_roles roles
join public.app_pages pages
  on pages.company_id = roles.company_id
where upper(roles.code) = 'OWNER'
  and pages.code = 'amazon_connector'
  and not exists (
    select 1
    from public.role_page_permissions permissions
    where permissions.company_id = roles.company_id
      and permissions.role_id = roles.id
      and permissions.page_id = pages.id
  );

update public.role_page_permissions permissions
set can_view = true, can_add = true, can_edit = true, updated_at = now()
from public.user_roles roles
join public.app_pages pages
  on pages.company_id = roles.company_id
where permissions.company_id = roles.company_id
  and permissions.role_id = roles.id
  and permissions.page_id = pages.id
  and upper(roles.code) = 'OWNER'
  and pages.code = 'amazon_connector';

create or replace function public.set_amazon_connector_password(connector_uuid uuid, secret_value text)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  secret_id uuid;
begin
  select vault.create_secret(
    secret_value,
    'dropx_amazon_connector_password_' || replace(connector_uuid::text, '-', '') || '_' || replace(gen_random_uuid()::text, '-', ''),
    'Amazon portal password'
  ) into secret_id;

  update public.amazon_connectors
  set password_secret_id = secret_id, updated_at = now()
  where id = connector_uuid;

  return secret_id;
end;
$$;

create or replace function public.set_amazon_connector_mfa_secret(connector_uuid uuid, secret_value text)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  secret_id uuid;
begin
  select vault.create_secret(
    secret_value,
    'dropx_amazon_connector_mfa_' || replace(connector_uuid::text, '-', '') || '_' || replace(gen_random_uuid()::text, '-', ''),
    'Amazon portal MFA or recovery secret'
  ) into secret_id;

  update public.amazon_connectors
  set mfa_secret_id = secret_id, updated_at = now()
  where id = connector_uuid;

  return secret_id;
end;
$$;

create or replace function public.get_amazon_connector_password(connector_uuid uuid)
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where id = (
    select password_secret_id
    from public.amazon_connectors
    where id = connector_uuid
  )
  limit 1;
$$;

create or replace function public.get_amazon_connector_mfa_secret(connector_uuid uuid)
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where id = (
    select mfa_secret_id
    from public.amazon_connectors
    where id = connector_uuid
  )
  limit 1;
$$;

revoke all on function public.set_amazon_connector_password(uuid, text) from public, anon, authenticated;
revoke all on function public.set_amazon_connector_mfa_secret(uuid, text) from public, anon, authenticated;
revoke all on function public.get_amazon_connector_password(uuid) from public, anon, authenticated;
revoke all on function public.get_amazon_connector_mfa_secret(uuid) from public, anon, authenticated;
grant execute on function public.set_amazon_connector_password(uuid, text) to service_role;
grant execute on function public.set_amazon_connector_mfa_secret(uuid, text) to service_role;
grant execute on function public.get_amazon_connector_password(uuid) to service_role;
grant execute on function public.get_amazon_connector_mfa_secret(uuid) to service_role;

alter table public.amazon_connectors enable row level security;
alter table public.amazon_connector_tasks enable row level security;
alter table public.amazon_connector_runs enable row level security;
alter table public.amazon_connector_run_events enable row level security;

commit;
