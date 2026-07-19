begin;

alter table if exists public.cps_cashbook_daily
  add column if not exists source_row_hash text,
  add column if not exists source_file_name text;

create unique index if not exists cps_cashbook_daily_source_hash_uidx
  on public.cps_cashbook_daily(company_id, source_row_hash);

create index if not exists report_import_rows_dedupe_idx
  on public.report_import_rows(company_id, source_type, row_hash);

alter table if exists public.cps_shipment_daily
  add column if not exists pay_type text,
  add column if not exists dropx_emp_code text,
  add column if not exists dropx_name text,
  add column if not exists del_rate numeric(14, 4) not null default 0,
  add column if not exists c_return_rate numeric(14, 4) not null default 0,
  add column if not exists mfn_rate numeric(14, 4) not null default 0,
  add column if not exists mfn_return_rate numeric(14, 4) not null default 0,
  add column if not exists mg_salary numeric(14, 2) not null default 0,
  add column if not exists fuel_rate numeric(14, 4) not null default 0,
  add column if not exists variable_pay numeric(14, 2) not null default 0,
  add column if not exists mg_pay numeric(14, 2) not null default 0,
  add column if not exists fuel_pay numeric(14, 2) not null default 0,
  add column if not exists da_total_pay numeric(14, 2) not null default 0,
  add column if not exists mapping_status text not null default 'Unmapped',
  add column if not exists mapped_at timestamptz;

alter table if exists public.cps_station_daily
  add column if not exists total_activity numeric(14, 2) not null default 0,
  add column if not exists utr_cost numeric(14, 2) not null default 0,
  add column if not exists van_cost numeric(14, 2) not null default 0,
  add column if not exists target_cps numeric(14, 4) not null default 0,
  add column if not exists target_gap numeric(14, 4) not null default 0,
  add column if not exists target_impact numeric(14, 2) not null default 0;

create table if not exists public.cps_station_targets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  station_code text not null,
  target_cps numeric(14, 4) not null default 0,
  effective_from date not null default current_date,
  is_active boolean not null default true,
  remarks text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, station_code, effective_from)
);

create index if not exists cps_station_targets_lookup_idx
  on public.cps_station_targets(company_id, station_code, is_active, effective_from desc);

create table if not exists public.cps_cost_breakup_daily (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  work_date date not null,
  station_code text not null,
  head text not null,
  sub_head text not null,
  source text not null,
  amount numeric(14, 2) not null default 0,
  count numeric(14, 2) not null default 0,
  cps numeric(14, 4) not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists cps_cost_breakup_daily_lookup_idx
  on public.cps_cost_breakup_daily(company_id, work_date desc, station_code, head);

alter table public.cps_station_targets enable row level security;
alter table public.cps_cost_breakup_daily enable row level security;

do $policies$
declare
  table_name text;
begin
  foreach table_name in array array[
    'cps_station_targets',
    'cps_cost_breakup_daily'
  ]
  loop
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = table_name
        and policyname = table_name || '_service_role_all'
    ) then
      execute format(
        'create policy %I on public.%I for all using (auth.role() = ''service_role'') with check (auth.role() = ''service_role'')',
        table_name || '_service_role_all',
        table_name
      );
    end if;
  end loop;
end
$policies$;

insert into public.app_pages (company_id, code, name, sort_order, is_active, created_at)
select companies.id, pages.code, pages.name, pages.sort_order, true, now()
from public.companies
cross join (
  values
    ('imports', 'Report Imports', 70),
    ('cps', 'CPS', 73),
    ('cps_overview', 'CPS Overview', 74),
    ('cps_daily', 'Daily CPS', 75),
    ('cps_monthly', 'Monthly CPS', 76),
    ('cps_cost_breakup', 'CPS Cost Breakup', 77),
    ('cps_stations', 'CPS Stations', 78),
    ('cps_shipments', 'CPS Shipments', 79),
    ('cps_associates', 'CPS Associates', 80),
    ('cps_reports', 'CPS Reports', 81),
    ('cps_inputs', 'CPS Inputs', 82),
    ('cps_unmapped', 'CPS Unmapped IDs', 83)
) as pages(code, name, sort_order)
where not exists (
  select 1
  from public.app_pages existing
  where existing.company_id = companies.id
    and existing.code = pages.code
);

insert into public.role_page_permissions (role_id, page_id, can_view, can_add, can_edit, created_at, updated_at)
select roles.id, pages.id, true, true, true, now(), now()
from public.user_roles roles
join public.app_pages pages on pages.company_id = roles.company_id
where roles.code in ('owner', 'admin')
  and pages.code in ('imports', 'cps', 'cps_overview', 'cps_daily', 'cps_monthly', 'cps_cost_breakup', 'cps_stations', 'cps_shipments', 'cps_associates', 'cps_reports', 'cps_inputs', 'cps_unmapped')
  and not exists (
    select 1
    from public.role_page_permissions existing
    where existing.role_id = roles.id
      and existing.page_id = pages.id
  );

update public.role_page_permissions permissions
set
  can_view = true,
  can_add = true,
  can_edit = true,
  updated_at = now()
from public.user_roles roles
join public.app_pages pages on pages.company_id = roles.company_id
where permissions.role_id = roles.id
  and permissions.page_id = pages.id
  and roles.code in ('owner', 'admin')
  and pages.code in ('imports', 'cps', 'cps_overview', 'cps_daily', 'cps_monthly', 'cps_cost_breakup', 'cps_stations', 'cps_shipments', 'cps_associates', 'cps_reports', 'cps_inputs', 'cps_unmapped');

commit;
