-- Delete test employee E5001 and reset Employee DropX/Biometric ID generation.
--
-- Run this in Supabase SQL Editor.
--
-- Target:
--   Employee code: E5001
--
-- Notes:
-- - Deletes related app login, attendance, biometric enrolment, and profile trash rows.
-- - Unlocks DropX ID and Biometric ID generation for the target company.
-- - Resets employee/category generation counters back to 5001 only when they are above 5001.
-- - Supabase SQL cannot delete Storage objects directly. The final result shows paths
--   that should be removed from the employee-profile-documents bucket if present.

begin;

create temp table target_employee (
  owner_id uuid not null,
  company_id uuid not null,
  employee_code text,
  country_code text,
  mobile text,
  biometric_id text
) on commit preserve rows;

insert into target_employee (owner_id, company_id, employee_code, country_code, mobile, biometric_id)
select
  id,
  company_id,
  employee_code,
  mobile_country_code,
  mobile,
  biometric_id
from public.employees
where employee_code = 'E5001';

create temp table target_storage_paths (
  bucket text not null default 'employee-profile-documents',
  path text not null
) on commit preserve rows;

insert into target_storage_paths (path)
select path
from (
  select unnest(array[
    profile_photo_path,
    aadhaar_front_path,
    aadhaar_back_path,
    pan_upload_path
  ]) as path
  from public.employees
  where id in (select owner_id from target_employee)
) files
where path is not null and btrim(path) <> '';

do $$
begin
  if to_regclass('public.profile_document_trash') is not null then
    insert into target_storage_paths (bucket, path)
    select storage_bucket, storage_path
    from public.profile_document_trash
    where owner_id in (select owner_id from target_employee)
      and storage_path is not null
      and btrim(storage_path) <> '';
  end if;
end $$;

delete from public.connect_login_sessions sessions
using target_employee target
where sessions.mobile_number = target.mobile
  and sessions.country_code = coalesce(nullif(target.country_code, ''), '91');

delete from public.connect_user_pins pins
using target_employee target
where pins.mobile_number = target.mobile
  and pins.country_code = coalesce(nullif(target.country_code, ''), '91');

do $$
begin
  if to_regclass('public.biometric_alerts') is not null then
    delete from public.biometric_alerts
    where employee_id in (select owner_id from target_employee);
  end if;

  if to_regclass('public.attendance_punches') is not null then
    delete from public.attendance_punches
    where employee_id in (select owner_id from target_employee);
  end if;

  if to_regclass('public.attendance_daily') is not null then
    delete from public.attendance_daily
    where employee_id in (select owner_id from target_employee);
  end if;

  if to_regclass('public.biometric_enrolments') is not null then
    delete from public.biometric_enrolments
    where employee_id in (select owner_id from target_employee);
  end if;

  if to_regclass('public.profile_document_trash') is not null then
    delete from public.profile_document_trash trash
    using target_employee target
    where trash.owner_id = target.owner_id;
  end if;
end $$;

delete from public.employees
where id in (select owner_id from target_employee);

-- Reset only Employee/category counters that moved beyond E5001 / 5001.
-- This keeps other categories, models, locations, and designations untouched.
update public.dropx_id_generation_settings settings
set configs = jsonb_set(
      settings.configs,
      '{employee,next_serial_no}',
      '5001'::jsonb,
      true
    ),
    is_locked = false,
    updated_at = now()
where settings.setting_type = 'dropx_id'
  and settings.company_id in (select distinct company_id from target_employee)
  and settings.configs ? 'employee'
  and coalesce((settings.configs #>> '{employee,next_serial_no}')::integer, 1) > 5001;

update public.dropx_id_generation_settings settings
set configs = jsonb_set(
      settings.configs,
      '{employee,next_serial_no}',
      '5001'::jsonb,
      true
    ),
    is_locked = false,
    updated_at = now()
where settings.setting_type = 'biometric_id'
  and settings.company_id in (select distinct company_id from target_employee)
  and settings.configs ? 'employee'
  and coalesce((settings.configs #>> '{employee,next_serial_no}')::integer, 1) > 5001;

-- If the setup is currently scoped company-wise, reset the company counter too
-- only when the deleted test employee consumed 5001.
update public.dropx_id_generation_settings settings
set configs = jsonb_set(
      settings.configs,
      '{company,next_serial_no}',
      '5001'::jsonb,
      true
    ),
    is_locked = false,
    updated_at = now()
where settings.setting_type in ('dropx_id', 'biometric_id')
  and settings.company_id in (select distinct company_id from target_employee)
  and settings.scope_type = 'company'
  and settings.configs ? 'company'
  and coalesce((settings.configs #>> '{company,next_serial_no}')::integer, 1) > 5001;

update public.dropx_id_generation_settings settings
set is_locked = false,
    updated_at = now()
where settings.setting_type in ('dropx_id', 'biometric_id')
  and settings.company_id in (select distinct company_id from target_employee);

commit;

select
  case
    when exists (select 1 from target_employee)
      then 'Deleted employee E5001 and reset Employee DropX/Biometric ID generation.'
    else 'Employee E5001 was not found. No employee row was deleted.'
  end as result;

select distinct bucket, path
from target_storage_paths
order by bucket, path;
