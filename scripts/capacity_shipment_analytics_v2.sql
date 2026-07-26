-- Capacity analytics sourced from delivered shipment facts.
-- XPT facts roll up to the configured parent station.

create index if not exists delivered_shipment_facts_capacity_station_date_idx
  on public.delivered_shipment_facts (company_id, station_code, work_date);

create table if not exists public.capacity_station_daily_cache (
  company_id uuid not null references public.companies(id) on delete cascade,
  station_code text not null,
  work_date date not null,
  active_ids bigint not null default 0,
  low_volume_ids bigint not null default 0,
  delivered bigint not null default 0,
  shipment_count bigint not null default 0,
  refreshed_at timestamptz not null default now(),
  primary key (company_id, station_code, work_date)
);
alter table public.capacity_station_daily_cache add column if not exists low_volume_ids bigint not null default 0;

create or replace function public.refresh_capacity_station_daily_cache(
  p_company_id uuid,
  p_station_codes text[],
  p_from date,
  p_to date
) returns void
language plpgsql
security definer
set search_path = public
set statement_timeout = '60s'
as $$
begin
  delete from public.capacity_station_daily_cache
  where company_id = p_company_id
    and station_code = any(p_station_codes)
    and work_date between p_from and p_to;

  insert into public.capacity_station_daily_cache (
    company_id, station_code, work_date, active_ids, low_volume_ids, delivered, shipment_count, refreshed_at
  )
  with size_rule as (
    select coalesce((description::jsonb ->> 'minActiveShipments')::integer, 5) minimum
    from public.report_import_master
    where company_id = p_company_id and source_code = 'capacity_shipment_size_rule'
    limit 1
  ), driver_daily as (
    select facts.company_id, facts.station_code, facts.work_date, facts.driver_id,
      sum(greatest(facts.package_count, 1))::bigint delivered
    from public.delivered_shipment_facts facts
    where facts.company_id = p_company_id
      and facts.station_code = any(p_station_codes)
      and facts.work_date between p_from and p_to
      and nullif(facts.driver_id, '') is not null
    group by facts.company_id, facts.station_code, facts.work_date, facts.driver_id
  )
  select driver.company_id, driver.station_code, driver.work_date,
    count(*) filter (where driver.delivered >= rule.minimum),
    count(*) filter (where driver.delivered < rule.minimum),
    sum(driver.delivered), sum(driver.delivered), now()
  from driver_daily driver cross join size_rule rule
  group by driver.company_id, driver.station_code, driver.work_date;
end;
$$;

insert into public.report_import_master (
  company_id, source_code, name, description, file_types, day_offset,
  frequency, parser_type, dedupe_fields, is_active, updated_at
) values (
  '43866344-b550-4e8a-9a2d-9d23f3d8a997',
  'capacity_shipment_size_rule',
  'Capacity shipment size rule',
  '{"maxLengthCm":46,"maxWidthCm":36,"maxHeightCm":20,"maxWeightKg":5,"dimensionalDivisor":5000,"maxDimensionalWeightKg":5,"minActiveShipments":5}',
  array[]::text[], 0, 'daily', 'capacity_shipment_classification',
  array['company_id'], true, now()
) on conflict (company_id, source_code) do update set
  description = (
    report_import_master.description::jsonb
    || '{"dimensionalDivisor":5000,"maxDimensionalWeightKg":5,"minActiveShipments":5}'::jsonb
    || case when
      (report_import_master.description::jsonb ->> 'maxLengthCm')::numeric = 35
      and (report_import_master.description::jsonb ->> 'maxWidthCm')::numeric = 22
      and (report_import_master.description::jsonb ->> 'maxHeightCm')::numeric = 13
      then '{"maxLengthCm":46,"maxWidthCm":36,"maxHeightCm":20}'::jsonb
      else '{}'::jsonb end
  )::text;

insert into public.capacity_station_daily_cache (
  company_id, station_code, work_date, active_ids, low_volume_ids, delivered, shipment_count, refreshed_at
)
with rules as (
  select company_id, coalesce((description::jsonb ->> 'minActiveShipments')::integer, 5) minimum
  from public.report_import_master where source_code = 'capacity_shipment_size_rule'
), driver_daily as (
  select facts.company_id, facts.station_code, facts.work_date, facts.driver_id,
    sum(greatest(facts.package_count, 1))::bigint delivered
  from public.delivered_shipment_facts facts
  where nullif(facts.driver_id, '') is not null
  group by facts.company_id, facts.station_code, facts.work_date, facts.driver_id
)
select driver.company_id, driver.station_code, driver.work_date,
  count(*) filter (where driver.delivered >= rule.minimum),
  count(*) filter (where driver.delivered < rule.minimum),
  sum(driver.delivered), sum(driver.delivered), now()
from driver_daily driver join rules rule on rule.company_id = driver.company_id
group by driver.company_id, driver.station_code, driver.work_date
on conflict (company_id, station_code, work_date) do update set
  active_ids = excluded.active_ids,
  low_volume_ids = excluded.low_volume_ids,
  delivered = excluded.delivered,
  shipment_count = excluded.shipment_count,
  refreshed_at = excluded.refreshed_at;

drop function if exists public.capacity_station_daily(uuid, text[], date, date);
create function public.capacity_station_daily(
  p_company_id uuid,
  p_station_codes text[],
  p_from date,
  p_to date
) returns table (
  station_code text,
  work_date date,
  active_ids bigint,
  low_volume_ids bigint,
  delivered bigint,
  shipment_count bigint
)
language sql
stable
security definer
set search_path = public
set statement_timeout = '30s'
as $$
  select
    cache.station_code,
    cache.work_date,
    cache.active_ids,
    cache.low_volume_ids,
    cache.delivered,
    cache.shipment_count
  from public.capacity_station_daily_cache cache
  where cache.company_id = p_company_id
    and cache.station_code = any(p_station_codes)
    and cache.work_date between p_from and p_to
  order by cache.work_date;
$$;

drop function if exists public.capacity_associate_daily(uuid, text[], date, date);
create function public.capacity_associate_daily(
  p_company_id uuid,
  p_station_codes text[],
  p_from date,
  p_to date
) returns table (
  station_code text,
  work_date date,
  associate_id text,
  associate_name text,
  delivered bigint,
  volumetric bigint,
  small bigint,
  unclassified bigint
)
language sql
stable
security definer
set search_path = public
set statement_timeout = '30s'
as $$
  with station_scope as (
    select distinct
      station.station_code as source_station_code,
      station.station_code as output_station_code
    from public.stations station
    where station.company_id = p_company_id
      and station.station_code = any(p_station_codes)
  ), size_rule as (
    select
      (description::jsonb ->> 'maxLengthCm')::numeric max_length_cm,
      (description::jsonb ->> 'maxWidthCm')::numeric max_width_cm,
      (description::jsonb ->> 'maxHeightCm')::numeric max_height_cm,
      (description::jsonb ->> 'maxWeightKg')::numeric max_weight_kg,
      coalesce((description::jsonb ->> 'dimensionalDivisor')::numeric, 5000) dimensional_divisor,
      coalesce((description::jsonb ->> 'maxDimensionalWeightKg')::numeric, 5) max_dimensional_weight_kg
    from public.report_import_master
    where company_id = p_company_id and source_code = 'capacity_shipment_size_rule' and is_active
    limit 1
  )
  select
    scope.output_station_code as station_code,
    facts.work_date,
    facts.driver_id as associate_id,
    max(nullif(facts.driver_name, '')) as associate_name,
    sum(greatest(facts.package_count, 1))::bigint as delivered,
    count(*) filter (where facts.actual_weight_kg > rule.max_weight_kg
      or facts.length_cm > rule.max_length_cm or facts.width_cm > rule.max_width_cm or facts.height_cm > rule.max_height_cm
      or facts.cubic_volume_cm3 / rule.dimensional_divisor > rule.max_dimensional_weight_kg)::bigint as volumetric,
    count(*) filter (where facts.actual_weight_kg <= rule.max_weight_kg
      and facts.length_cm <= rule.max_length_cm and facts.width_cm <= rule.max_width_cm and facts.height_cm <= rule.max_height_cm
      and facts.cubic_volume_cm3 / rule.dimensional_divisor <= rule.max_dimensional_weight_kg)::bigint as small,
    count(*) filter (where facts.actual_weight_kg is null or facts.length_cm is null or facts.width_cm is null or facts.height_cm is null)::bigint as unclassified
  from station_scope scope
  cross join size_rule rule
  join public.delivered_shipment_facts facts
    on facts.company_id = p_company_id
   and facts.station_code = scope.source_station_code
   and facts.work_date between p_from and p_to
  where facts.company_id = p_company_id
    and nullif(facts.driver_id, '') is not null
  group by scope.output_station_code,
    facts.work_date, facts.driver_id
  order by facts.work_date, facts.driver_id;
$$;

drop function if exists public.capacity_pincode_summary(uuid, text, date, date);
create function public.capacity_pincode_summary(
  p_company_id uuid,
  p_station_code text,
  p_from date,
  p_to date
) returns table (
  postal_code text,
  delivered bigint,
  active_ids bigint,
  active_days bigint,
  weight_ready bigint,
  dimension_ready bigint,
  volumetric bigint,
  small bigint,
  unclassified bigint,
  average_weight_kg numeric,
  average_cubic_cm3 numeric
)
language sql
stable
security definer
set search_path = public
set statement_timeout = '30s'
as $$
  with station_scope as (
    select station.station_code as source_station_code
    from public.stations station
    where station.company_id = p_company_id
      and station.station_code = p_station_code
  ), size_rule as (
    select
      (description::jsonb ->> 'maxLengthCm')::numeric max_length_cm,
      (description::jsonb ->> 'maxWidthCm')::numeric max_width_cm,
      (description::jsonb ->> 'maxHeightCm')::numeric max_height_cm,
      (description::jsonb ->> 'maxWeightKg')::numeric max_weight_kg,
      coalesce((description::jsonb ->> 'dimensionalDivisor')::numeric, 5000) dimensional_divisor,
      coalesce((description::jsonb ->> 'maxDimensionalWeightKg')::numeric, 5) max_dimensional_weight_kg
    from public.report_import_master
    where company_id = p_company_id and source_code = 'capacity_shipment_size_rule' and is_active
    limit 1
  )
  select
    facts.postal_code,
    sum(greatest(facts.package_count, 1))::bigint as delivered,
    count(distinct nullif(facts.driver_id, '')) as active_ids,
    count(distinct facts.work_date)::bigint as active_days,
    count(*) filter (where facts.actual_weight_kg is not null)::bigint as weight_ready,
    count(*) filter (where facts.cubic_volume_cm3 is not null)::bigint as dimension_ready,
    count(*) filter (where facts.actual_weight_kg > rule.max_weight_kg
      or facts.length_cm > rule.max_length_cm or facts.width_cm > rule.max_width_cm or facts.height_cm > rule.max_height_cm
      or facts.cubic_volume_cm3 / rule.dimensional_divisor > rule.max_dimensional_weight_kg)::bigint as volumetric,
    count(*) filter (where facts.actual_weight_kg <= rule.max_weight_kg
      and facts.length_cm <= rule.max_length_cm and facts.width_cm <= rule.max_width_cm and facts.height_cm <= rule.max_height_cm
      and facts.cubic_volume_cm3 / rule.dimensional_divisor <= rule.max_dimensional_weight_kg)::bigint as small,
    count(*) filter (where facts.actual_weight_kg is null or facts.length_cm is null or facts.width_cm is null or facts.height_cm is null)::bigint as unclassified,
    avg(facts.actual_weight_kg)::numeric as average_weight_kg,
    avg(facts.cubic_volume_cm3)::numeric as average_cubic_cm3
  from station_scope scope
  cross join size_rule rule
  join public.delivered_shipment_facts facts
    on facts.company_id = p_company_id
   and facts.station_code = scope.source_station_code
   and facts.work_date between p_from and p_to
  where facts.company_id = p_company_id
    and nullif(facts.postal_code, '') is not null
  group by facts.postal_code
  order by delivered desc;
$$;

grant execute on function public.capacity_station_daily(uuid, text[], date, date) to service_role;
grant execute on function public.refresh_capacity_station_daily_cache(uuid, text[], date, date) to service_role;
grant execute on function public.capacity_associate_daily(uuid, text[], date, date) to service_role;
grant execute on function public.capacity_pincode_summary(uuid, text, date, date) to service_role;
