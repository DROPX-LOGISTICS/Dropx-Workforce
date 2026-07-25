begin;

alter table public.employees
  drop constraint if exists employees_profile_completion_status_check;

alter table public.employees
  add constraint employees_profile_completion_status_check
  check (
    profile_completion_status in (
      'pending',
      'submitted',
      'under_review',
      'active',
      'rejected'
    )
  );

commit;
