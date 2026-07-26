-- Capacity station/day planning blends three operational sources:
-- 1) delivered tracking detail, 2) Amazon daily shipment count, 3) inbound detail.
-- Detailed delivery facts remain the preferred delivered-volume source when present.

create index if not exists cps_shipment_daily_capacity_station_date_idx
  on public.cps_shipment_daily (company_id, station_code, work_date);
create index if not exists inbound_shipment_facts_capacity_station_date_idx
  on public.inbound_shipment_facts (company_id, station_code, expected_arrival_date);

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
  shipment_count bigint,
  inbound bigint,
  detail_active_ids bigint,
  daily_count_active_ids bigint,
  volume_source text
)
language sql
stable
security definer
set search_path = public
set statement_timeout = '30s'
as $$
  with rule as (
    select coalesce((description::jsonb ->> 'minActiveShipments')::integer, 5) minimum
    from public.report_import_master
    where company_id = p_company_id and source_code = 'capacity_shipment_size_rule'
    limit 1
  ), detail as (
    select cache.station_code, cache.work_date,
      cache.active_ids, cache.low_volume_ids, cache.delivered
    from public.capacity_station_daily_cache cache
    where cache.company_id = p_company_id
      and cache.station_code = any(p_station_codes)
      and cache.work_date between p_from and p_to
  ), count_source as (
    select daily.station_code, daily.work_date,
      count(distinct daily.provider_employee_id)
        filter (where coalesce(daily.total_delivery, 0) >= rule.minimum)::bigint as active_ids,
      count(distinct daily.provider_employee_id)
        filter (where coalesce(daily.total_delivery, 0) > 0 and coalesce(daily.total_delivery, 0) < rule.minimum)::bigint as low_volume_ids,
      sum(coalesce(daily.total_delivery, 0))::bigint as delivered
    from public.cps_shipment_daily daily cross join rule
    where daily.company_id = p_company_id
      and daily.station_code = any(p_station_codes)
      and daily.work_date between p_from and p_to
    group by daily.station_code, daily.work_date
  ), inbound_source as (
    select facts.station_code, facts.expected_arrival_date work_date,
      sum(greatest(facts.package_count, 1))::bigint inbound
    from public.inbound_shipment_facts facts
    where facts.company_id = p_company_id
      and facts.station_code = any(p_station_codes)
      and facts.expected_arrival_date between p_from and p_to
    group by facts.station_code, facts.expected_arrival_date
  ), keys as (
    select detail.station_code, detail.work_date from detail
    union
    select count_source.station_code, count_source.work_date from count_source
    union
    select inbound_source.station_code, inbound_source.work_date from inbound_source
  )
  select keys.station_code, keys.work_date,
    greatest(coalesce(detail.active_ids, 0), coalesce(count_source.active_ids, 0))::bigint active_ids,
    greatest(coalesce(detail.low_volume_ids, 0), coalesce(count_source.low_volume_ids, 0))::bigint low_volume_ids,
    coalesce(nullif(detail.delivered, 0), count_source.delivered, 0)::bigint delivered,
    coalesce(nullif(detail.delivered, 0), count_source.delivered, 0)::bigint shipment_count,
    coalesce(inbound_source.inbound, 0)::bigint inbound,
    coalesce(detail.active_ids, 0)::bigint detail_active_ids,
    coalesce(count_source.active_ids, 0)::bigint daily_count_active_ids,
    case
      when coalesce(detail.delivered, 0) > 0 and coalesce(count_source.delivered, 0) > 0 then 'Delivered detail + daily count'
      when coalesce(detail.delivered, 0) > 0 then 'Delivered detail'
      when coalesce(count_source.delivered, 0) > 0 then 'Daily shipment count'
      when coalesce(inbound_source.inbound, 0) > 0 then 'Inbound only'
      else 'No source'
    end volume_source
  from keys
  left join detail using (station_code, work_date)
  left join count_source using (station_code, work_date)
  left join inbound_source using (station_code, work_date)
  order by keys.work_date;
$$;

grant execute on function public.capacity_station_daily(uuid, text[], date, date) to service_role;

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
  with size_rule as (
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
  ), detail as (
    select facts.station_code, facts.work_date, facts.driver_id associate_id,
      max(nullif(facts.driver_name, '')) associate_name,
      sum(greatest(facts.package_count, 1))::bigint delivered,
      count(*) filter (where facts.actual_weight_kg > rule.max_weight_kg
        or facts.length_cm > rule.max_length_cm or facts.width_cm > rule.max_width_cm or facts.height_cm > rule.max_height_cm
        or facts.cubic_volume_cm3 / rule.dimensional_divisor > rule.max_dimensional_weight_kg)::bigint volumetric,
      count(*) filter (where facts.actual_weight_kg <= rule.max_weight_kg
        and facts.length_cm <= rule.max_length_cm and facts.width_cm <= rule.max_width_cm and facts.height_cm <= rule.max_height_cm
        and facts.cubic_volume_cm3 / rule.dimensional_divisor <= rule.max_dimensional_weight_kg)::bigint small,
      count(*) filter (where facts.actual_weight_kg is null or facts.length_cm is null or facts.width_cm is null or facts.height_cm is null)::bigint unclassified
    from public.delivered_shipment_facts facts cross join size_rule rule
    where facts.company_id = p_company_id
      and facts.station_code = any(p_station_codes)
      and facts.work_date between p_from and p_to
      and nullif(facts.driver_id, '') is not null
    group by facts.station_code, facts.work_date, facts.driver_id
  ), count_fallback as (
    select daily.station_code, daily.work_date,
      daily.provider_employee_id associate_id,
      max(nullif(daily.provider_employee_name, '')) associate_name,
      sum(coalesce(daily.total_delivery, 0))::bigint delivered
    from public.cps_shipment_daily daily
    where daily.company_id = p_company_id
      and daily.station_code = any(p_station_codes)
      and daily.work_date between p_from and p_to
      and nullif(daily.provider_employee_id, '') is not null
      and not exists (
        select 1 from detail
        where detail.station_code = daily.station_code
          and detail.work_date = daily.work_date
          and detail.associate_id = daily.provider_employee_id
      )
    group by daily.station_code, daily.work_date, daily.provider_employee_id
  )
  select detail.station_code, detail.work_date, detail.associate_id, detail.associate_name,
    detail.delivered, detail.volumetric, detail.small, detail.unclassified
  from detail
  union all
  select count_fallback.station_code, count_fallback.work_date, count_fallback.associate_id, count_fallback.associate_name,
    count_fallback.delivered, 0::bigint, 0::bigint, count_fallback.delivered
  from count_fallback
  order by work_date, associate_id;
$$;

grant execute on function public.capacity_associate_daily(uuid, text[], date, date) to service_role;
