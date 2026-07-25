begin;

update public.report_import_master
set dedupe_fields = array['report date', 'station code', 'holder employee id', 'shipment type']::text[],
    updated_at = now()
where company_id = (select id from public.companies where code = 'DROPX_LOGISTICS')
  and source_code = 'amazon_shipments'
  and parser_type <> 'performance_target';

create temporary table shipment_rebuild on commit drop as
with date_batches as (
  select
    day::date as work_date,
    batch.id as batch_id,
    row_number() over (partition by day::date order by batch.created_at desc) as recency
  from generate_series(date '2026-06-01', date '2026-07-31', interval '1 day') day
  join public.report_import_batches batch
    on batch.company_id = (select id from public.companies where code = 'DROPX_LOGISTICS')
   and batch.source_type = 'amazon_shipments'
   and batch.status = 'Completed'
   and batch.report_from <= day::date
   and batch.report_to >= day::date
),
selected_batches as (
  select work_date, batch_id
  from date_batches
  where recency = 1
),
ranked_source as (
  select
    source.*,
    lower(coalesce(source.normalized_data->>'shipment_type', '')) as normalized_shipment_type,
    row_number() over (
      partition by source.batch_id, source.work_date, source.station_code,
        source.external_worker_id, lower(coalesce(source.normalized_data->>'shipment_type', ''))
      order by source.row_number
    ) as grain_rank
  from public.report_import_rows source
  join selected_batches selected
    on selected.batch_id = source.batch_id
   and selected.work_date = source.work_date
  where source.company_id = (select id from public.companies where code = 'DROPX_LOGISTICS')
    and source.normalized_data is not null
),
logical_rows as (
  select *
  from ranked_source
  where grain_rank = 1
),
aggregated as (
  select
    (select id from public.companies where code = 'DROPX_LOGISTICS') as company_id,
    max(batch_id::text)::uuid as source_batch_id,
    'Amazon'::text as client,
    work_date,
    station_code,
    external_worker_id as provider_employee_id,
    max(nullif(normalized_data->>'provider_employee_name', '')) as provider_employee_name,
    case when count(distinct normalized_shipment_type) > 1 then 'Mixed'
      else max(nullif(normalized_data->>'shipment_type', '')) end as shipment_type,
    sum(greatest(
      coalesce(nullif(normalized_data->>'amazon_delivery', '')::numeric, 0)
      - case when normalized_shipment_type = 'delivery'
        then coalesce(nullif(normalized_data->>'final_creturn_count', '')::numeric, 0)
        else 0 end,
      0
    )) as amazon_delivery,
    sum(coalesce(nullif(normalized_data->>'swa_delivery', '')::numeric, 0)) as swa_delivery,
    sum(coalesce(nullif(normalized_data->>'final_creturn_count', '')::numeric, 0)) as c_return,
    sum(coalesce(nullif(normalized_data->>'mfn', '')::numeric, 0)) as mfn,
    sum(coalesce(nullif(normalized_data->>'mfn_return', '')::numeric, 0)) as mfn_return,
    sum(coalesce(nullif(normalized_data->>'assigned_count', '')::numeric, 0)) as assigned_count,
    count(*)::integer as raw_row_count
  from logical_rows
  group by work_date, station_code, external_worker_id
)
select
  aggregated.*,
  amazon_delivery + swa_delivery as total_delivery,
  amazon_delivery + swa_delivery + c_return + mfn + mfn_return as total_activity
from aggregated;

delete from public.cps_shipment_daily current
where current.company_id = (select id from public.companies where code = 'DROPX_LOGISTICS')
  and current.client = 'Amazon'
  and current.work_date between date '2026-06-01' and date '2026-07-31'
  and not exists (
    select 1
    from shipment_rebuild rebuilt
    where rebuilt.company_id = current.company_id
      and rebuilt.work_date = current.work_date
      and rebuilt.station_code = current.station_code
      and rebuilt.provider_employee_id = current.provider_employee_id
  );

insert into public.cps_shipment_daily (
  company_id, source_batch_id, client, work_date, station_code, provider_employee_id,
  provider_employee_name, shipment_type, amazon_delivery, swa_delivery, c_return,
  mfn, mfn_return, assigned_count, raw_row_count, total_delivery, total_activity, updated_at
)
select
  company_id, source_batch_id, client, work_date, station_code, provider_employee_id,
  provider_employee_name, shipment_type, amazon_delivery, swa_delivery, c_return,
  mfn, mfn_return, assigned_count, raw_row_count, total_delivery, total_activity, now()
from shipment_rebuild
on conflict (company_id, client, work_date, station_code, provider_employee_id)
do update set
  source_batch_id = excluded.source_batch_id,
  provider_employee_name = excluded.provider_employee_name,
  shipment_type = excluded.shipment_type,
  amazon_delivery = excluded.amazon_delivery,
  swa_delivery = excluded.swa_delivery,
  c_return = excluded.c_return,
  mfn = excluded.mfn,
  mfn_return = excluded.mfn_return,
  assigned_count = excluded.assigned_count,
  raw_row_count = excluded.raw_row_count,
  total_delivery = excluded.total_delivery,
  total_activity = excluded.total_activity,
  updated_at = excluded.updated_at;

select
  min(work_date) as first_date,
  max(work_date) as last_date,
  count(distinct work_date) as covered_days,
  count(*) as rebuilt_rows,
  sum(amazon_delivery) as delivered,
  sum(swa_delivery) as swa,
  sum(c_return) as c_return,
  sum(total_activity) as total_activity
from shipment_rebuild;

commit;
