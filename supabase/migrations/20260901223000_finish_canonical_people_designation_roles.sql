begin;

-- The first default-provisioning pass deliberately skipped policies that
-- already pointed to an active legacy role. That left different People
-- designations sharing labels such as Cluster Head, Regional Head and Zonal
-- Head. Preserve those role IDs for audit history, but move every enabled
-- People designation policy to its own product/designation role.
create temporary table _designation_policy_sources on commit drop as
select
  policy.company_id,
  policy.designation_id,
  policy.product_code,
  policy.default_role_id as old_role_id,
  upper(policy.product_code) || '_' ||
    left(regexp_replace(upper(coalesce(nullif(designation.code, ''), designation.name)), '[^A-Z0-9]+', '_', 'g'), 28) as canonical_role_code
from public.designation_product_access_policies policy
join public.designations designation
  on designation.company_id = policy.company_id
 and designation.id = policy.designation_id
 and designation.is_active
join public.designation_categories category
  on category.company_id = designation.company_id
 and category.id = designation.designation_category_id
 and category.people_module = 'people_hr'
 and category.is_active
where policy.is_enabled
  and policy.product_code in ('people','operations','workforce','recruit','finance');

-- Nulling only the non-canonical default makes the existing idempotent
-- provisioner clone its proven permissions and create the canonical role. The
-- source role remains active and unchanged for historical references.
update public.designation_product_access_policies policy
set default_role_id = null,
    updated_at = now()
from _designation_policy_sources source
left join public.user_roles existing_role
  on existing_role.company_id = source.company_id
 and existing_role.id = source.old_role_id
where policy.company_id = source.company_id
  and policy.designation_id = source.designation_id
  and policy.product_code = source.product_code
  and (
    source.old_role_id is null
    or existing_role.id is null
    or upper(existing_role.code) <> source.canonical_role_code
    or upper(existing_role.name) in ('CLUSTER HEAD','REGIONAL HEAD','ZONAL HEAD')
  );

do $$
declare
  company_row record;
begin
  for company_row in
    select distinct company_id
    from _designation_policy_sources
    order by company_id
  loop
    perform public.ensure_designation_product_access_defaults(company_row.company_id, null, null);
  end loop;
end;
$$;

-- A canonical role may already exist from an earlier cutover while still
-- carrying the legacy display label that was copied with it. Keep the stable
-- UUID and permission matrix, but make the current People designation the
-- visible name everywhere.
update public.user_roles role
set name = designation.name,
    location_access_mode = case
      when policy.location_access_mode = 'all_locations' then 'all_locations'
      else 'role_based'
    end,
    is_active = true,
    updated_at = now()
from public.designation_product_access_policies policy
join public.designations designation
  on designation.company_id = policy.company_id
 and designation.id = policy.designation_id
where policy.is_enabled
  and policy.product_code in ('people','operations','workforce','recruit','finance')
  and policy.default_role_id = role.id
  and role.company_id = policy.company_id
  and (
    role.name is distinct from designation.name
    or not role.is_active
    or role.location_access_mode is distinct from case
      when policy.location_access_mode = 'all_locations' then 'all_locations'
      else 'role_based'
    end
  );

create temporary table _designation_role_changes on commit drop as
select
  source.company_id,
  source.designation_id,
  source.product_code,
  source.old_role_id,
  policy.default_role_id as new_role_id
from _designation_policy_sources source
join public.designation_product_access_policies policy
  on policy.company_id = source.company_id
 and policy.designation_id = source.designation_id
 and policy.product_code = source.product_code
 and policy.is_enabled
where source.old_role_id is not null
  and policy.default_role_id is not null
  and source.old_role_id <> policy.default_role_id;

-- People has its own page-permission matrix keyed by hr_roles. Attach one to
-- every newly canonical People role and copy the previous matrix.
insert into public.hr_roles (
  company_id, code, name, description, is_system, is_active,
  central_role_id, created_by, updated_by
)
select distinct on (policy.company_id, policy.default_role_id)
  policy.company_id,
  'CENTRAL_' || upper(substr(replace(policy.default_role_id::text, '-', ''), 1, 24)),
  designation.name,
  'People access for the ' || designation.name || ' designation.',
  false,
  true,
  policy.default_role_id,
  null,
  null
from public.designation_product_access_policies policy
join public.designations designation
  on designation.company_id = policy.company_id
 and designation.id = policy.designation_id
where policy.product_code = 'people'
  and policy.is_enabled
  and policy.default_role_id is not null
  and not exists (
    select 1
    from public.hr_roles people_role
    where people_role.company_id = policy.company_id
      and people_role.central_role_id = policy.default_role_id
  )
order by policy.company_id, policy.default_role_id, designation.name, policy.designation_id
on conflict (company_id, code) do update
set name = excluded.name,
    description = excluded.description,
    is_active = true,
    central_role_id = excluded.central_role_id,
    updated_at = now();

insert into public.hr_role_page_permissions (
  company_id, role_id, page_id, can_view, can_add, can_edit,
  can_approve, can_export, created_by, updated_by, updated_at
)
select
  change.company_id,
  target_role.id,
  permission.page_id,
  bool_or(permission.can_view),
  bool_or(permission.can_add),
  bool_or(permission.can_edit),
  bool_or(permission.can_approve),
  bool_or(permission.can_export),
  null,
  null,
  now()
from _designation_role_changes change
join public.hr_roles source_role
  on source_role.company_id = change.company_id
 and source_role.central_role_id = change.old_role_id
join public.hr_roles target_role
  on target_role.company_id = change.company_id
 and target_role.central_role_id = change.new_role_id
join public.hr_role_page_permissions permission
  on permission.company_id = source_role.company_id
 and permission.role_id = source_role.id
where change.product_code = 'people'
group by change.company_id, target_role.id, permission.page_id
on conflict (company_id, role_id, page_id) do update
set can_view = public.hr_role_page_permissions.can_view or excluded.can_view,
    can_add = public.hr_role_page_permissions.can_add or excluded.can_add,
    can_edit = public.hr_role_page_permissions.can_edit or excluded.can_edit,
    can_approve = public.hr_role_page_permissions.can_approve or excluded.can_approve,
    can_export = public.hr_role_page_permissions.can_export or excluded.can_export,
    updated_at = now();

update public.hr_designation_mappings mapping
set access_role_id = target_role.id,
    grants_default_people_access = true,
    is_available = true,
    updated_at = now()
from public.designation_product_access_policies policy
join public.hr_roles target_role
  on target_role.company_id = policy.company_id
 and target_role.central_role_id = policy.default_role_id
where policy.product_code = 'people'
  and policy.is_enabled
  and mapping.company_id = policy.company_id
  and mapping.designation_id = policy.designation_id;

update public.hr_user_access access
set role_id = people_role.id,
    role_code = central_role.code,
    location_ids = case when membership.has_all_location_access then '{}'::uuid[] else membership.location_scope_ids end,
    all_locations = membership.has_all_location_access,
    is_active = true,
    updated_at = now()
from public.company_product_memberships membership
join public.user_roles central_role
  on central_role.company_id = membership.company_id
 and central_role.id = membership.role_id
join public.hr_roles people_role
  on people_role.company_id = central_role.company_id
 and people_role.central_role_id = central_role.id
where membership.product_code = 'people'
  and membership.is_active
  and access.company_id = membership.company_id
  and access.user_id = membership.user_id;

-- Payment routing and the position register use stable role UUIDs. Translate
-- only the known legacy business capabilities to their current People
-- designation; completed approval logs remain immutable.
create temporary table _payment_role_map (
  company_id uuid not null,
  old_role_id uuid not null,
  new_role_id uuid not null,
  primary key (company_id, old_role_id)
) on commit drop;

insert into _payment_role_map (company_id, old_role_id, new_role_id)
select distinct on (legacy.company_id, legacy.id)
  legacy.company_id,
  legacy.id,
  policy.default_role_id
from (values
  ('CLUSTER_HEAD','operations','CLM',10),
  ('REGIONAL_HEAD','operations','RM',20),
  ('ZONAL_HEAD','operations','BH',30),
  ('FLEET','operations','FLTM',40),
  ('NATIONAL_HEAD','operations','NH',50),
  ('PROGRAM_HEAD','operations','PGM',60),
  ('ACCOUNTS','finance','ACE',70),
  ('FINANCE_HEAD','finance','FINMGR',80)
) mapping(legacy_code, product_code, designation_code, priority)
join public.user_roles legacy
  on regexp_replace(upper(legacy.code), '^(OPERATIONS|FINANCE|WORKFORCE|PEOPLE|RECRUIT)_', '') = mapping.legacy_code
join public.designations designation
  on designation.company_id = legacy.company_id
 and upper(designation.code) = mapping.designation_code
 and designation.is_active
join public.designation_product_access_policies policy
  on policy.company_id = designation.company_id
 and policy.designation_id = designation.id
 and policy.product_code = mapping.product_code
 and policy.is_enabled
 and policy.default_role_id is not null
where legacy.id <> policy.default_role_id
order by legacy.company_id, legacy.id, mapping.priority;

insert into public.role_page_permissions (
  company_id, role_id, page_id, can_view, can_add, can_edit, updated_at
)
select permission.company_id, mapping.new_role_id, permission.page_id,
       bool_or(permission.can_view), bool_or(permission.can_add), bool_or(permission.can_edit), now()
from _payment_role_map mapping
join public.role_page_permissions permission
  on permission.company_id = mapping.company_id
 and permission.role_id = mapping.old_role_id
group by permission.company_id, mapping.new_role_id, permission.page_id
on conflict (company_id, role_id, page_id) do update
set can_view = public.role_page_permissions.can_view or excluded.can_view,
    can_add = public.role_page_permissions.can_add or excluded.can_add,
    can_edit = public.role_page_permissions.can_edit or excluded.can_edit,
    updated_at = now();

update public.org_positions position
set role_id = mapping.new_role_id,
    updated_at = now()
from _payment_role_map mapping
where position.company_id = mapping.company_id
  and position.role_id = mapping.old_role_id;

update public.payment_heads head
set initial_approval_role_id = coalesce((
      select mapping.new_role_id from _payment_role_map mapping
      where mapping.company_id = head.company_id and mapping.old_role_id = head.initial_approval_role_id
    ), head.initial_approval_role_id),
    final_approval_role_id = coalesce((
      select mapping.new_role_id from _payment_role_map mapping
      where mapping.company_id = head.company_id and mapping.old_role_id = head.final_approval_role_id
    ), head.final_approval_role_id),
    initial_approval_role_ids = coalesce((
      select array_agg(remapped.role_id order by remapped.first_position)
      from (
        select coalesce(mapping.new_role_id, item.role_id) as role_id, min(item.position) as first_position
        from unnest(coalesce(head.initial_approval_role_ids, '{}'::uuid[])) with ordinality item(role_id, position)
        left join _payment_role_map mapping
          on mapping.company_id = head.company_id and mapping.old_role_id = item.role_id
        group by coalesce(mapping.new_role_id, item.role_id)
      ) remapped
    ), '{}'::uuid[]),
    final_approval_role_ids = coalesce((
      select array_agg(remapped.role_id order by remapped.first_position)
      from (
        select coalesce(mapping.new_role_id, item.role_id) as role_id, min(item.position) as first_position
        from unnest(coalesce(head.final_approval_role_ids, '{}'::uuid[])) with ordinality item(role_id, position)
        left join _payment_role_map mapping
          on mapping.company_id = head.company_id and mapping.old_role_id = item.role_id
        group by coalesce(mapping.new_role_id, item.role_id)
      ) remapped
    ), '{}'::uuid[]),
    payment_process_role_ids = coalesce((
      select array_agg(remapped.role_id order by remapped.first_position)
      from (
        select coalesce(mapping.new_role_id, item.role_id) as role_id, min(item.position) as first_position
        from unnest(coalesce(head.payment_process_role_ids, '{}'::uuid[])) with ordinality item(role_id, position)
        left join _payment_role_map mapping
          on mapping.company_id = head.company_id and mapping.old_role_id = item.role_id
        group by coalesce(mapping.new_role_id, item.role_id)
      ) remapped
    ), '{}'::uuid[]),
    updated_at = now()
where exists (
  select 1
  from _payment_role_map mapping
  where mapping.company_id = head.company_id
    and (
      mapping.old_role_id = head.initial_approval_role_id
      or mapping.old_role_id = head.final_approval_role_id
      or mapping.old_role_id = any(coalesce(head.initial_approval_role_ids, '{}'::uuid[]))
      or mapping.old_role_id = any(coalesce(head.final_approval_role_ids, '{}'::uuid[]))
      or mapping.old_role_id = any(coalesce(head.payment_process_role_ids, '{}'::uuid[]))
    )
);

update public.payment_requests request
set current_approver_role_id = coalesce((
      select mapping.new_role_id from _payment_role_map mapping
      where mapping.company_id = request.company_id and mapping.old_role_id = request.current_approver_role_id
    ), request.current_approver_role_id),
    final_approval_role_id = coalesce((
      select mapping.new_role_id from _payment_role_map mapping
      where mapping.company_id = request.company_id and mapping.old_role_id = request.final_approval_role_id
    ), request.final_approval_role_id),
    current_approver_role_ids = coalesce((
      select array_agg(remapped.role_id order by remapped.first_position)
      from (
        select coalesce(mapping.new_role_id, item.role_id) as role_id, min(item.position) as first_position
        from unnest(coalesce(request.current_approver_role_ids, '{}'::uuid[])) with ordinality item(role_id, position)
        left join _payment_role_map mapping
          on mapping.company_id = request.company_id and mapping.old_role_id = item.role_id
        group by coalesce(mapping.new_role_id, item.role_id)
      ) remapped
    ), '{}'::uuid[]),
    final_approval_role_ids = coalesce((
      select array_agg(remapped.role_id order by remapped.first_position)
      from (
        select coalesce(mapping.new_role_id, item.role_id) as role_id, min(item.position) as first_position
        from unnest(coalesce(request.final_approval_role_ids, '{}'::uuid[])) with ordinality item(role_id, position)
        left join _payment_role_map mapping
          on mapping.company_id = request.company_id and mapping.old_role_id = item.role_id
        group by coalesce(mapping.new_role_id, item.role_id)
      ) remapped
    ), '{}'::uuid[]),
    payment_process_role_ids = coalesce((
      select array_agg(remapped.role_id order by remapped.first_position)
      from (
        select coalesce(mapping.new_role_id, item.role_id) as role_id, min(item.position) as first_position
        from unnest(coalesce(request.payment_process_role_ids, '{}'::uuid[])) with ordinality item(role_id, position)
        left join _payment_role_map mapping
          on mapping.company_id = request.company_id and mapping.old_role_id = item.role_id
        group by coalesce(mapping.new_role_id, item.role_id)
      ) remapped
    ), '{}'::uuid[]),
    updated_at = now()
where exists (
  select 1
  from _payment_role_map mapping
  where mapping.company_id = request.company_id
    and (
      mapping.old_role_id = request.current_approver_role_id
      or mapping.old_role_id = request.final_approval_role_id
      or mapping.old_role_id = any(coalesce(request.current_approver_role_ids, '{}'::uuid[]))
      or mapping.old_role_id = any(coalesce(request.final_approval_role_ids, '{}'::uuid[]))
      or mapping.old_role_id = any(coalesce(request.payment_process_role_ids, '{}'::uuid[]))
    )
);

-- Expose a read-only health view so deployment checks can prove that the
-- current designation, policy role and effective membership agree.
create or replace view public.people_product_access_health
with (security_invoker = true)
as
select
  policy.company_id,
  policy.product_code,
  designation.id as designation_id,
  designation.code as designation_code,
  designation.name as designation_name,
  policy.is_enabled,
  policy.default_role_id,
  role.code as role_code,
  role.name as role_name,
  case
    when not policy.is_enabled then 'disabled'
    when policy.default_role_id is null then 'missing_role'
    when role.id is null or not role.is_active then 'inactive_role'
    when upper(role.code) <> (
      upper(policy.product_code) || '_' ||
      left(regexp_replace(upper(coalesce(nullif(designation.code, ''), designation.name)), '[^A-Z0-9]+', '_', 'g'), 28)
    )
      then 'legacy_role'
    when role.name <> designation.name then 'name_mismatch'
    else 'healthy'
  end as health_state
from public.designation_product_access_policies policy
join public.designations designation
  on designation.company_id = policy.company_id
 and designation.id = policy.designation_id
join public.designation_categories category
  on category.company_id = designation.company_id
 and category.id = designation.designation_category_id
 and category.people_module = 'people_hr'
left join public.user_roles role
  on role.company_id = policy.company_id
 and role.id = policy.default_role_id;

grant select on public.people_product_access_health to service_role;
notify pgrst, 'reload schema';

commit;
