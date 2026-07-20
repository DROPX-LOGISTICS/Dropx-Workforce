-- Biometric attendance enrichment v2
-- Purpose:
--   Remove worker-specific/manual reporting fixes by keeping attendance_daily enriched from master data.
--   Safe to run repeatedly.

begin;

alter table public.biometric_middleware_settings
  add column if not exists enrolment_start_number integer not null default 1;

alter table public.attendance_daily
  add column if not exists employee_code text,
  add column if not exists station_code text,
  add column if not exists worker_name text;

update public.attendance_daily ad
set
  employee_code = coalesce(ad.employee_code, e.employee_code, fe.dropx_id),
  worker_name = coalesce(ad.worker_name, e.full_name, fe.full_name),
  station_code = coalesce(ad.station_code, s.station_code)
from public.attendance_daily target
left join public.employees e
  on e.id = target.employee_id
 and e.company_id = target.company_id
left join public.field_executives fe
  on fe.id = target.field_executive_id
 and fe.company_id = target.company_id
left join public.stations s
  on s.id = target.location_id
 and s.company_id = target.company_id
where ad.id = target.id
  and (
    ad.employee_code is null
    or ad.worker_name is null
    or ad.station_code is null
  );

with ordered_punches as (
  select
    p.id,
    p.company_id,
    p.enrolment_id,
    p.punch_date,
    p.punch_time,
    p.worker_type,
    p.employee_id,
    p.field_executive_id,
    p.location_id,
    row_number() over (
      partition by p.company_id, p.enrolment_id, p.punch_date
      order by p.punch_time asc, p.id asc
    ) as punch_order
  from public.attendance_punches p
  where p.calculated is true
),
relabelled_punches as (
  update public.attendance_punches p
  set
    punch_order = op.punch_order,
    punch_label = case
      when op.punch_order = 1 then 'In1'
      else 'Out' || (op.punch_order - 1)::text
    end
  from ordered_punches op
  where p.id = op.id
  returning
    op.company_id,
    op.enrolment_id,
    op.punch_date,
    op.punch_time,
    op.worker_type,
    op.employee_id,
    op.field_executive_id,
    op.location_id,
    op.punch_order
),
daily_summary as (
  select
    company_id,
    enrolment_id,
    punch_date,
    min(punch_time) as in_time,
    case when count(*) >= 2 then max(punch_time) else null end as out_time,
    count(*) as punch_count,
    case
      when count(*) >= 2 then round(extract(epoch from (max(punch_time) - min(punch_time))) / 60)::integer
      else 0
    end as work_minutes,
    case
      when count(*) = 0 then 'No punch'
      when count(*) = 1 then 'Single punch'
      else null
    end as remark
  from relabelled_punches
  group by company_id, enrolment_id, punch_date
),
latest_worker as (
  select distinct on (company_id, enrolment_id, punch_date)
    company_id,
    enrolment_id,
    punch_date,
    worker_type,
    employee_id,
    field_executive_id,
    location_id
  from relabelled_punches
  order by company_id, enrolment_id, punch_date, punch_time desc
)
update public.attendance_daily ad
set
  worker_type = lw.worker_type,
  employee_id = lw.employee_id,
  field_executive_id = lw.field_executive_id,
  location_id = lw.location_id,
  in_time = ds.in_time,
  out_time = ds.out_time,
  punch_count = ds.punch_count,
  work_minutes = ds.work_minutes,
  status = 'P',
  remark = ds.remark,
  employee_code = coalesce(e.employee_code, fe.dropx_id, ad.employee_code),
  worker_name = coalesce(e.full_name, fe.full_name, ad.worker_name),
  station_code = coalesce(s.station_code, ad.station_code),
  updated_at = now()
from daily_summary ds
join latest_worker lw
  on lw.company_id = ds.company_id
 and lw.enrolment_id = ds.enrolment_id
 and lw.punch_date = ds.punch_date
left join public.employees e
  on e.id = lw.employee_id
 and e.company_id = lw.company_id
left join public.field_executives fe
  on fe.id = lw.field_executive_id
 and fe.company_id = lw.company_id
left join public.stations s
  on s.id = lw.location_id
 and s.company_id = lw.company_id
where ad.company_id = ds.company_id
  and ad.enrolment_id = ds.enrolment_id
  and ad.punch_date = ds.punch_date;

commit;
