begin;

alter table public.employees
  add column if not exists pf_uan text,
  add column if not exists esi_no text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'employees_pf_uan_alnum_check'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      add constraint employees_pf_uan_alnum_check
      check (pf_uan is null or pf_uan ~ '^[A-Za-z0-9]+$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'employees_esi_no_alnum_check'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      add constraint employees_esi_no_alnum_check
      check (esi_no is null or esi_no ~ '^[A-Za-z0-9]+$');
  end if;
end $$;

commit;
