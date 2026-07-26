-- Capacity analytics sourced from delivered shipment facts.
-- XPT facts roll up to the configured parent station.

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
  select
    coalesce(parent.station_code, station.station_code, facts.station_code) as station_code,
    facts.work_date,
    count(distinct nullif(facts.driver_id, '')) as active_ids,
    sum(greatest(facts.package_count, 1))::bigint as delivered,
    count(*)::bigint as shipment_count
  from public.delivered_shipment_facts facts
  left join public.stations station
    on station.company_id = facts.company_id
   and station.station_code = facts.station_code
  left join public.stations parent on parent.id = station.parent_station_id
  where facts.company_id = p_company_id
    and facts.work_date between p_from and p_to
    and coalesce(parent.station_code, station.station_code, facts.station_code) = any(p_station_codes)
  group by coalesce(parent.station_code, station.station_code, facts.station_code), facts.work_date
  order by facts.work_date;
$$;

create or replace function public.capacity_associate_daily(
  p_company_id uuid,
  p_station_codes text[],
  p_from date,
  p_to date
) returns table (
  station_code text,
  work_date date,
  associate_id text,
  associate_name text,
  delivered bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(parent.station_code, station.station_code, facts.station_code) as station_code,
    facts.work_date,
    facts.driver_id as associate_id,
    max(nullif(facts.driver_name, '')) as associate_name,
    sum(greatest(facts.package_count, 1))::bigint as delivered
  from public.delivered_shipment_facts facts
  left join public.stations station
    on station.company_id = facts.company_id
   and station.station_code = facts.station_code
  left join public.stations parent on parent.id = station.parent_station_id
  where facts.company_id = p_company_id
    and facts.work_date between p_from and p_to
    and nullif(facts.driver_id, '') is not null
    and coalesce(parent.station_code, station.station_code, facts.station_code) = any(p_station_codes)
  group by coalesce(parent.station_code, station.station_code, facts.station_code),
    facts.work_date, facts.driver_id
  order by facts.work_date, facts.driver_id;
$$;

create or replace function public.capacity_pincode_summary(
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
  average_weight_kg numeric,
  average_cubic_cm3 numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    facts.postal_code,
    sum(greatest(facts.package_count, 1))::bigint as delivered,
    count(distinct nullif(facts.driver_id, '')) as active_ids,
    count(distinct facts.work_date)::bigint as active_days,
    count(*) filter (where facts.actual_weight_kg is not null)::bigint as weight_ready,
    count(*) filter (where facts.cubic_volume_cm3 is not null)::bigint as dimension_ready,
    avg(facts.actual_weight_kg)::numeric as average_weight_kg,
    avg(facts.cubic_volume_cm3)::numeric as average_cubic_cm3
  from public.delivered_shipment_facts facts
  left join public.stations station
    on station.company_id = facts.company_id
   and station.station_code = facts.station_code
  left join public.stations parent on parent.id = station.parent_station_id
  where facts.company_id = p_company_id
    and facts.work_date between p_from and p_to
    and coalesce(parent.station_code, station.station_code, facts.station_code) = p_station_code
    and nullif(facts.postal_code, '') is not null
  group by facts.postal_code
  order by delivered desc;
$$;

grant execute on function public.capacity_station_daily(uuid, text[], date, date) to service_role;
grant execute on function public.capacity_associate_daily(uuid, text[], date, date) to service_role;
grant execute on function public.capacity_pincode_summary(uuid, text, date, date) to service_role;
