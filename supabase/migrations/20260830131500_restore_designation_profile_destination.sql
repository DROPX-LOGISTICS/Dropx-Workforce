begin;

-- The legacy Workforce schema was applied before this repository's migration
-- history was aligned, but profile_destination was not. Restore only the
-- missing designation-master contract without replacing the newer canonical
-- Workforce sync functions.
alter table public.designations
  add column if not exists profile_destination text;

update public.designations designation
set profile_destination = case
  when category.people_module = 'delivery_network'
    and 'vendors' = any(coalesce(designation.onboarding_categories, array[]::text[]))
    then 'vendors'
  when category.people_module = 'delivery_network'
    then 'workforce'
  when 'employees' = any(coalesce(designation.onboarding_categories, array[]::text[]))
    then 'employees'
  when 'field_executives' = any(coalesce(designation.onboarding_categories, array[]::text[]))
    then 'field_executives'
  when 'contractors' = any(coalesce(designation.onboarding_categories, array[]::text[]))
    then 'contractors'
  when 'workers' = any(coalesce(designation.onboarding_categories, array[]::text[]))
    then 'workers'
  else 'employees'
end
from public.designation_categories category
where category.id = designation.designation_category_id
  and category.company_id = designation.company_id
  and designation.profile_destination is null;

do $$
begin
  if exists (
    select 1
    from public.designations
    where profile_destination is null
  ) then
    raise exception 'Every designation requires a profile destination.';
  end if;
end
$$;

alter table public.designations
  alter column profile_destination set default 'employees',
  alter column profile_destination set not null;

alter table public.designations
  drop constraint if exists designations_profile_destination_check;

alter table public.designations
  add constraint designations_profile_destination_check
  check (profile_destination in (
    'employees',
    'field_executives',
    'contractors',
    'workers',
    'workforce',
    'vendors'
  ));

create or replace function public.validate_designation_profile_destination()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  people_module_value text;
begin
  select category.people_module
  into people_module_value
  from public.designation_categories category
  where category.id = new.designation_category_id
    and category.company_id = new.company_id
    and category.is_active;

  if people_module_value is null then
    raise exception 'An active designation category is required before selecting a profile destination.';
  end if;

  if people_module_value = 'delivery_network'
    and new.profile_destination not in ('workforce', 'vendors') then
    raise exception 'Workforce designations can route only to workforce or vendors.';
  end if;

  if people_module_value = 'people_hr'
    and new.profile_destination not in ('employees', 'field_executives', 'contractors', 'workers') then
    raise exception 'HR designations cannot route to workforce or vendors.';
  end if;

  return new;
end;
$$;

drop trigger if exists designations_validate_profile_destination on public.designations;
create trigger designations_validate_profile_destination
before insert or update of company_id, designation_category_id, profile_destination
on public.designations
for each row execute function public.validate_designation_profile_destination();

revoke all on function public.validate_designation_profile_destination() from public, anon, authenticated;

comment on column public.designations.profile_destination is
  'Master-defined canonical profile destination displayed and validated for each designation.';

notify pgrst, 'reload schema';

commit;
