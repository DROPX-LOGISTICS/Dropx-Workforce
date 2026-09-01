begin;

-- Tech is a privileged control plane, not an employee-facing business portal.
-- Remove it from designation eligibility without touching explicit manual,
-- product-owner, or existing profile grants.
alter table public.designations
  drop constraint if exists designations_portal_scopes_check;

update public.designations designation
set portal_scopes = coalesce((
      select array_agg(scope order by ordinal)
      from unnest(coalesce(designation.portal_scopes, '{}'::text[])) with ordinality item(scope, ordinal)
      where scope <> 'tech'
    ), '{}'::text[]),
    updated_at = now()
where 'tech' = any(coalesce(designation.portal_scopes, '{}'::text[]));

alter table public.designations
  add constraint designations_portal_scopes_check
  check (
    coalesce(portal_scopes, '{}'::text[]) <@ array[
      'operations', 'people', 'workforce', 'recruit', 'finance'
    ]::text[]
  );

update public.designation_product_access_policies
set is_enabled = false,
    updated_at = now()
where product_code = 'tech'
  and is_enabled;

-- People Admin is not the universal employee application. DropX One already
-- provides individual self-service and approvals. Retire only the original
-- broad system default for non-HR/non-leadership designations; any choice that
-- a People administrator saved explicitly (is_system_default = false) remains
-- untouched.
with designation_identity as (
  select designation.id,
         designation.company_id,
         upper(concat_ws(' ', designation.code, designation.name, department.code, department.name)) as identity_text
  from public.designations designation
  join public.designation_categories category
    on category.company_id = designation.company_id
   and category.id = designation.designation_category_id
   and category.people_module = 'people_hr'
  left join public.hr_designation_mappings mapping
    on mapping.company_id = designation.company_id
   and mapping.designation_id = designation.id
  left join public.hr_departments department
    on department.company_id = mapping.company_id
   and department.id = mapping.department_id
)
update public.designation_product_access_policies policy
set is_enabled = false,
    updated_at = now()
from designation_identity identity
where policy.company_id = identity.company_id
  and policy.designation_id = identity.id
  and policy.product_code = 'people'
  and policy.is_system_default
  and policy.is_enabled
  and identity.identity_text !~ '(OWNER|MANAGING PARTNER|NATIONAL HEAD|BUSINESS HEAD|HUMAN RESOURCE|(^| )HR( |$)|PEOPLE|TALENT ACQUISITION|PAYROLL)';

-- Keep the compatibility array aligned with the policy table. Empty is valid
-- and means that the designation uses DropX One only.
update public.designations designation
set portal_scopes = coalesce((
      select array_agg(policy.product_code order by case policy.product_code
        when 'people' then 1
        when 'operations' then 2
        when 'workforce' then 3
        when 'recruit' then 4
        when 'finance' then 5
        else 99
      end)
      from public.designation_product_access_policies policy
      where policy.company_id = designation.company_id
        and policy.designation_id = designation.id
        and policy.is_enabled
        and policy.product_code in ('people','operations','workforce','recruit','finance')
    ), '{}'::text[]),
    updated_at = now()
where exists (
  select 1
  from public.designation_categories category
  where category.company_id = designation.company_id
    and category.id = designation.designation_category_id
    and category.people_module = 'people_hr'
);

update public.company_product_memberships membership
set is_active = false,
    updated_at = now()
where membership.product_code = 'tech'
  and membership.source_system = 'designation_policy'
  and membership.is_active;

-- Capture the role already used most often by active members of each
-- designation. It is the safest template for the new designation-owned role.
create temporary table portal_role_seed on commit drop as
select policy.id as policy_id,
       policy.company_id,
       policy.designation_id,
       policy.product_code,
       policy.location_access_mode,
       designation.name as designation_name,
       left(
         upper(policy.product_code) || '_' ||
         left(regexp_replace(upper(coalesce(nullif(designation.code, ''), designation.name)), '[^A-Z0-9]+', '_', 'g'), 28),
         40
       ) as target_code,
       (
         select membership.role_id
         from public.company_product_memberships membership
         join public.user_roles source_role
           on source_role.company_id = membership.company_id
          and source_role.id = membership.role_id
          and source_role.is_active
         where membership.company_id = policy.company_id
           and membership.designation_id = policy.designation_id
           and membership.product_code = policy.product_code
           and membership.is_active
           and membership.role_id is not null
         group by membership.role_id
         order by count(*) desc, membership.role_id
         limit 1
       ) as source_role_id
from public.designation_product_access_policies policy
join public.designations designation
  on designation.company_id = policy.company_id
 and designation.id = policy.designation_id
join public.designation_categories category
  on category.company_id = designation.company_id
 and category.id = designation.designation_category_id
 and category.people_module = 'people_hr'
where policy.is_enabled
  and policy.default_role_id is null
  and policy.product_code in ('people','operations','workforce','recruit','finance');

insert into public.user_roles (
  company_id, product_code, code, name, parent_role_id,
  location_access_mode, is_system, is_active
)
select seed.company_id,
       seed.product_code,
       seed.target_code,
       seed.designation_name,
       null,
       case when seed.location_access_mode = 'all_locations' then 'all_locations' else 'role_based' end,
       false,
       true
from portal_role_seed seed
where not exists (
  select 1
  from public.user_roles existing
  where existing.company_id = seed.company_id
    and existing.code = seed.target_code
);

-- Copy only the proven permissions already used by that designation. New
-- designations with no prior role intentionally begin with zero permissions
-- and are visibly marked for their portal owner to configure.
insert into public.role_page_permissions (
  company_id, role_id, page_id, can_view, can_add, can_edit
)
select seed.company_id,
       target.id,
       permission.page_id,
       permission.can_view,
       permission.can_add,
       permission.can_edit
from portal_role_seed seed
join public.user_roles target
  on target.company_id = seed.company_id
 and target.code = seed.target_code
join public.role_page_permissions permission
  on permission.company_id = seed.company_id
 and permission.role_id = seed.source_role_id
where seed.source_role_id is not null
  and seed.source_role_id <> target.id
on conflict (company_id, role_id, page_id) do nothing;

-- Recruit keeps its menu matrix in a dedicated table rather than the shared
-- app-page matrix. Some shared production databases have not received that
-- Recruit-owned table yet, so copy it only when it is present. The dynamic SQL
-- avoids resolving the optional relation while the migration is parsed.
do $copy_recruit_permissions$
begin
  if to_regclass('public.recruitment_role_menu_permissions') is not null then
    execute $sql$
      insert into public.recruitment_role_menu_permissions (
        company_id, role_id, role_code, workspace, menu_id,
        can_view, can_add, can_edit, updated_by, updated_at
      )
      select seed.company_id,
             target.id,
             target.code,
             permission.workspace,
             permission.menu_id,
             permission.can_view,
             permission.can_add,
             permission.can_edit,
             null,
             now()
      from portal_role_seed seed
      join public.user_roles target
        on target.company_id = seed.company_id
       and target.code = seed.target_code
      join public.recruitment_role_menu_permissions permission
        on permission.company_id = seed.company_id
       and permission.role_id = seed.source_role_id
      where seed.product_code = 'recruit'
        and seed.source_role_id is not null
        and seed.source_role_id <> target.id
      on conflict (company_id, role_id, workspace, menu_id) do nothing
    $sql$;
  end if;
end
$copy_recruit_permissions$;

update public.designation_product_access_policies policy
set default_role_id = target.id,
    updated_at = now()
from portal_role_seed seed
join public.user_roles target
  on target.company_id = seed.company_id
 and target.code = seed.target_code
where policy.id = seed.policy_id
  and policy.default_role_id is null;

-- Refresh only designation-managed memberships. Explicit person overrides,
-- location accounts, manual grants and product-owner grants remain unchanged.
do $$
declare
  item record;
begin
  for item in
    select distinct company_id, designation_id
    from public.designation_product_access_policies
    where is_enabled
      and product_code in ('people','operations','workforce','recruit','finance')
  loop
    perform public.reconcile_designation_product_memberships(
      item.company_id,
      item.designation_id,
      null
    );
  end loop;
end
$$;

comment on column public.designations.portal_scopes is
  'Designation-eligible administrative business portals: People, OpsPulse, Workforce, Recruit and Finance. Empty means DropX One-only. Technical administration is an explicit Dashboard grant.';

notify pgrst, 'reload schema';

commit;
