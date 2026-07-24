alter table public.employees
  add column if not exists pf_account_no text;

alter table public.employees
  drop constraint if exists employees_pf_account_no_alnum_check;

alter table public.employees
  add constraint employees_pf_account_no_alnum_check
  check (pf_account_no is null or pf_account_no ~ '^[A-Za-z0-9]+$');

notify pgrst, 'reload schema';
