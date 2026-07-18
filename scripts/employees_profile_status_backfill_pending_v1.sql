begin;

alter table public.employees
  add column if not exists profile_completion_status text not null default 'pending',
  add column if not exists profile_completed_at timestamptz,
  add column if not exists gender text,
  add column if not exists date_of_birth date,
  add column if not exists aadhaar_number text,
  add column if not exists pan_number text,
  add column if not exists address text,
  add column if not exists state text,
  add column if not exists pincode text,
  add column if not exists landmark text,
  add column if not exists state_code text,
  add column if not exists father_name text,
  add column if not exists blood_group text,
  add column if not exists bank_account_no text,
  add column if not exists ifsc text,
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_number text,
  add column if not exists emergency_contact_relation text,
  add column if not exists profile_photo_path text,
  add column if not exists aadhaar_front_path text,
  add column if not exists aadhaar_back_path text,
  add column if not exists pan_upload_path text;

update public.employees
set profile_completion_status = 'pending',
    updated_at = now()
where coalesce(profile_completion_status, '') in ('', 'active')
  and profile_completed_at is null
  and (
    nullif(trim(coalesce(aadhaar_number, '')), '') is null
    or nullif(trim(coalesce(pan_number, '')), '') is null
    or nullif(trim(coalesce(bank_account_no, '')), '') is null
    or nullif(trim(coalesce(ifsc, '')), '') is null
    or nullif(trim(coalesce(aadhaar_front_path, '')), '') is null
    or nullif(trim(coalesce(aadhaar_back_path, '')), '') is null
    or nullif(trim(coalesce(pan_upload_path, '')), '') is null
    or nullif(trim(coalesce(profile_photo_path, '')), '') is null
  );

commit;
