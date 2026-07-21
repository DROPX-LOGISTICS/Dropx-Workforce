-- Cleanup test worker records and unlock ID generation settings.
--
-- Run this in Supabase SQL Editor.
-- Target records:
--   Employee: EM1001
--   Field executive: FE1001
--
-- Note: Supabase does not allow deleting storage objects from SQL.
-- This script returns the profile document paths that should be removed
-- from the employee-profile-documents bucket through the Storage UI/API.

begin;

create temp table target_workers (
  owner_type text not null,
  owner_id uuid not null,
  company_id uuid,
  code text,
  country_code text,
  mobile text,
  biometric_id text
) on commit drop;

insert into target_workers (owner_type, owner_id, company_id, code, country_code, mobile, biometric_id)
select
  'employee',
  id,
  company_id,
  employee_code,
  mobile_country_code,
  mobile,
  biometric_id
from public.employees
where employee_code = 'EM1001';

insert into target_workers (owner_type, owner_id, company_id, code, country_code, mobile, biometric_id)
select
  'field_executive',
  id,
  company_id,
  dropx_id,
  mobile_country_code,
  mobile,
  biometric_id
from public.field_executives
where dropx_id = 'FE1001';

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
  where id in (select owner_id from target_workers where owner_type = 'employee')

  union all

  select unnest(array[
    profile_photo_path,
    aadhaar_front_path,
    aadhaar_back_path,
    pan_upload_path,
    dl_front_path,
    dl_back_path
  ]) as path
  from public.field_executives
  where id in (select owner_id from target_workers where owner_type = 'field_executive')
) files
where path is not null and btrim(path) <> '';

do $$
begin
  if to_regclass('public.profile_document_trash') is not null then
    insert into target_storage_paths (bucket, path)
    select storage_bucket, storage_path
    from public.profile_document_trash
    where owner_id in (select owner_id from target_workers)
      and storage_path is not null
      and btrim(storage_path) <> '';
  end if;
end $$;

delete from public.connect_login_sessions sessions
using target_workers target
where sessions.mobile_number = target.mobile
  and sessions.country_code = coalesce(nullif(target.country_code, ''), '91');

delete from public.connect_user_pins pins
using target_workers target
where pins.mobile_number = target.mobile
  and pins.country_code = coalesce(nullif(target.country_code, ''), '91');

do $$
begin
  if to_regclass('public.whatsapp_message_logs') is not null then
    delete from public.whatsapp_message_logs
    where field_executive_id in (
      select owner_id
      from target_workers
      where owner_type = 'field_executive'
    );
  end if;

  if to_regclass('public.field_executive_provider_mappings') is not null then
    delete from public.field_executive_provider_mappings
    where field_executive_id in (
      select owner_id
      from target_workers
      where owner_type = 'field_executive'
    );
  end if;

  if to_regclass('public.biometric_alerts') is not null then
    delete from public.biometric_alerts
    where employee_id in (
      select owner_id
      from target_workers
      where owner_type = 'employee'
    )
    or field_executive_id in (
      select owner_id
      from target_workers
      where owner_type = 'field_executive'
    );
  end if;

  if to_regclass('public.attendance_punches') is not null then
    delete from public.attendance_punches
    where employee_id in (
      select owner_id
      from target_workers
      where owner_type = 'employee'
    )
    or field_executive_id in (
      select owner_id
      from target_workers
      where owner_type = 'field_executive'
    );
  end if;

  if to_regclass('public.attendance_daily') is not null then
    delete from public.attendance_daily
    where employee_id in (
      select owner_id
      from target_workers
      where owner_type = 'employee'
    )
    or field_executive_id in (
      select owner_id
      from target_workers
      where owner_type = 'field_executive'
    );
  end if;

  if to_regclass('public.biometric_enrolments') is not null then
    delete from public.biometric_enrolments
    where employee_id in (
      select owner_id
      from target_workers
      where owner_type = 'employee'
    )
    or field_executive_id in (
      select owner_id
      from target_workers
      where owner_type = 'field_executive'
    );
  end if;
end $$;

do $$
begin
  if to_regclass('public.profile_document_trash') is not null then
    delete from public.profile_document_trash trash
    using target_workers target
    where trash.owner_id = target.owner_id;
  end if;
end $$;

delete from public.employees
where id in (
  select owner_id
  from target_workers
  where owner_type = 'employee'
);

delete from public.field_executives
where id in (
  select owner_id
  from target_workers
  where owner_type = 'field_executive'
);

update public.dropx_id_generation_settings
set is_locked = false,
    updated_at = now()
where company_id in (select distinct company_id from target_workers where company_id is not null)
   or not exists (select 1 from target_workers);

commit;

select
  'Deleted worker records and unlocked ID generation settings. Remove these files through Supabase Storage if any rows appear below.' as result;

select distinct bucket, path
from target_storage_paths
order by bucket, path;
