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
  with source_rows as (
    select
      daily.station_code,
      daily.work_date,
      daily.provider_employee_id,
      nullif(trim(split_part(coalesce(daily.provider_employee_name, ''), '/', 1)), '') base_name,
      lower(regexp_replace(
        nullif(trim(split_part(coalesce(daily.provider_employee_name, ''), '/', 1)), ''),
        '[^a-zA-Z0-9]+', '', 'g'
      )) name_key,
      (
        coalesce(daily.amazon_delivery, 0)
        + coalesce(daily.c_return, 0)
        + coalesce(daily.swa_delivery, 0)
      )::bigint workload
    from public.cps_shipment_daily daily
    where daily.company_id = p_company_id
      and daily.station_code = any(p_station_codes)
      and daily.work_date between p_from and p_to
      and nullif(daily.provider_employee_id, '') is not null
  ), identified as (
    select
      source_rows.*,
      case
        when coalesce(source_rows.name_key, '') <> '' then source_rows.name_key
        else 'id:' || lower(source_rows.provider_employee_id)
      end identity_key
    from source_rows
    where source_rows.workload > 0
  ), canonical as (
    select
      identified.station_code,
      identified.identity_key,
      (array_agg(identified.provider_employee_id order by
        case when identified.provider_employee_id ~ '^[A-Za-z][A-Za-z0-9]+$' then 0 else 1 end,
        length(identified.provider_employee_id),
        identified.provider_employee_id
      ))[1] associate_id,
      max(identified.base_name) associate_name
    from identified
    group by identified.station_code, identified.identity_key
  ), daily_ranked as (
    select
      identified.*,
      row_number() over (
        partition by identified.station_code, identified.work_date, identified.identity_key
        order by identified.workload desc, identified.provider_employee_id
      ) row_rank
    from identified
  )
  select
    daily_ranked.station_code,
    daily_ranked.work_date,
    canonical.associate_id,
    coalesce(canonical.associate_name, daily_ranked.provider_employee_id) associate_name,
    daily_ranked.workload delivered,
    0::bigint volumetric,
    0::bigint small,
    daily_ranked.workload unclassified
  from daily_ranked
  join canonical
    on canonical.station_code = daily_ranked.station_code
   and canonical.identity_key = daily_ranked.identity_key
  where daily_ranked.row_rank = 1
  order by daily_ranked.work_date, canonical.associate_id;
$$;

grant execute on function public.capacity_associate_daily(uuid, text[], date, date) to service_role;
