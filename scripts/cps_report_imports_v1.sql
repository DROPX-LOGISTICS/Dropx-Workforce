begin;

create extension if not exists pgcrypto;

insert into public.app_pages (company_id, code, name, sort_order, is_active, created_at)
select companies.id, pages.code, pages.name, pages.sort_order, true, now()
from public.companies
cross join (
  values
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
    ('cps_unmapped', 'CPS Unmapped IDs', 83),
    ('imports', 'Report Imports', 70)
) as pages(code, name, sort_order)
where not exists (
  select 1
  from public.app_pages existing
  where existing.company_id = companies.id
    and existing.code = pages.code
);

create table if not exists public.report_import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_type text not null check (source_type in ('amazon_shipments', 'iocl_fuel', 'bpcl_fuel', 'cashbook')),
  file_name text not null,
  file_size bigint not null default 0,
  row_count integer not null default 0,
  imported_row_count integer not null default 0,
  skipped_row_count integer not null default 0,
  status text not null default 'Processing' check (status in ('Processing', 'Completed', 'Failed')),
  message text,
  report_from date,
  report_to date,
  created_by uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists report_import_batches_company_created_idx
  on public.report_import_batches(company_id, created_at desc);

create table if not exists public.report_import_rows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  batch_id uuid not null references public.report_import_batches(id) on delete cascade,
  source_type text not null check (source_type in ('amazon_shipments', 'iocl_fuel', 'bpcl_fuel', 'cashbook')),
  row_number integer not null,
  row_hash text not null,
  raw_data jsonb not null default '{}'::jsonb,
  normalized_data jsonb not null default '{}'::jsonb,
  work_date date,
  station_code text,
  external_worker_id text,
  amount numeric(14, 2),
  shipment_count numeric(14, 2),
  status text not null default 'Imported' check (status in ('Imported', 'Skipped', 'Error')),
  issue text,
  created_at timestamptz not null default now()
);

create unique index if not exists report_import_rows_batch_row_uidx
  on public.report_import_rows(batch_id, row_number);

create index if not exists report_import_rows_company_source_date_idx
  on public.report_import_rows(company_id, source_type, work_date desc);

create index if not exists report_import_rows_dedupe_idx
  on public.report_import_rows(company_id, source_type, row_hash);

create table if not exists public.cps_shipment_daily (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_batch_id uuid references public.report_import_batches(id) on delete set null,
  client text not null default 'Amazon',
  work_date date not null,
  station_code text not null,
  provider_employee_id text not null,
  provider_employee_name text,
  shipment_type text,
  amazon_delivery numeric(14, 2) not null default 0,
  swa_delivery numeric(14, 2) not null default 0,
  c_return numeric(14, 2) not null default 0,
  mfn numeric(14, 2) not null default 0,
  mfn_return numeric(14, 2) not null default 0,
  total_delivery numeric(14, 2) not null default 0,
  total_activity numeric(14, 2) not null default 0,
  pay_type text,
  dropx_emp_code text,
  dropx_name text,
  del_rate numeric(14, 4) not null default 0,
  c_return_rate numeric(14, 4) not null default 0,
  mfn_rate numeric(14, 4) not null default 0,
  mfn_return_rate numeric(14, 4) not null default 0,
  mg_salary numeric(14, 2) not null default 0,
  fuel_rate numeric(14, 4) not null default 0,
  variable_pay numeric(14, 2) not null default 0,
  mg_pay numeric(14, 2) not null default 0,
  fuel_pay numeric(14, 2) not null default 0,
  da_total_pay numeric(14, 2) not null default 0,
  mapping_status text not null default 'Unmapped',
  mapped_at timestamptz,
  raw_row_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cps_shipment_daily
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

create unique index if not exists cps_shipment_daily_uidx
  on public.cps_shipment_daily(company_id, client, work_date, station_code, provider_employee_id);

create index if not exists cps_shipment_daily_company_station_idx
  on public.cps_shipment_daily(company_id, station_code, work_date desc);

create table if not exists public.cps_fuel_daily (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_batch_id uuid references public.report_import_batches(id) on delete set null,
  provider text not null check (provider in ('IOC', 'BPCL', 'MANUAL')),
  transaction_id text not null,
  transaction_date date not null,
  vehicle_no text,
  station_code text,
  product text,
  litres numeric(14, 3) not null default 0,
  amount numeric(14, 2) not null default 0,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists cps_fuel_daily_provider_txn_uidx
  on public.cps_fuel_daily(company_id, provider, transaction_id);

create index if not exists cps_fuel_daily_company_station_idx
  on public.cps_fuel_daily(company_id, station_code, transaction_date desc);

create table if not exists public.cps_cashbook_daily (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_batch_id uuid references public.report_import_batches(id) on delete set null,
  expense_date date not null,
  station_code text not null,
  expense_type text,
  category text,
  cps_head text not null default 'Other CPS',
  cps_sub_head text,
  amount numeric(14, 2) not null default 0,
  remarks text,
  source_row_hash text,
  source_file_name text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists cps_cashbook_daily_company_station_idx
  on public.cps_cashbook_daily(company_id, station_code, expense_date desc);

create unique index if not exists cps_cashbook_daily_source_hash_uidx
  on public.cps_cashbook_daily(company_id, source_row_hash);

create table if not exists public.cps_station_daily (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  work_date date not null,
  station_code text not null,
  total_delivery numeric(14, 2) not null default 0,
  total_activity numeric(14, 2) not null default 0,
  c_return numeric(14, 2) not null default 0,
  mfn numeric(14, 2) not null default 0,
  mfn_return numeric(14, 2) not null default 0,
  da_pay_cost numeric(14, 2) not null default 0,
  staff_cost numeric(14, 2) not null default 0,
  utr_cost numeric(14, 2) not null default 0,
  fuel_cost numeric(14, 2) not null default 0,
  vehicle_cost numeric(14, 2) not null default 0,
  van_cost numeric(14, 2) not null default 0,
  rent_cost numeric(14, 2) not null default 0,
  other_cost numeric(14, 2) not null default 0,
  total_cost numeric(14, 2) not null default 0,
  da_cps numeric(14, 4) not null default 0,
  staff_cps numeric(14, 4) not null default 0,
  fuel_cps numeric(14, 4) not null default 0,
  other_cps numeric(14, 4) not null default 0,
  overall_cps numeric(14, 4) not null default 0,
  target_cps numeric(14, 4) not null default 0,
  target_gap numeric(14, 4) not null default 0,
  target_impact numeric(14, 2) not null default 0,
  calculated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, work_date, station_code)
);

alter table public.cps_station_daily
  add column if not exists total_activity numeric(14, 2) not null default 0,
  add column if not exists utr_cost numeric(14, 2) not null default 0,
  add column if not exists van_cost numeric(14, 2) not null default 0,
  add column if not exists target_cps numeric(14, 4) not null default 0,
  add column if not exists target_gap numeric(14, 4) not null default 0,
  add column if not exists target_impact numeric(14, 2) not null default 0;

create index if not exists cps_station_daily_company_date_idx
  on public.cps_station_daily(company_id, work_date desc, station_code);

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

alter table public.report_import_batches enable row level security;
alter table public.report_import_rows enable row level security;
alter table public.cps_shipment_daily enable row level security;
alter table public.cps_fuel_daily enable row level security;
alter table public.cps_cashbook_daily enable row level security;
alter table public.cps_station_daily enable row level security;
alter table public.cps_station_targets enable row level security;
alter table public.cps_cost_breakup_daily enable row level security;

do $policies$
declare
  table_name text;
begin
  foreach table_name in array array[
    'report_import_batches',
    'report_import_rows',
    'cps_shipment_daily',
    'cps_fuel_daily',
    'cps_cashbook_daily',
    'cps_station_daily',
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

commit;
