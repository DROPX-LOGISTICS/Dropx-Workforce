begin;

-- AOM is already referenced by live People assignments (for example the
-- existing Andhra Pradesh AOM). Reactivate that exact master row instead of
-- creating a duplicate, then restore its People ownership and defaults.
do $$
begin
  if not exists (
    select 1
    from public.designations designation
    where upper(trim(designation.code)) = 'AOM'
       or lower(trim(designation.name)) = 'area operations manager'
  ) then
    raise exception 'The existing Area Operations Manager designation was not found.';
  end if;
end;
$$;

with target as (
  select designation.id,
         designation.company_id,
         category.id as people_category_id
  from public.designations designation
  join public.designation_categories category
    on category.company_id = designation.company_id
   and category.code = 'hr'
   and category.people_module = 'people_hr'
   and category.is_active
  where upper(trim(designation.code)) = 'AOM'
     or lower(trim(designation.name)) = 'area operations manager'
)
update public.designations designation
set designation_category_id = target.people_category_id,
    portal_scopes = array['people','operations','workforce']::text[],
    is_active = true,
    updated_at = now()
from target
where designation.id = target.id;

insert into public.hr_designation_mappings (
  company_id,
  designation_id,
  department_id,
  is_available,
  can_be_reporting_manager
)
select designation.company_id,
       designation.id,
       department.id,
       true,
       true
from public.designations designation
join public.hr_departments department
  on department.company_id = designation.company_id
 and department.is_active
 and (
   upper(trim(department.code)) = 'OPS'
   or lower(trim(department.name)) = 'operations'
 )
where upper(trim(designation.code)) = 'AOM'
   or lower(trim(designation.name)) = 'area operations manager'
on conflict (company_id, designation_id) do update
set department_id = excluded.department_id,
    is_available = true,
    can_be_reporting_manager = true;

insert into public.designation_product_access_policies (
  company_id,
  designation_id,
  product_code,
  default_role_id,
  location_access_mode,
  is_enabled,
  is_system_default
)
select designation.company_id,
       designation.id,
       product.product_code,
       role.id,
       'assignment',
       true,
       true
from public.designations designation
cross join lateral unnest(array['people','operations','workforce']::text[]) product(product_code)
left join lateral (
  select candidate.id
  from public.user_roles candidate
  where candidate.company_id = designation.company_id
    and candidate.product_code = product.product_code
    and candidate.is_active
    and upper(candidate.code) in (upper(product.product_code) || '_AOM', 'AOM')
  order by case when upper(candidate.code) = upper(product.product_code) || '_AOM' then 0 else 1 end
  limit 1
) role on true
where upper(trim(designation.code)) = 'AOM'
   or lower(trim(designation.name)) = 'area operations manager'
on conflict (company_id, designation_id, product_code) do update
set is_enabled = true,
    updated_at = now();

notify pgrst, 'reload schema';

commit;
