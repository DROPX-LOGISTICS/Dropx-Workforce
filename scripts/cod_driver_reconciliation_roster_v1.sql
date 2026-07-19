begin;

create table if not exists public.cod_driver_reconciliation_roster (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid references public.stations(id) on delete set null,
  station_code text not null,
  portal_station_code text,
  business_date date not null,
  provider_employee_id text not null,
  associate_name text not null,
  normalized_associate_name text not null,
  route_code text,
  reconciliation_state text,
  pending_amount numeric(14, 2) not null default 0,
  pending_details jsonb not null default '[]'::jsonb,
  last_detail_checked_at timestamptz,
  raw_row jsonb not null default '{}'::jsonb,
  source text not null default 'scc_driver_reconciliation',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cod_driver_reconciliation_roster
  add column if not exists company_id uuid,
  add column if not exists location_id uuid,
  add column if not exists station_code text,
  add column if not exists portal_station_code text,
  add column if not exists business_date date,
  add column if not exists provider_employee_id text,
  add column if not exists associate_name text,
  add column if not exists normalized_associate_name text,
  add column if not exists route_code text,
  add column if not exists reconciliation_state text,
  add column if not exists pending_amount numeric(14, 2) not null default 0,
  add column if not exists pending_details jsonb not null default '[]'::jsonb,
  add column if not exists last_detail_checked_at timestamptz,
  add column if not exists raw_row jsonb not null default '{}'::jsonb,
  add column if not exists source text not null default 'scc_driver_reconciliation',
  add column if not exists first_seen_at timestamptz not null default now(),
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.cod_driver_reconciliation_roster
set
  normalized_associate_name = lower(
    trim(regexp_replace(coalesce(associate_name, ''), '[^a-zA-Z0-9 ]+', ' ', 'g'))
  ),
  pending_amount = coalesce(pending_amount, 0),
  pending_details = coalesce(pending_details, '[]'::jsonb),
  raw_row = coalesce(raw_row, '{}'::jsonb),
  source = coalesce(nullif(source, ''), 'scc_driver_reconciliation'),
  first_seen_at = coalesce(first_seen_at, now()),
  last_seen_at = coalesce(last_seen_at, now()),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now())
where
  normalized_associate_name is null
  or pending_amount is null
  or pending_details is null
  or raw_row is null
  or source is null
  or first_seen_at is null
  or last_seen_at is null
  or created_at is null
  or updated_at is null;

create unique index if not exists cod_driver_reconciliation_roster_unique_row
  on public.cod_driver_reconciliation_roster(company_id, business_date, station_code, provider_employee_id);

create index if not exists cod_driver_reconciliation_roster_station_date_idx
  on public.cod_driver_reconciliation_roster(company_id, station_code, business_date desc);

create index if not exists cod_driver_reconciliation_roster_seen_idx
  on public.cod_driver_reconciliation_roster(company_id, last_seen_at desc);

create index if not exists cod_driver_reconciliation_roster_pending_details_idx
  on public.cod_driver_reconciliation_roster using gin (pending_details);

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'set_updated_at'
  ) then
    drop trigger if exists set_cod_driver_reconciliation_roster_updated_at
      on public.cod_driver_reconciliation_roster;

    create trigger set_cod_driver_reconciliation_roster_updated_at
      before update on public.cod_driver_reconciliation_roster
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.cod_driver_reconciliation_roster enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'cod_driver_reconciliation_roster'
      and policyname = 'cod_driver_reconciliation_roster_service_role_all'
  ) then
    create policy cod_driver_reconciliation_roster_service_role_all
      on public.cod_driver_reconciliation_roster
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

commit;
