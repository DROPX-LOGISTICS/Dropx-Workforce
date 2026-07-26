-- Capacity analytics sourced from delivered shipment facts.
-- XPT facts roll up to the configured parent station.

create index if not exists delivered_shipment_facts_capacity_station_date_idx
  on public.delivered_shipment_facts (company_id, station_code, work_date);

insert into public.report_import_master (
  company_id, source_code, name, description, file_types, day_offset,
  frequency, parser_type, dedupe_fields, is_active, updated_at
) values (
  '43866344-b550-4e8a-9a2d-9d23f3d8a997',
  'capacity_shipment_size_rule',
  'Capacity shipment size rule',
  '{"maxLengthCm":35,"maxWidthCm":22,"maxHeightCm":13,"maxWeightKg":5}',
  array[]::text[], 0, 'daily', 'capacity_shipment_classification',
  array['company_id'], true, now()
) on conflict (company_id, source_code) do nothing;

create or replace function public.capacity_station_daily(
  p_company_id uuid,
  p_station_codes text[],
  p_from date,
  p_to date
) returns table (
  station_code text,
  work_date date,
  active_ids bigint,
  delivered bigint,
  shipment_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with station_scope as (
    select distinct
      station.station_code as source_station_code,
      station.station_code as output_station_code
    from public.stations station
    where station.company_id = p_company_id
      and station.station_code = any(p_station_codes)
  )
  select
    scope.output_station_code as station_code,
    facts.work_date,
    count(distinct nullif(facts.driver_id, '')) as active_ids,
    sum(greatest(facts.package_count, 1))::bigint as delivered,
    count(*)::bigint as shipment_count
  from station_scope scope
  join public.delivered_shipment_facts facts
    on facts.company_id = p_company_id
   and facts.station_code = scope.source_station_code
   and facts.work_date between p_from and p_to
  where facts.company_id = p_company_id
  group by scope.output_station_code, facts.work_date
  order by facts.work_date;
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
      (description::jsonb ->> 'maxWeightKg')::numeric max_weight_kg
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
      or facts.length_cm > rule.max_length_cm or facts.width_cm > rule.max_width_cm or facts.height_cm > rule.max_height_cm)::bigint as volumetric,
    count(*) filter (where facts.actual_weight_kg <= rule.max_weight_kg
      and facts.length_cm <= rule.max_length_cm and facts.width_cm <= rule.max_width_cm and facts.height_cm <= rule.max_height_cm)::bigint as small,
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
      (description::jsonb ->> 'maxWeightKg')::numeric max_weight_kg
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
      or facts.length_cm > rule.max_length_cm or facts.width_cm > rule.max_width_cm or facts.height_cm > rule.max_height_cm)::bigint as volumetric,
    count(*) filter (where facts.actual_weight_kg <= rule.max_weight_kg
      and facts.length_cm <= rule.max_length_cm and facts.width_cm <= rule.max_width_cm and facts.height_cm <= rule.max_height_cm)::bigint as small,
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
grant execute on function public.capacity_associate_daily(uuid, text[], date, date) to service_role;
grant execute on function public.capacity_pincode_summary(uuid, text, date, date) to service_role;
