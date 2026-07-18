-- Biometric master enrolment sync
-- Purpose:
--   Create missing biometric_enrolments from the existing Employees and Field Executives masters.
--   This is not employee-specific and does not create dummy punches or dummy workers.
--
-- When to run:
--   1) After adding biometric_id columns/migration.
--   2) After bulk imports or manual edits if old records were not synced.
--   3) Before testing a real physical punch for an existing worker.
--
-- Safety rules:
--   - Only workers with a numeric biometric_id are considered.
--   - Leading zeroes are normalized, so 000522 and 522 resolve to 522.
--   - If the same enrolment ID exists for multiple workers in the same company, this script skips it.
--   - Existing active mappings for the same worker but a different enrolment ID are closed.

begin;

alter table public.employees
  add column if not exists biometric_id text;

alter table public.field_executives
  add column if not exists biometric_id text;

create index if not exists employees_company_biometric_id_idx
  on public.employees(company_id, biometric_id)
  where biometric_id is not null;

create index if not exists field_executives_company_biometric_id_idx
  on public.field_executives(company_id, biometric_id)
  where biometric_id is not null;

with source_workers as (
  select
    employees.company_id,
    employees.id as employee_id,
    null::uuid as field_executive_id,
    'employee'::text as worker_type,
    employees.location_id,
    coalesce(employees.is_active, true) as is_active,
    coalesce(employees.date_of_join, current_date) as effective_from,
    employees.employee_code as worker_code,
    employees.full_name as worker_name,
    regexp_replace(coalesce(employees.biometric_id, ''), '\D', '', 'g') as digits
  from public.employees
  where coalesce(employees.biometric_id, '') <> ''

  union all

  select
    field_executives.company_id,
    null::uuid as employee_id,
    field_executives.id as field_executive_id,
    'individual_contract'::text as worker_type,
    field_executives.location_id,
    coalesce(field_executives.is_active, true) as is_active,
    coalesce(field_executives.date_of_join, current_date) as effective_from,
    field_executives.dropx_id as worker_code,
    field_executives.full_name as worker_name,
    regexp_replace(coalesce(field_executives.biometric_id, ''), '\D', '', 'g') as digits
  from public.field_executives
  where coalesce(field_executives.biometric_id, '') <> ''
),
normalized_workers as (
  select
    *,
    case
      when digits = '' then null
      when ltrim(digits, '0') = '' then '0'
      else ltrim(digits, '0')
    end as enrolment_id
  from source_workers
),
valid_workers as (
  select *
  from normalized_workers
  where enrolment_id is not null
    and enrolment_id ~ '^[0-9]{1,20}$'
),
duplicate_enrolments as (
  select company_id, enrolment_id
  from valid_workers
  group by company_id, enrolment_id
  having count(*) > 1
),
safe_workers as (
  select vw.*
  from valid_workers vw
  left join duplicate_enrolments de
    on de.company_id = vw.company_id
   and de.enrolment_id = vw.enrolment_id
  where de.enrolment_id is null
),
closed_old_worker_mappings as (
  update public.biometric_enrolments be
  set
    status = 'Inactive',
    effective_to = current_date,
    updated_at = now()
  from safe_workers sw
  where be.company_id = sw.company_id
    and be.effective_to is null
    and be.enrolment_id <> sw.enrolment_id
    and (
      (sw.worker_type = 'employee' and be.employee_id = sw.employee_id)
      or (sw.worker_type = 'individual_contract' and be.field_executive_id = sw.field_executive_id)
    )
  returning be.id
),
inserted_mappings as (
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
    sw.company_id,
    sw.enrolment_id,
    sw.worker_type,
    sw.employee_id,
    sw.field_executive_id,
    sw.location_id,
    case when sw.is_active then 'Active' else 'Inactive' end,
    sw.effective_from,
    null,
    'Synced from workforce master by biometric_master_enrolment_sync_v1.sql',
    now()
  from safe_workers sw
  where not exists (
    select 1
    from public.biometric_enrolments be
    where be.company_id = sw.company_id
      and be.enrolment_id = sw.enrolment_id
      and be.effective_to is null
  )
  returning id
),
updated_same_mappings as (
  update public.biometric_enrolments be
  set
    worker_type = sw.worker_type,
    employee_id = sw.employee_id,
    field_executive_id = sw.field_executive_id,
    location_id = sw.location_id,
    status = case when sw.is_active then 'Active' else 'Inactive' end,
    effective_from = sw.effective_from,
    effective_to = null,
    notes = 'Synced from workforce master by biometric_master_enrolment_sync_v1.sql',
    updated_at = now()
  from safe_workers sw
  where be.company_id = sw.company_id
    and be.enrolment_id = sw.enrolment_id
    and be.effective_to is null
    and (
      (sw.worker_type = 'employee' and (be.employee_id is null or be.employee_id = sw.employee_id))
      or (sw.worker_type = 'individual_contract' and (be.field_executive_id is null or be.field_executive_id = sw.field_executive_id))
    )
  returning be.id
)
select
  (select count(*) from valid_workers) as valid_worker_biometric_ids,
  (select count(*) from duplicate_enrolments) as duplicate_enrolment_ids_skipped,
  (select count(*) from closed_old_worker_mappings) as old_worker_mappings_closed,
  (select count(*) from inserted_mappings) as mappings_inserted,
  (select count(*) from updated_same_mappings) as mappings_updated;

commit;

-- Check duplicates skipped by the sync:
select
  vw.company_id,
  vw.enrolment_id,
  string_agg(coalesce(vw.worker_code, vw.worker_name, vw.employee_id::text, vw.field_executive_id::text), ', ' order by vw.worker_code nulls last) as matching_workers
from (
  select
    employees.company_id,
    employees.id as employee_id,
    null::uuid as field_executive_id,
    employees.employee_code as worker_code,
    employees.full_name as worker_name,
    case
      when regexp_replace(coalesce(employees.biometric_id, ''), '\D', '', 'g') = '' then null
      when ltrim(regexp_replace(coalesce(employees.biometric_id, ''), '\D', '', 'g'), '0') = '' then '0'
      else ltrim(regexp_replace(coalesce(employees.biometric_id, ''), '\D', '', 'g'), '0')
    end as enrolment_id
  from public.employees
  where coalesce(employees.biometric_id, '') <> ''

  union all

  select
    field_executives.company_id,
    null::uuid as employee_id,
    field_executives.id as field_executive_id,
    field_executives.dropx_id as worker_code,
    field_executives.full_name as worker_name,
    case
      when regexp_replace(coalesce(field_executives.biometric_id, ''), '\D', '', 'g') = '' then null
      when ltrim(regexp_replace(coalesce(field_executives.biometric_id, ''), '\D', '', 'g'), '0') = '' then '0'
      else ltrim(regexp_replace(coalesce(field_executives.biometric_id, ''), '\D', '', 'g'), '0')
    end as enrolment_id
  from public.field_executives
  where coalesce(field_executives.biometric_id, '') <> ''
) vw
where vw.enrolment_id is not null
group by vw.company_id, vw.enrolment_id
having count(*) > 1
order by vw.enrolment_id;
