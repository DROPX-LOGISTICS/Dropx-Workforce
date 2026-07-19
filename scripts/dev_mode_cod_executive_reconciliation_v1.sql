begin;

create table if not exists public.cod_executive_reconciliations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  business_date date not null,
  location_id uuid references public.stations(id) on delete set null,
  station_code text not null,
  provider_employee_id text not null,
  source_associate_name text,
  manual_associate_name text,
  shipment_type text,
  total_delivery numeric not null default 0,
  total_activity numeric not null default 0,
  reconciliation_status text not null default 'Pending',
  pending_amount numeric not null default 0,
  expected_amount numeric not null default 0,
  cash_500_count integer not null default 0,
  cash_200_count integer not null default 0,
  cash_100_count integer not null default 0,
  cash_50_count integer not null default 0,
  cash_20_count integer not null default 0,
  cash_10_count integer not null default 0,
  cash_other_amount numeric not null default 0,
  collected_amount numeric not null default 0,
  difference_amount numeric not null default 0,
  remarks text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cod_executive_reconciliations
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists business_date date,
  add column if not exists location_id uuid references public.stations(id) on delete set null,
  add column if not exists station_code text,
  add column if not exists provider_employee_id text,
  add column if not exists source_associate_name text,
  add column if not exists manual_associate_name text,
  add column if not exists shipment_type text,
  add column if not exists total_delivery numeric not null default 0,
  add column if not exists total_activity numeric not null default 0,
  add column if not exists reconciliation_status text not null default 'Pending',
  add column if not exists pending_amount numeric not null default 0,
  add column if not exists expected_amount numeric not null default 0,
  add column if not exists cash_500_count integer not null default 0,
  add column if not exists cash_200_count integer not null default 0,
  add column if not exists cash_100_count integer not null default 0,
  add column if not exists cash_50_count integer not null default 0,
  add column if not exists cash_20_count integer not null default 0,
  add column if not exists cash_10_count integer not null default 0,
  add column if not exists cash_other_amount numeric not null default 0,
  add column if not exists collected_amount numeric not null default 0,
  add column if not exists difference_amount numeric not null default 0,
  add column if not exists remarks text,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.cod_executive_reconciliations
set reconciliation_status = 'Pending'
where reconciliation_status is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'cod_executive_reconciliations_status_check'
  ) then
    alter table public.cod_executive_reconciliations
      add constraint cod_executive_reconciliations_status_check
      check (reconciliation_status in ('Pending', 'Completed', 'Pending Amount', 'Mismatch', 'Not applicable'));
  end if;
end $$;

create unique index if not exists cod_executive_reconciliations_unique_row
  on public.cod_executive_reconciliations(company_id, business_date, station_code, provider_employee_id);

create index if not exists cod_executive_reconciliations_company_date_idx
  on public.cod_executive_reconciliations(company_id, business_date desc);

create index if not exists cod_executive_reconciliations_station_idx
  on public.cod_executive_reconciliations(company_id, station_code, business_date desc);

do $$
begin
  if exists (
    select 1
    from pg_proc
    where proname = 'set_updated_at'
  ) then
    drop trigger if exists set_cod_executive_reconciliations_updated_at on public.cod_executive_reconciliations;
    create trigger set_cod_executive_reconciliations_updated_at
      before update on public.cod_executive_reconciliations
      for each row
      execute function public.set_updated_at();
  end if;
end $$;

alter table public.cod_executive_reconciliations enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'cod_executive_reconciliations'
      and policyname = 'service_role_cod_executive_reconciliations_all'
  ) then
    create policy "service_role_cod_executive_reconciliations_all"
      on public.cod_executive_reconciliations
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;

with wanted_pages(code, name, sort_order) as (
  values
    ('ops_pulse', 'Ops Pulse', 84),
    ('cod', 'COD', 86),
    ('cod_executive_reconciliation', 'Executive Reconciliation', 87),
    ('cod_submission', 'COD Submission', 88),
    ('cod_reports', 'COD Reports', 90),
    ('developer_mode', 'Developer Mode', 134)
)
insert into public.app_pages (company_id, code, name, sort_order, is_active, updated_at)
select companies.id, wanted_pages.code, wanted_pages.name, wanted_pages.sort_order, true, now()
from public.companies
cross join wanted_pages
where not exists (
  select 1
  from public.app_pages pages
  where pages.company_id = companies.id
    and pages.code = wanted_pages.code
);

with wanted_pages(code, name, sort_order) as (
  values
    ('ops_pulse', 'Ops Pulse', 84),
    ('cod', 'COD', 86),
    ('cod_executive_reconciliation', 'Executive Reconciliation', 87),
    ('cod_submission', 'COD Submission', 88),
    ('cod_reports', 'COD Reports', 90),
    ('developer_mode', 'Developer Mode', 134)
)
update public.app_pages pages
set name = wanted_pages.name,
    sort_order = wanted_pages.sort_order,
    is_active = true,
    updated_at = now()
from wanted_pages
where pages.code = wanted_pages.code;

with target_pages as (
  select pages.company_id, pages.id as page_id
  from public.app_pages pages
  where pages.code in ('ops_pulse', 'cod', 'cod_executive_reconciliation', 'cod_submission', 'cod_reports')
),
target_roles as (
  select roles.company_id, roles.id as role_id, target_pages.page_id
  from public.user_roles roles
  join target_pages on target_pages.company_id = roles.company_id
  where upper(roles.code) in ('OWNER', 'ADMIN')
)
insert into public.role_page_permissions (company_id, role_id, page_id, can_view, can_add, can_edit)
select target_roles.company_id, target_roles.role_id, target_roles.page_id, true, true, true
from target_roles
where not exists (
  select 1
  from public.role_page_permissions permissions
  where permissions.company_id = target_roles.company_id
    and permissions.role_id = target_roles.role_id
    and permissions.page_id = target_roles.page_id
);

with target_pages as (
  select pages.company_id, pages.id as page_id
  from public.app_pages pages
  where pages.code in ('ops_pulse', 'cod', 'cod_executive_reconciliation', 'cod_submission', 'cod_reports')
),
target_roles as (
  select roles.company_id, roles.id as role_id, target_pages.page_id
  from public.user_roles roles
  join target_pages on target_pages.company_id = roles.company_id
  where upper(roles.code) in ('OWNER', 'ADMIN')
)
update public.role_page_permissions permissions
set can_view = true,
    can_add = true,
    can_edit = true
from target_roles
where permissions.company_id = target_roles.company_id
  and permissions.role_id = target_roles.role_id
  and permissions.page_id = target_roles.page_id;

with developer_page as (
  select pages.company_id, pages.id as page_id
  from public.app_pages pages
  where pages.code = 'developer_mode'
),
owner_roles as (
  select roles.company_id, roles.id as role_id, developer_page.page_id
  from public.user_roles roles
  join developer_page on developer_page.company_id = roles.company_id
  where upper(roles.code) = 'OWNER'
)
insert into public.role_page_permissions (company_id, role_id, page_id, can_view, can_add, can_edit)
select owner_roles.company_id, owner_roles.role_id, owner_roles.page_id, true, false, true
from owner_roles
where not exists (
  select 1
  from public.role_page_permissions permissions
  where permissions.company_id = owner_roles.company_id
    and permissions.role_id = owner_roles.role_id
    and permissions.page_id = owner_roles.page_id
);

with developer_page as (
  select pages.company_id, pages.id as page_id
  from public.app_pages pages
  where pages.code = 'developer_mode'
),
owner_roles as (
  select roles.company_id, roles.id as role_id, developer_page.page_id
  from public.user_roles roles
  join developer_page on developer_page.company_id = roles.company_id
  where upper(roles.code) = 'OWNER'
)
update public.role_page_permissions permissions
set can_view = true,
    can_add = false,
    can_edit = true
from owner_roles
where permissions.company_id = owner_roles.company_id
  and permissions.role_id = owner_roles.role_id
  and permissions.page_id = owner_roles.page_id;

commit;
