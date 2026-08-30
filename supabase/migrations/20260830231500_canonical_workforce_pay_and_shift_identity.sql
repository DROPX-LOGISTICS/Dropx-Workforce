begin;

-- Keep the historical payroll/shift rows and their audit IDs, but let each row
-- point to the product that owns the person. Existing People contractor rows
-- continue to use contractor_id; Workforce rows use workforce_id.
alter table public.hr_contractor_pay_profiles
  add column if not exists workforce_id uuid;
alter table public.hr_contractor_pay_profiles
  alter column contractor_id drop not null;

alter table public.hr_contractor_shift_assignments
  add column if not exists workforce_id uuid;
alter table public.hr_contractor_shift_assignments
  alter column contractor_id drop not null;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'hr_contractor_pay_profiles_workforce_id_fkey'
      and conrelid = 'public.hr_contractor_pay_profiles'::regclass
  ) then
    alter table public.hr_contractor_pay_profiles
      add constraint hr_contractor_pay_profiles_workforce_id_fkey
      foreign key (workforce_id) references public.workforce(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'hr_contractor_shift_assignments_workforce_id_fkey'
      and conrelid = 'public.hr_contractor_shift_assignments'::regclass
  ) then
    alter table public.hr_contractor_shift_assignments
      add constraint hr_contractor_shift_assignments_workforce_id_fkey
      foreign key (workforce_id) references public.workforce(id) on delete cascade;
  end if;
end;
$$;

alter table public.hr_contractor_pay_profiles
  drop constraint if exists hr_contractor_pay_profiles_identity_check;
alter table public.hr_contractor_pay_profiles
  add constraint hr_contractor_pay_profiles_identity_check
  check (num_nonnulls(contractor_id, workforce_id) = 1) not valid;
alter table public.hr_contractor_pay_profiles
  validate constraint hr_contractor_pay_profiles_identity_check;

alter table public.hr_contractor_shift_assignments
  drop constraint if exists hr_contractor_shift_assignments_identity_check;
alter table public.hr_contractor_shift_assignments
  add constraint hr_contractor_shift_assignments_identity_check
  check (num_nonnulls(contractor_id, workforce_id) = 1) not valid;
alter table public.hr_contractor_shift_assignments
  validate constraint hr_contractor_shift_assignments_identity_check;

drop index if exists public.hr_contractor_pay_profiles_current_idx;
create unique index hr_contractor_pay_profiles_current_contractor_idx
  on public.hr_contractor_pay_profiles(company_id, contractor_id)
  where effective_to is null and contractor_id is not null;
create unique index hr_contractor_pay_profiles_current_workforce_idx
  on public.hr_contractor_pay_profiles(company_id, workforce_id)
  where effective_to is null and workforce_id is not null;
create index if not exists hr_contractor_pay_profiles_workforce_period_idx
  on public.hr_contractor_pay_profiles(company_id, workforce_id, effective_from desc)
  where workforce_id is not null;

create index if not exists hr_contractor_shift_assignments_workforce_period_idx
  on public.hr_contractor_shift_assignments(company_id, workforce_id, effective_from desc)
  where workforce_id is not null;

create or replace function public.hr_validate_contractor_pay_profile_links()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if num_nonnulls(new.contractor_id, new.workforce_id) <> 1 then
    raise exception 'A pay profile must belong to exactly one People contractor or Workforce profile';
  end if;
  if new.contractor_id is not null and not exists (
    select 1 from public.contractors
    where id = new.contractor_id and company_id = new.company_id
  ) then
    raise exception 'Contractor does not belong to this People company';
  end if;
  if new.workforce_id is not null and not exists (
    select 1 from public.workforce
    where id = new.workforce_id and company_id = new.company_id
  ) then
    raise exception 'Workforce profile does not belong to this company';
  end if;
  if new.shift_id is not null and not exists (
    select 1 from public.hr_shifts
    where id = new.shift_id and company_id = new.company_id
  ) then
    raise exception 'Shift does not belong to this company';
  end if;
  if exists (
    select 1 from public.hr_contractor_pay_profiles profile
    where profile.company_id = new.company_id
      and profile.id <> new.id
      and (
        (new.contractor_id is not null and profile.contractor_id = new.contractor_id)
        or (new.workforce_id is not null and profile.workforce_id = new.workforce_id)
      )
      and daterange(profile.effective_from, coalesce(profile.effective_to, 'infinity'::date), '[]')
        && daterange(new.effective_from, coalesce(new.effective_to, 'infinity'::date), '[]')
  ) then
    raise exception 'This person already has an overlapping pay profile';
  end if;
  return new;
end;
$$;

create or replace function public.hr_validate_contractor_shift_assignment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if num_nonnulls(new.contractor_id, new.workforce_id) <> 1 then
    raise exception 'A shift assignment must belong to exactly one People contractor or Workforce profile';
  end if;
  if new.contractor_id is not null and not exists (
    select 1 from public.contractors
    where id = new.contractor_id and company_id = new.company_id
  ) then
    raise exception 'Independent contractor does not belong to the selected company';
  end if;
  if new.workforce_id is not null and not exists (
    select 1 from public.workforce
    where id = new.workforce_id and company_id = new.company_id
  ) then
    raise exception 'Workforce profile does not belong to the selected company';
  end if;
  if not exists (
    select 1 from public.hr_shifts
    where id = new.shift_id and company_id = new.company_id and (tg_op = 'UPDATE' or is_active)
  ) then
    raise exception 'Shift does not belong to the selected company or is inactive';
  end if;
  if exists (
    select 1 from public.hr_contractor_shift_assignments assignment
    where assignment.company_id = new.company_id
      and assignment.id <> new.id
      and (
        (new.contractor_id is not null and assignment.contractor_id = new.contractor_id)
        or (new.workforce_id is not null and assignment.workforce_id = new.workforce_id)
      )
      and daterange(assignment.effective_from, coalesce(assignment.effective_to, 'infinity'::date), '[]')
        && daterange(new.effective_from, coalesce(new.effective_to, 'infinity'::date), '[]')
  ) then
    raise exception 'This person already has a shift assignment overlapping this period';
  end if;
  return new;
end;
$$;

-- Install, but do not execute, the data movement. It is invoked only from the
-- reviewed Super Admin reconciliation action and remains fully transactional.
create or replace function public.reconcile_workforce_hr_identity_references()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay_rows integer := 0;
  shift_rows integer := 0;
begin
  update public.hr_contractor_pay_profiles profile
  set workforce_id = link.target_profile_id,
      contractor_id = null,
      updated_at = now()
  from public.workforce_identity_links link
  join public.workforce workforce
    on workforce.id = link.target_profile_id
   and workforce.company_id = link.company_id
  where link.legacy_profile_type = 'contractor'
    and link.target_profile_type = 'workforce'
    and link.compatibility_active
    and profile.company_id = link.company_id
    and profile.contractor_id = link.legacy_profile_id;
  get diagnostics pay_rows = row_count;

  update public.hr_contractor_shift_assignments assignment
  set workforce_id = link.target_profile_id,
      contractor_id = null,
      updated_at = now()
  from public.workforce_identity_links link
  join public.workforce workforce
    on workforce.id = link.target_profile_id
   and workforce.company_id = link.company_id
  where link.legacy_profile_type = 'contractor'
    and link.target_profile_type = 'workforce'
    and link.compatibility_active
    and assignment.company_id = link.company_id
    and assignment.contractor_id = link.legacy_profile_id;
  get diagnostics shift_rows = row_count;

  return jsonb_build_object(
    'pay_profiles_rekeyed', pay_rows,
    'shift_assignments_rekeyed', shift_rows
  );
end;
$$;

alter function public.reconcile_legacy_workforce_aliases()
  rename to reconcile_legacy_workforce_aliases_core;

create function public.reconcile_legacy_workforce_aliases()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  hr_result jsonb;
  core_result jsonb;
begin
  hr_result := public.reconcile_workforce_hr_identity_references();
  core_result := public.reconcile_legacy_workforce_aliases_core();
  return core_result || jsonb_build_object('hr_identity_references', hr_result);
end;
$$;

revoke all on function public.reconcile_workforce_hr_identity_references() from public, anon, authenticated;
revoke all on function public.reconcile_legacy_workforce_aliases_core() from public, anon, authenticated;
revoke all on function public.reconcile_legacy_workforce_aliases() from public, anon, authenticated;
grant execute on function public.reconcile_legacy_workforce_aliases() to service_role;

comment on column public.hr_contractor_pay_profiles.workforce_id is
  'Canonical Workforce owner. contractor_id remains exclusively for People-owned independent contractors.';
comment on column public.hr_contractor_shift_assignments.workforce_id is
  'Canonical Workforce owner. contractor_id remains exclusively for People-owned independent contractors.';
comment on function public.reconcile_workforce_hr_identity_references() is
  'Explicit cutover operation that rekeys historical pay and shift rows from verified contractor aliases to canonical Workforce identities.';

notify pgrst, 'reload schema';

commit;
