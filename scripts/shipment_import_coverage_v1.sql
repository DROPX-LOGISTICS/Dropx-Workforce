create table if not exists public.shipment_import_coverage (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  source_type text not null check (source_type in ('delivered_shipment_detail', 'inbound_shipment_detail')),
  parent_station_code text not null,
  business_date date not null,
  shipment_count integer not null default 0,
  latest_batch_id uuid null references public.report_import_batches(id) on delete set null,
  last_uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, source_type, parent_station_code, business_date)
);

create index if not exists shipment_import_coverage_company_date_idx
  on public.shipment_import_coverage (company_id, business_date, source_type);

alter table public.shipment_import_coverage enable row level security;

create or replace function public.refresh_shipment_import_coverage(
  p_company_id uuid,
  p_source_type text,
  p_dates date[],
  p_batch_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_source_type not in ('delivered_shipment_detail', 'inbound_shipment_detail') then
    raise exception 'Unsupported shipment source type: %', p_source_type;
  end if;

  delete from public.shipment_import_coverage
  where company_id = p_company_id
    and source_type = p_source_type
    and business_date = any(p_dates);

  if p_source_type = 'delivered_shipment_detail' then
    insert into public.shipment_import_coverage (
      company_id, source_type, parent_station_code, business_date,
      shipment_count, latest_batch_id, last_uploaded_at, updated_at
    )
    select
      f.company_id,
      p_source_type,
      coalesce(parent.station_code, station.station_code, f.station_code),
      f.work_date,
      count(*)::integer,
      p_batch_id,
      max(f.updated_at),
      now()
    from public.delivered_shipment_facts f
    left join public.stations station
      on station.company_id = f.company_id and station.station_code = f.station_code
    left join public.stations parent on parent.id = station.parent_station_id
    where f.company_id = p_company_id and f.work_date = any(p_dates)
    group by f.company_id, coalesce(parent.station_code, station.station_code, f.station_code), f.work_date;
  else
    insert into public.shipment_import_coverage (
      company_id, source_type, parent_station_code, business_date,
      shipment_count, latest_batch_id, last_uploaded_at, updated_at
    )
    select
      f.company_id,
      p_source_type,
      coalesce(parent.station_code, station.station_code, f.station_code),
      f.expected_arrival_date,
      count(*)::integer,
      p_batch_id,
      max(f.updated_at),
      now()
    from public.inbound_shipment_facts f
    left join public.stations station
      on station.company_id = f.company_id and station.station_code = f.station_code
    left join public.stations parent on parent.id = station.parent_station_id
    where f.company_id = p_company_id and f.expected_arrival_date = any(p_dates)
    group by f.company_id, coalesce(parent.station_code, station.station_code, f.station_code), f.expected_arrival_date;
  end if;
end;
$$;

do $$
declare
  coverage_company record;
begin
  for coverage_company in
    select company_id, array_agg(distinct work_date) as dates
    from public.delivered_shipment_facts
    group by company_id
  loop
    perform public.refresh_shipment_import_coverage(
      coverage_company.company_id,
      'delivered_shipment_detail',
      coverage_company.dates,
      null
    );
  end loop;

  for coverage_company in
    select company_id, array_agg(distinct expected_arrival_date) as dates
    from public.inbound_shipment_facts
    group by company_id
  loop
    perform public.refresh_shipment_import_coverage(
      coverage_company.company_id,
      'inbound_shipment_detail',
      coverage_company.dates,
      null
    );
  end loop;
end
$$;
