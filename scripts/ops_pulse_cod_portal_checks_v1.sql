begin;

alter table public.cod_station_settings
  add column if not exists portal_station_code text,
  add column if not exists amazon_driver_recon_url text,
  add column if not exists amazon_bank_deposit_url text,
  add column if not exists portal_login_url text,
  add column if not exists portal_username text,
  add column if not exists portal_secret_name text,
  add column if not exists driver_recon_due_time time,
  add column if not exists prepared_deposit_due_time time,
  add column if not exists portal_check_interval_minutes integer not null default 30,
  add column if not exists portal_checks_enabled boolean not null default false;

create table if not exists public.ops_portal_check_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.stations(id) on delete set null,
  cod_master_id uuid references public.cod_station_settings(id) on delete set null,
  station_code text not null,
  portal_station_code text,
  check_date date not null,
  check_type text not null
    check (check_type in ('driver_reconciliation', 'prepared_deposit')),
  status text not null default 'Queued'
    check (status in ('Queued', 'Running', 'Pass', 'Fail', 'Manual Review', 'Error', 'Skipped')),
  pending_count integer not null default 0,
  pending_amount numeric(14,2) not null default 0,
  summary text,
  evidence jsonb not null default '{}'::jsonb,
  raw_result jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0,
  last_checked_at timestamptz,
  next_check_at timestamptz,
  error_message text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_portal_check_runs_unique_key
    unique (company_id, location_id, check_date, check_type)
);

create index if not exists ops_portal_check_runs_company_date_idx
  on public.ops_portal_check_runs(company_id, check_date desc, check_type);

create index if not exists ops_portal_check_runs_due_idx
  on public.ops_portal_check_runs(status, next_check_at);

create table if not exists public.ops_portal_check_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  run_id uuid references public.ops_portal_check_runs(id) on delete cascade,
  event_type text not null,
  message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ops_portal_check_events_run_idx
  on public.ops_portal_check_events(run_id, created_at desc);

insert into public.app_pages (company_id, code, name, sort_order, is_active)
select companies.id, page.code, page.name, page.sort_order, true
from public.companies companies
cross join (
  values
    ('cod_portal_checks', 'COD Portal Checks', 89)
) as page(code, name, sort_order)
where companies.is_active = true
  and not exists (
    select 1
    from public.app_pages existing
    where existing.company_id = companies.id
      and existing.code = page.code
  );

update public.app_pages
set name = 'COD Portal Checks',
    is_active = true,
    updated_at = now()
where code = 'cod_portal_checks';

insert into public.role_page_permissions (
  company_id,
  role_id,
  page_id,
  can_view,
  can_add,
  can_edit
)
select roles.company_id, roles.id, pages.id, true, true, true
from public.user_roles roles
join public.app_pages pages on pages.company_id = roles.company_id
where lower(roles.code) in ('owner', 'admin')
  and pages.code in ('cod_portal_checks')
  and not exists (
    select 1
    from public.role_page_permissions existing
    where existing.company_id = roles.company_id
      and existing.role_id = roles.id
      and existing.page_id = pages.id
  );

update public.role_page_permissions permissions
set can_view = true,
    can_add = true,
    can_edit = true
from public.user_roles roles
join public.app_pages pages on pages.company_id = roles.company_id
where permissions.company_id = roles.company_id
  and permissions.role_id = roles.id
  and permissions.page_id = pages.id
  and lower(roles.code) in ('owner', 'admin')
  and pages.code in ('cod_portal_checks');

commit;
