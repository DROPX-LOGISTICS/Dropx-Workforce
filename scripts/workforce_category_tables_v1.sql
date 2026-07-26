begin;

-- Nonemployee workforce categories intentionally use the same profile columns,
-- while each category owns its records and unique identifiers independently.
create table if not exists public.contractors
  (like public.field_executives including all);
create table if not exists public.vendors
  (like public.field_executives including all);
create table if not exists public.workers
  (like public.field_executives including all);

do $$
declare
  table_name text;
begin
  foreach table_name in array array['contractors', 'vendors', 'workers']
  loop
    execute format('alter table public.%I enable row level security', table_name);

    if not exists (
      select 1 from pg_constraint
      where conname = table_name || '_company_id_fkey'
        and conrelid = ('public.' || table_name)::regclass
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (company_id) references public.companies(id) on delete cascade',
        table_name,
        table_name || '_company_id_fkey'
      );
    end if;

    if not exists (
      select 1 from pg_constraint
      where conname = table_name || '_location_id_fkey'
        and conrelid = ('public.' || table_name)::regclass
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (location_id) references public.stations(id)',
        table_name,
        table_name || '_location_id_fkey'
      );
    end if;

    if not exists (
      select 1 from pg_constraint
      where conname = table_name || '_created_by_fkey'
        and conrelid = ('public.' || table_name)::regclass
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (created_by) references auth.users(id)',
        table_name,
        table_name || '_created_by_fkey'
      );
    end if;
  end loop;
end
$$;

create or replace function public.prevent_nonemployee_dropx_id_change()
returns trigger
language plpgsql
as $$
begin
  if new.dropx_id is distinct from old.dropx_id then
    raise exception 'DropX ID cannot be changed after creation.';
  end if;
  return new;
end;
$$;

drop trigger if exists contractor_dropx_id_immutable on public.contractors;
create trigger contractor_dropx_id_immutable
before update of dropx_id on public.contractors
for each row execute function public.prevent_nonemployee_dropx_id_change();

drop trigger if exists vendor_dropx_id_immutable on public.vendors;
create trigger vendor_dropx_id_immutable
before update of dropx_id on public.vendors
for each row execute function public.prevent_nonemployee_dropx_id_change();

drop trigger if exists worker_dropx_id_immutable on public.workers;
create trigger worker_dropx_id_immutable
before update of dropx_id on public.workers
for each row execute function public.prevent_nonemployee_dropx_id_change();

-- Move legacy contractor rows that were previously stored as field executives.
insert into public.contractors
select fe.*
from public.field_executives fe
where exists (
  select 1
  from public.designations d
  where d.company_id = fe.company_id
    and d.name = fe.designation
    and 'contractors' = any(coalesce(d.onboarding_categories, '{}'::text[]))
    and not ('field_executives' = any(coalesce(d.onboarding_categories, '{}'::text[])))
)
on conflict (id) do nothing;

delete from public.field_executives fe
using public.contractors c
where c.id = fe.id;

alter table public.connect_profile_verifications
  drop constraint if exists connect_profile_verifications_profile_type_check;
alter table public.connect_profile_verifications
  add constraint connect_profile_verifications_profile_type_check
  check (profile_type in ('employee', 'field_executive', 'contractor', 'vendor', 'worker'));

alter table if exists public.profile_document_trash
  drop constraint if exists profile_document_trash_owner_type_check;
alter table if exists public.profile_document_trash
  add constraint profile_document_trash_owner_type_check
  check (owner_type in ('employee', 'field_executive', 'contractor', 'vendor', 'worker'));

alter table public.biometric_enrolments
  add column if not exists profile_type text,
  add column if not exists account_id uuid;

alter table public.biometric_enrolments
  drop constraint if exists biometric_enrolments_profile_type_check;
alter table public.biometric_enrolments
  add constraint biometric_enrolments_profile_type_check
  check (
    profile_type is null
    or profile_type in ('employee', 'field_executive', 'contractor', 'vendor', 'worker')
  );

update public.biometric_enrolments
set profile_type = case
      when employee_id is not null then 'employee'
      when field_executive_id is not null then 'field_executive'
      else profile_type
    end,
    account_id = coalesce(account_id, employee_id, field_executive_id)
where profile_type is null or account_id is null;

create index if not exists biometric_enrolments_profile_account_idx
  on public.biometric_enrolments(company_id, profile_type, account_id);

drop index if exists public.biometric_enrolments_company_type_enrolment_active_uidx;
create unique index if not exists biometric_enrolments_company_profile_enrolment_active_uidx
  on public.biometric_enrolments(company_id, profile_type, enrolment_id)
  where effective_to is null;

alter table public.attendance_punches
  add column if not exists profile_type text,
  add column if not exists account_id uuid;

update public.attendance_punches
set profile_type = case
      when employee_id is not null then 'employee'
      when field_executive_id is not null then 'field_executive'
      else profile_type
    end,
    account_id = coalesce(account_id, employee_id, field_executive_id)
where profile_type is null or account_id is null;

commit;
