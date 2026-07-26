create table if not exists public.delivered_shipment_facts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  tracking_id text not null,
  station_code text not null,
  work_date date not null,
  last_updated_at timestamptz not null,
  final_state text not null,
  last_scan_status text,
  driver_id text not null,
  driver_name text,
  postal_code text not null,
  city text,
  package_count integer not null default 1,
  actual_weight_kg numeric,
  length_cm numeric,
  width_cm numeric,
  height_cm numeric,
  cubic_volume_cm3 numeric,
  source_batch_id uuid references public.report_import_batches(id) on delete set null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, tracking_id)
);

create index if not exists delivered_shipment_facts_company_date_station_idx
  on public.delivered_shipment_facts(company_id, work_date, station_code);
create index if not exists delivered_shipment_facts_company_driver_date_idx
  on public.delivered_shipment_facts(company_id, driver_id, work_date);
create index if not exists delivered_shipment_facts_company_postal_date_idx
  on public.delivered_shipment_facts(company_id, postal_code, work_date);

alter table public.delivered_shipment_facts enable row level security;

insert into public.report_import_master (
  company_id, source_code, name, description, file_types, day_offset,
  upload_time, frequency, weekday, parser_type, dedupe_fields, is_active, updated_at
)
values (
  '43866344-b550-4e8a-9a2d-9d23f3d8a997',
  'delivered_shipment_detail',
  'Delivered Shipment Detail',
  'Tracking-level D-1 delivery data for associate SPR, pincode capacity and package-size analysis.',
  array['xlsx','xls','csv'],
  -1,
  '09:00',
  'daily',
  null,
  'delivered_shipment_detail',
  array['Tracking ID'],
  true,
  now()
)
on conflict (company_id, source_code) do update set
  name = excluded.name,
  description = excluded.description,
  file_types = excluded.file_types,
  day_offset = excluded.day_offset,
  upload_time = excluded.upload_time,
  frequency = excluded.frequency,
  parser_type = excluded.parser_type,
  dedupe_fields = excluded.dedupe_fields,
  is_active = true,
  updated_at = now();
