create table if not exists public.inbound_shipment_facts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  tracking_id text not null,
  station_code text not null,
  expected_arrival_date date not null,
  snapshot_at timestamptz,
  shipment_state text,
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

create index if not exists inbound_shipment_facts_company_arrival_station_idx
  on public.inbound_shipment_facts(company_id, expected_arrival_date, station_code);
create index if not exists inbound_shipment_facts_company_postal_arrival_idx
  on public.inbound_shipment_facts(company_id, postal_code, expected_arrival_date);

alter table public.inbound_shipment_facts enable row level security;

update public.report_import_master
set upload_time = '08:00', updated_at = now()
where company_id = '43866344-b550-4e8a-9a2d-9d23f3d8a997'
  and source_code = 'delivered_shipment_detail';

insert into public.report_import_master (
  company_id, source_code, name, description, file_types, day_offset,
  upload_time, frequency, weekday, parser_type, dedupe_fields, is_active, updated_at
)
values (
  '43866344-b550-4e8a-9a2d-9d23f3d8a997',
  'inbound_shipment_detail',
  'Inbound Shipment Detail',
  'Tracking-level expected station arrivals. The embedded expected-arrival date controls the capacity day, regardless of upload date.',
  array['xlsx','xls','csv'],
  0,
  '22:00',
  'daily',
  null,
  'inbound_shipment_detail',
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
