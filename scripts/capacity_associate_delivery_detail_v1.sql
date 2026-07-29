-- On-demand associate delivery detail.
-- This intentionally reads only tracking-level Delivered Shipment Detail facts.
-- It does not change capacity, SPR, or Daily Shipment Count calculations.

drop function if exists public.capacity_associate_delivered_daily(uuid, text, text, text, date, date);
create function public.capacity_associate_delivered_daily(
  p_company_id uuid,
  p_station_code text,
  p_associate_id text,
  p_associate_name text,
  p_from date,
  p_to date
) returns table (
  work_date date,
  delivered bigint,
  volumetric bigint,
  small bigint,
  unclassified bigint
)
language sql
stable
security definer
set search_path = public
set statement_timeout = '15s'
as $$
  with requested_identity as (
    select
      nullif(regexp_replace(upper(coalesce(p_associate_name, '')), '[^A-Z0-9]+', '', 'g'), '') full_name,
      nullif(regexp_replace(upper(split_part(coalesce(p_associate_name, ''), '/', 1)), '[^A-Z0-9]+', '', 'g'), '') base_name
  ), size_rule as (
    select
      (description::jsonb ->> 'maxLengthCm')::numeric max_length_cm,
      (description::jsonb ->> 'maxWidthCm')::numeric max_width_cm,
      (description::jsonb ->> 'maxHeightCm')::numeric max_height_cm,
      (description::jsonb ->> 'maxWeightKg')::numeric max_weight_kg,
      coalesce((description::jsonb ->> 'dimensionalDivisor')::numeric, 5000) dimensional_divisor,
      coalesce((description::jsonb ->> 'maxDimensionalWeightKg')::numeric, 5) max_dimensional_weight_kg
    from public.report_import_master
    where company_id = p_company_id
      and source_code = 'capacity_shipment_size_rule'
      and is_active
    limit 1
  ), matched as (
    select facts.*, greatest(facts.package_count, 1)::bigint packages,
      case
        when facts.actual_weight_kg > rule.max_weight_kg
          or facts.length_cm > rule.max_length_cm
          or facts.width_cm > rule.max_width_cm
          or facts.height_cm > rule.max_height_cm
          or facts.cubic_volume_cm3 / rule.dimensional_divisor > rule.max_dimensional_weight_kg
          then 'volumetric'
        when facts.actual_weight_kg is not null
          and facts.length_cm is not null
          and facts.width_cm is not null
          and facts.height_cm is not null
          then 'small'
        else 'unclassified'
      end size_class
    from public.delivered_shipment_facts facts
    cross join size_rule rule
    cross join requested_identity identity
    where facts.company_id = p_company_id
      and facts.station_code = upper(trim(p_station_code))
      and facts.work_date between p_from and p_to
      and (
        upper(trim(facts.driver_id)) = upper(trim(p_associate_id))
        or regexp_replace(upper(coalesce(facts.driver_name, '')), '[^A-Z0-9]+', '', 'g')
          in (identity.full_name, identity.base_name)
      )
  )
  select matched.work_date,
    sum(matched.packages)::bigint delivered,
    sum(matched.packages) filter (where matched.size_class = 'volumetric')::bigint volumetric,
    sum(matched.packages) filter (where matched.size_class = 'small')::bigint small,
    sum(matched.packages) filter (where matched.size_class = 'unclassified')::bigint unclassified
  from matched
  group by matched.work_date
  order by matched.work_date;
$$;

drop function if exists public.capacity_associate_pincode_summary(uuid, text, text, text, date, date);
create function public.capacity_associate_pincode_summary(
  p_company_id uuid,
  p_station_code text,
  p_associate_id text,
  p_associate_name text,
  p_from date,
  p_to date
) returns table (
  postal_code text,
  delivered bigint,
  active_days bigint,
  volumetric bigint,
  small bigint,
  unclassified bigint
)
language sql
stable
security definer
set search_path = public
set statement_timeout = '15s'
as $$
  with requested_identity as (
    select
      nullif(regexp_replace(upper(coalesce(p_associate_name, '')), '[^A-Z0-9]+', '', 'g'), '') full_name,
      nullif(regexp_replace(upper(split_part(coalesce(p_associate_name, ''), '/', 1)), '[^A-Z0-9]+', '', 'g'), '') base_name
  ), size_rule as (
    select
      (description::jsonb ->> 'maxLengthCm')::numeric max_length_cm,
      (description::jsonb ->> 'maxWidthCm')::numeric max_width_cm,
      (description::jsonb ->> 'maxHeightCm')::numeric max_height_cm,
      (description::jsonb ->> 'maxWeightKg')::numeric max_weight_kg,
      coalesce((description::jsonb ->> 'dimensionalDivisor')::numeric, 5000) dimensional_divisor,
      coalesce((description::jsonb ->> 'maxDimensionalWeightKg')::numeric, 5) max_dimensional_weight_kg
    from public.report_import_master
    where company_id = p_company_id
      and source_code = 'capacity_shipment_size_rule'
      and is_active
    limit 1
  ), matched as (
    select facts.*, greatest(facts.package_count, 1)::bigint packages,
      case
        when facts.actual_weight_kg > rule.max_weight_kg
          or facts.length_cm > rule.max_length_cm
          or facts.width_cm > rule.max_width_cm
          or facts.height_cm > rule.max_height_cm
          or facts.cubic_volume_cm3 / rule.dimensional_divisor > rule.max_dimensional_weight_kg
          then 'volumetric'
        when facts.actual_weight_kg is not null
          and facts.length_cm is not null
          and facts.width_cm is not null
          and facts.height_cm is not null
          then 'small'
        else 'unclassified'
      end size_class
    from public.delivered_shipment_facts facts
    cross join size_rule rule
    cross join requested_identity identity
    where facts.company_id = p_company_id
      and facts.station_code = upper(trim(p_station_code))
      and facts.work_date between p_from and p_to
      and nullif(trim(facts.postal_code), '') is not null
      and (
        upper(trim(facts.driver_id)) = upper(trim(p_associate_id))
        or regexp_replace(upper(coalesce(facts.driver_name, '')), '[^A-Z0-9]+', '', 'g')
          in (identity.full_name, identity.base_name)
      )
  )
  select matched.postal_code,
    sum(matched.packages)::bigint delivered,
    count(distinct matched.work_date)::bigint active_days,
    sum(matched.packages) filter (where matched.size_class = 'volumetric')::bigint volumetric,
    sum(matched.packages) filter (where matched.size_class = 'small')::bigint small,
    sum(matched.packages) filter (where matched.size_class = 'unclassified')::bigint unclassified
  from matched
  group by matched.postal_code
  order by delivered desc, matched.postal_code;
$$;

grant execute on function public.capacity_associate_delivered_daily(uuid, text, text, text, date, date) to service_role;
grant execute on function public.capacity_associate_pincode_summary(uuid, text, text, text, date, date) to service_role;
