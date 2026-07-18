begin;

alter table public.employees
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
  add column if not exists pan_upload_path text,
  add column if not exists profile_completion_status text not null default 'pending',
  add column if not exists profile_completed_at timestamptz;

update public.employees
set profile_completion_status = 'pending'
where profile_completion_status is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'employees_profile_completion_status_check'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      add constraint employees_profile_completion_status_check
      check (profile_completion_status in ('pending', 'submitted', 'active', 'rejected'));
  end if;
end $$;

create index if not exists employees_company_profile_completion_status_idx
  on public.employees (company_id, profile_completion_status);

insert into storage.buckets (id, name, public)
values ('employee-profile-documents', 'employee-profile-documents', false)
on conflict (id) do nothing;

commit;
