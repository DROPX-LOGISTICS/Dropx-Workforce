begin;

-- Correct the earlier broad Workforce reconciliation using live register usage.
-- Employee-backed designations with no canonical Workforce profile belong to
-- People/HR. Existing people, registration and compatibility rows are not moved.
with hr_categories as (
  select id, company_id
  from public.designation_categories
  where people_module = 'people_hr'
    and is_active
), reclassified as (
  update public.designations designation
  set designation_category_id = hr.id,
      profile_destination = 'employees',
      registration_category_code = case
        when 'employees' = any(coalesce(designation.onboarding_categories, array[]::text[]))
          then 'employees'
        else designation.registration_category_code
      end,
      updated_at = now()
  from hr_categories hr
  join public.designation_categories current_category
    on current_category.company_id = hr.company_id
   and current_category.people_module = 'delivery_network'
   and current_category.is_active
  where designation.company_id = hr.company_id
    and designation.designation_category_id = current_category.id
    and exists (
      select 1
      from public.employees employee
      where employee.company_id = designation.company_id
        and employee.designation_id = designation.id
    )
    and not exists (
      select 1
      from public.workforce worker
      where worker.company_id = designation.company_id
        and worker.designation_id = designation.id
        and worker.deleted_at is null
    )
  returning designation.id, designation.company_id
)
update public.designation_register_routes route
set register_id = register.id,
    registration_enabled = register.is_active,
    mapping_source = 'manual',
    reconciliation_status = 'complete',
    updated_at = now()
from reclassified designation
join public.workforce_register_master register
  on register.company_id = designation.company_id
 and register.table_name = 'employees'
where route.company_id = designation.company_id
  and route.designation_id = designation.id;

-- DropX One previously treated Roster as always visible and Performance as
-- always visible for People self-service. Materialise those defaults before
-- the frontend starts honoring the stored menu policy, preserving live access.
update public.workforce_categories category
set app_page_access = case
      when coalesce(cardinality(category.app_page_access), 0) = 0
        then array['dashboard', 'attendance', 'roster', 'leave', 'performance']::text[]
      else array(
        select distinct page
        from unnest(category.app_page_access || array['roster', 'performance']::text[]) page
      )
    end,
    updated_at = now();

update public.designations designation
set app_page_access = case
      when coalesce(cardinality(designation.app_page_access), 0) = 0
        then case
          when category.people_module = 'people_hr'
            then array['dashboard', 'attendance', 'roster', 'leave', 'performance']::text[]
          else array['dashboard', 'attendance', 'roster', 'leave']::text[]
        end
      else array(
        select distinct page
        from unnest(
          designation.app_page_access ||
          case
            when category.people_module = 'people_hr'
              then array['roster', 'performance']::text[]
            else array['roster']::text[]
          end
        ) page
      )
    end,
    updated_at = now()
from public.designation_categories category
where category.id = designation.designation_category_id
  and category.company_id = designation.company_id;

do $$
begin
  if exists (
    select 1
    from public.designations designation
    join public.designation_categories category
      on category.id = designation.designation_category_id
     and category.company_id = designation.company_id
    where category.people_module = 'delivery_network'
      and exists (
        select 1
        from public.employees employee
        where employee.company_id = designation.company_id
          and employee.designation_id = designation.id
      )
      and not exists (
        select 1
        from public.workforce worker
        where worker.company_id = designation.company_id
          and worker.designation_id = designation.id
          and worker.deleted_at is null
      )
  ) then
    raise exception 'Employee-only HR designations remain classified as Workforce.';
  end if;
end
$$;

notify pgrst, 'reload schema';

commit;
