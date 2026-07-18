begin;

alter table public.employees
  add column if not exists biometric_id text;

commit;
