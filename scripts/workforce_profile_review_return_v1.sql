begin;

alter table public.employees
  add column if not exists profile_return_remarks text,
  add column if not exists profile_returned_at timestamptz;

alter table public.employees
  drop constraint if exists employees_profile_completion_status_check;

alter table public.employees
  add constraint employees_profile_completion_status_check
  check (
    profile_completion_status is null
    or profile_completion_status in (
      'pending',
      'submitted',
      'under_review',
      'returned',
      'active',
      'rejected'
    )
  );

alter table public.field_executives
  add column if not exists profile_return_remarks text,
  add column if not exists profile_returned_at timestamptz;

commit;
