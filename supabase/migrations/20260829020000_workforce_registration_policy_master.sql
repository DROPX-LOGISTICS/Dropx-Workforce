begin;

-- A Workforce record no longer reveals its engagement type from its physical
-- table. Keep one explicit registration-policy category on the designation so
-- every consumer resolves the same category, field rules and app access by
-- designation_id. The existing array remains the list of allowed engagement
-- types; this column selects the one used for registration.
alter table public.designations
  add column if not exists registration_category_code text;

update public.designations designation
set registration_category_code = designation.onboarding_categories[1],
    updated_at = now()
where designation.registration_category_code is null
  and cardinality(designation.onboarding_categories) > 0;

-- Older designations sometimes relied only on category-level fields. Materialise
-- that policy on the designation so registration never falls through to the
-- client application's broad default field set.
update public.designations designation
set profile_field_rules = coalesce(designation.profile_field_rules, '{}'::jsonb)
    || jsonb_build_object(
      designation.registration_category_code,
      category.profile_field_rules
    ),
    updated_at = now()
from public.workforce_categories category
where category.company_id = designation.company_id
  and category.code = designation.registration_category_code
  and not (
    coalesce(designation.profile_field_rules, '{}'::jsonb)
      ? designation.registration_category_code
  );

do $$
begin
  if exists (
    select 1
    from public.designations designation
    where designation.registration_category_code is null
  ) then
    raise exception 'Every designation must have at least one engagement type before Workforce registration policy can be enabled.';
  end if;

  if exists (
    select 1
    from public.designations designation
    left join public.workforce_categories category
      on category.company_id = designation.company_id
     and category.code = designation.registration_category_code
    where category.id is null
  ) then
    raise exception 'Every designation registration category must exist in Workforce Categories.';
  end if;
end
$$;

alter table public.designations
  alter column registration_category_code set not null;

alter table public.designations
  drop constraint if exists designations_registration_category_membership_check;

alter table public.designations
  add constraint designations_registration_category_membership_check
  check (registration_category_code = any(onboarding_categories));

alter table public.designations
  drop constraint if exists designations_registration_category_fkey;

alter table public.designations
  add constraint designations_registration_category_fkey
  foreign key (company_id, registration_category_code)
  references public.workforce_categories(company_id, code)
  on update cascade
  on delete restrict;

create index if not exists designations_registration_category_idx
  on public.designations(company_id, registration_category_code, is_active);

comment on column public.designations.registration_category_code is
  'Master-selected Workforce category whose field, statutory and DropX One access rules govern registration for this designation.';

commit;
