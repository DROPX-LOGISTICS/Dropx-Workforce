begin;

alter table public.report_import_batches
  drop constraint if exists report_import_batches_source_type_check;

alter table public.report_import_rows
  drop constraint if exists report_import_rows_source_type_check;

create table if not exists public.report_import_master (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_code text not null,
  name text not null,
  description text,
  file_types text[] not null default array['xlsx']::text[],
  day_offset integer not null default 0,
  upload_time time,
  frequency text not null default 'daily' check (frequency in ('daily', 'weekly', 'monthly', 'adhoc')),
  weekday smallint check (weekday between 0 and 6),
  parser_type text not null,
  dedupe_fields text[] not null default array[]::text[],
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, source_code)
);

create index if not exists report_import_master_company_active_idx
  on public.report_import_master(company_id, is_active, name);

create table if not exists public.report_metric_facts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  batch_id uuid not null references public.report_import_batches(id) on delete cascade,
  source_type text not null,
  report_year integer,
  report_week integer,
  report_date date,
  page_number integer not null,
  row_number integer not null,
  station_code text,
  row_label text,
  raw_text text not null,
  values_json jsonb not null default '[]'::jsonb,
  row_hash text not null,
  created_at timestamptz not null default now(),
  unique(company_id, source_type, row_hash)
);

create index if not exists report_metric_facts_lookup_idx
  on public.report_metric_facts(company_id, source_type, report_date desc, station_code);

insert into public.report_import_master (
  company_id, source_code, name, description, file_types, day_offset,
  upload_time, frequency, weekday, parser_type, dedupe_fields
)
select
  companies.id, seed.source_code, seed.name, seed.description, seed.file_types,
  seed.day_offset, seed.upload_time, seed.frequency, seed.weekday,
  seed.parser_type, seed.dedupe_fields
from public.companies
cross join (
  values
    ('amazon_shipments', 'Amazon Daily Shipment Count', 'Station/date/associate delivery counts. Feeds CPS denominator and DA activity.', array['csv','xlsx','xls']::text[], -1, '15:00'::time, 'daily', null::smallint, 'amazon_shipments', array['report date','station code','holder employee id']::text[]),
    ('iocl_fuel', 'IOCL Fuel', 'IOCL fuel transactions mapped to station through the vehicle master.', array['csv']::text[], 0, '22:00'::time, 'daily', null::smallint, 'iocl_fuel', array['transaction id']::text[]),
    ('bpcl_fuel', 'BPCL Fuel', 'BPCL fuel transactions mapped to station through the vehicle master.', array['xlsx','xls']::text[], 0, '22:00'::time, 'daily', null::smallint, 'bpcl_fuel', array['transaction id']::text[]),
    ('cashbook', 'Cashbook', 'Station expense rows normalized into CPS cost heads.', array['xlsx','xls']::text[], 0, '22:00'::time, 'daily', null::smallint, 'cashbook', array['txn id']::text[]),
    ('edsp_sls_scorecard', 'EDSP_SLS_Scorecard', 'Weekly Amazon EDSP SLS scorecard converted from PDF into queryable metric rows.', array['pdf']::text[], 0, '15:00'::time, 'weekly', 3::smallint, 'pdf_scorecard', array['report year','report week','page','row']::text[]),
    ('daily_edsp_metrics', 'Daily_EDSP_Metrics', 'Daily Amazon EDSP metrics converted from PDF into queryable metric rows.', array['pdf']::text[], 0, null::time, 'daily', null::smallint, 'pdf_daily_metrics', array['report date','page','row']::text[])
) as seed(source_code, name, description, file_types, day_offset, upload_time, frequency, weekday, parser_type, dedupe_fields)
on conflict (company_id, source_code) do update set
  name = excluded.name,
  description = excluded.description,
  file_types = excluded.file_types,
  day_offset = excluded.day_offset,
  upload_time = excluded.upload_time,
  frequency = excluded.frequency,
  weekday = excluded.weekday,
  parser_type = excluded.parser_type,
  dedupe_fields = excluded.dedupe_fields,
  updated_at = now();

alter table public.report_import_master enable row level security;
alter table public.report_metric_facts enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'report_import_master' and policyname = 'report_import_master_service_role_all') then
    create policy report_import_master_service_role_all on public.report_import_master
      for all to service_role using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'report_metric_facts' and policyname = 'report_metric_facts_service_role_all') then
    create policy report_metric_facts_service_role_all on public.report_metric_facts
      for all to service_role using (true) with check (true);
  end if;
end $$;

commit;
