create table if not exists public.fleet_fuel_transactions (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('IOC', 'BPCL')),
  transaction_id text not null,
  transaction_at timestamptz not null,
  transaction_date date not null,
  vehicle_no text not null,
  card_no text,
  product text,
  station_name text,
  station_location text,
  fuel_quantity numeric(12, 3) not null default 0,
  fuel_amount numeric(12, 2) not null default 0,
  rate numeric(12, 3),
  odometer numeric(12, 1),
  raw_payload jsonb not null default '{}'::jsonb,
  uploaded_at timestamptz not null default now(),
  unique (provider, transaction_id)
);

create index if not exists fleet_fuel_transactions_vehicle_idx
  on public.fleet_fuel_transactions (vehicle_no, transaction_date desc);

create index if not exists fleet_fuel_transactions_provider_idx
  on public.fleet_fuel_transactions (provider, transaction_date desc);

create table if not exists public.fleet_daily_km (
  id uuid primary key default gen_random_uuid(),
  vehicle_no text not null,
  movement_date date not null,
  km numeric(12, 2) not null default 0,
  source text not null default 'wheelseye',
  point_count integer not null default 0,
  calculated_at timestamptz not null default now(),
  unique (vehicle_no, movement_date, source)
);

create index if not exists fleet_daily_km_vehicle_idx
  on public.fleet_daily_km (vehicle_no, movement_date desc);

alter table public.fleet_fuel_transactions enable row level security;
alter table public.fleet_daily_km enable row level security;
