-- Biometric shared enrolment employee priority
-- Purpose:
--   Allow the same biometric ID to exist in different worker categories, but prefer
--   the employee record for attendance display when an employee shares the ID.
--   Example: employee DROPX522 with biometric_id 522.
-- Safe to run repeatedly.

begin;

drop index if exists public.biometric_enrolments_company_enrolment_active_uidx;

create unique index if not exists biometric_enrolments_company_type_enrolment_active_uidx
  on public.biometric_enrolments(company_id, worker_type, enrolment_id)
  where effective_to is null;

with employee_source as (
  select
    e.company_id,
    e.id as employee_id,
    e.location_id,
    e.employee_code,
    e.full_name,
    case
      when regexp_replace(coalesce(e.biometric_id, ''), '\D', '', 'g') = '' then null
      when ltrim(regexp_replace(coalesce(e.biometric_id, ''), '\D', '', 'g'), '0') = '' then '0'
      else ltrim(regexp_replace(coalesce(e.biometric_id, ''), '\D', '', 'g'), '0')
    end as enrolment_id,
    case when coalesce(e.is_active, true) then 'Active' else 'Inactive' end as status,
    coalesce(e.date_of_join, current_date) as effective_from
  from public.employees e
  where coalesce(e.biometric_id, '') <> ''
),
valid_employees as (
  select *
  from employee_source
  where enrolment_id is not null
    and enrolment_id ~ '^[0-9]{1,20}$'
),
same_category_duplicates as (
  select company_id, enrolment_id
  from valid_employees
  group by company_id, enrolment_id
  having count(*) > 1
),
safe_employees as (
  select ve.*
  from valid_employees ve
  left join same_category_duplicates dup
    on dup.company_id = ve.company_id
   and dup.enrolment_id = ve.enrolment_id
  where dup.enrolment_id is null
),
inserted_employee_enrolments as (
  insert into public.biometric_enrolments (
    company_id,
    enrolment_id,
    worker_type,
    employee_id,
    field_executive_id,
    location_id,
    status,
    effective_from,
    effective_to,
    notes,
    updated_at
  )
  select
    se.company_id,
    se.enrolment_id,
    'employee',
    se.employee_id,
    null::uuid,
    se.location_id,
    se.status,
    se.effective_from,
    null,
    'Synced by biometric_employee_priority_shared_enrolments_v1.sql',
    now()
  from safe_employees se
  where not exists (
    select 1
    from public.biometric_enrolments be
    where be.company_id = se.company_id
      and be.worker_type = 'employee'
      and be.enrolment_id = se.enrolment_id
      and be.effective_to is null
  )
  returning id
),
updated_employee_enrolments as (
  update public.biometric_enrolments be
  set
    employee_id = se.employee_id,
    field_executive_id = null,
    location_id = se.location_id,
    status = se.status,
    effective_from = se.effective_from,
    notes = 'Synced by biometric_employee_priority_shared_enrolments_v1.sql',
    updated_at = now()
  from safe_employees se
  where be.company_id = se.company_id
    and be.worker_type = 'employee'
    and be.enrolment_id = se.enrolment_id
    and be.effective_to is null
  returning be.id
),
updated_punches as (
  update public.attendance_punches p
  set
    worker_type = 'employee',
    employee_id = se.employee_id,
    field_executive_id = null,
    location_id = coalesce(se.location_id, p.location_id)
  from safe_employees se
  where p.company_id = se.company_id
    and p.enrolment_id = se.enrolment_id
    and p.calculated is true
  returning p.id
),
updated_daily as (
  update public.attendance_daily ad
  set
    worker_type = 'employee',
    employee_id = se.employee_id,
    field_executive_id = null,
    location_id = coalesce(se.location_id, ad.location_id),
    employee_code = se.employee_code,
    worker_name = se.full_name,
    station_code = coalesce(s.station_code, ad.station_code),
    updated_at = now()
  from safe_employees se
  left join public.stations s
    on s.company_id = se.company_id
   and s.id = se.location_id
  where ad.company_id = se.company_id
    and ad.enrolment_id = se.enrolment_id
  returning ad.id
)
select
  (select count(*) from safe_employees) as employee_biometric_ids_checked,
  (select count(*) from inserted_employee_enrolments) as employee_enrolments_inserted,
  (select count(*) from updated_employee_enrolments) as employee_enrolments_updated,
  (select count(*) from updated_punches) as attendance_punches_employee_linked,
  (select count(*) from updated_daily) as attendance_daily_employee_linked,
  (select count(*) from same_category_duplicates) as employee_duplicate_biometric_ids_skipped;

commit;

notify pgrst, 'reload schema';

