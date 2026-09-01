begin;

-- A People designation that is enabled for a portal must be usable without a
-- second administrator creating another role.  Reuse the proven legacy role
-- as the permission template, create the canonical designation role, and keep
-- the copied matrix editable by that portal's owner.
create or replace function public.ensure_designation_product_access_defaults(
  p_company_id uuid,
  p_actor_user_id uuid default null,
  p_designation_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
  designation_row record;
  target_role_id uuid;
  source_role_id uuid;
  target_code text;
  legacy_code text;
  roles_created integer := 0;
  policies_configured integer := 0;
  shared_permissions_copied integer := 0;
  recruit_permissions_copied integer := 0;
  affected_rows integer := 0;
begin
  if not exists (
    select 1
    from public.companies company
    where company.id = p_company_id
      and company.is_active
  ) then
    raise exception 'Select an active company.';
  end if;

  for item in
    select policy.id as policy_id,
           policy.company_id,
           policy.designation_id,
           policy.product_code,
           policy.location_access_mode,
           policy.default_role_id,
           designation.code as designation_code,
           designation.name as designation_name
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
    where policy.company_id = p_company_id
      and policy.is_enabled
      and policy.product_code in ('people','operations','workforce','recruit','finance')
      and (p_designation_id is null or policy.designation_id = p_designation_id)
      and (
        policy.default_role_id is null
        or not exists (
          select 1
          from public.user_roles current_role
          where current_role.company_id = policy.company_id
            and current_role.id = policy.default_role_id
            and current_role.product_code = policy.product_code
            and current_role.is_active
        )
      )
    order by designation.name, policy.product_code
  loop
    target_role_id := null;
    source_role_id := null;
    target_code := left(
      upper(item.product_code) || '_' ||
      left(regexp_replace(upper(coalesce(nullif(item.designation_code, ''), item.designation_name)), '[^A-Z0-9]+', '_', 'g'), 28),
      40
    );

    legacy_code := case upper(item.designation_code)
      when 'ACE' then 'ACCOUNTS'
      when 'AOM' then 'REGIONAL_HEAD'
      when 'ATL' then 'TEAM_LEADER'
      when 'BH' then 'ZONAL_HEAD'
      when 'CM' then 'REGIONAL_HEAD'
      when 'CLM' then 'CLUSTER_HEAD'
      when 'CT' then 'CONTROL_TOWER'
      when 'CONTROL_TOWER_ASSOCIATE' then 'CONTROL_TOWER'
      when 'FINMGR' then 'FINANCE_HEAD'
      when 'FLTM' then 'FLEET'
      when 'FSD' then 'TECH'
      when 'HRE' then 'HR_EXECUTIVE'
      when 'HRM' then 'HR_HEAD'
      when 'MANAGING_PARTNER' then 'OWNER'
      when 'NH' then 'NATIONAL_HEAD'
      when 'PGM' then 'PROGRAM_HEAD'
      when 'RM' then 'REGIONAL_HEAD'
      when 'SRSM' then 'STATION_MANAGER'
      when 'STM' then 'STATION_MANAGER'
      when 'SSA' then 'SSA'
      when 'TL' then 'TEAM_LEADER'
      when 'TC' then 'TELE_CALLER'
      else regexp_replace(upper(item.designation_code), '[^A-Z0-9]+', '_', 'g')
    end;

    select role.id
      into target_role_id
    from public.user_roles role
    where role.company_id = item.company_id
      and role.product_code = item.product_code
      and upper(role.code) = target_code
      and role.is_active
    order by role.id
    limit 1;

    -- First preference is the role that people with this designation already
    -- used before the cutover.  It is the strongest evidence of the previous
    -- working default and preserves payment/approval menus.
    select membership.role_id
      into source_role_id
    from public.company_product_memberships membership
    join public.people_portal_access_candidates candidate
      on candidate.company_id = membership.company_id
     and candidate.user_id = membership.user_id
     and candidate.designation_id = item.designation_id
    join public.user_roles source_role
      on source_role.company_id = membership.company_id
     and source_role.id = membership.role_id
     and source_role.product_code = item.product_code
     and source_role.is_active
    where membership.company_id = item.company_id
      and membership.product_code = item.product_code
      and membership.is_active
      and membership.role_id is not null
      and (target_role_id is null or membership.role_id <> target_role_id)
    group by membership.role_id
    order by count(*) desc, membership.role_id
    limit 1;

    -- If no current person proves the mapping, use the former role name that
    -- represented this designation (for example CLUSTER_HEAD -> CLM and
    -- ZONAL_HEAD -> Business Head).  Product prefixes prevent cross-portal
    -- permissions from being mixed.
    if source_role_id is null then
      select role.id
        into source_role_id
      from public.user_roles role
      where role.company_id = item.company_id
        and role.product_code = item.product_code
        and role.is_active
        and (target_role_id is null or role.id <> target_role_id)
        and (
          upper(role.code) = upper(item.product_code) || '_' || legacy_code
          or upper(role.code) = legacy_code
          or upper(role.code) = regexp_replace(upper(item.designation_code), '[^A-Z0-9]+', '_', 'g')
          or upper(role.name) = upper(item.designation_name)
        )
      order by case
        when upper(role.code) = upper(item.product_code) || '_' || legacy_code then 0
        when upper(role.code) = legacy_code then 1
        when upper(role.name) = upper(item.designation_name) then 2
        else 3
      end, role.id
      limit 1;
    end if;

    if target_role_id is null then
      insert into public.user_roles (
        company_id, product_code, code, name, parent_role_id,
        location_access_mode, is_system, is_active
      )
      values (
        item.company_id,
        item.product_code,
        target_code,
        item.designation_name,
        null,
        case when item.location_access_mode = 'all_locations' then 'all_locations' else 'role_based' end,
        false,
        true
      )
      returning id into target_role_id;
      roles_created := roles_created + 1;
    end if;

    if source_role_id is not null and source_role_id <> target_role_id then
      insert into public.role_page_permissions (
        company_id, role_id, page_id, can_view, can_add, can_edit, updated_at
      )
      select permission.company_id,
             target_role_id,
             permission.page_id,
             permission.can_view,
             permission.can_add,
             permission.can_edit,
             now()
      from public.role_page_permissions permission
      where permission.company_id = item.company_id
        and permission.role_id = source_role_id
      on conflict (company_id, role_id, page_id) do update
      set can_view = public.role_page_permissions.can_view or excluded.can_view,
          can_add = public.role_page_permissions.can_add or excluded.can_add,
          can_edit = public.role_page_permissions.can_edit or excluded.can_edit,
          updated_at = now();
      get diagnostics affected_rows = row_count;
      shared_permissions_copied := shared_permissions_copied + affected_rows;

      if item.product_code = 'recruit'
         and to_regclass('public.recruitment_role_menu_permissions') is not null then
        execute $copy_recruit$
          insert into public.recruitment_role_menu_permissions (
            company_id, role_id, role_code, workspace, menu_id,
            can_view, can_add, can_edit, updated_by, updated_at
          )
          select permission.company_id,
                 $1,
                 $2,
                 permission.workspace,
                 permission.menu_id,
                 permission.can_view,
                 permission.can_add,
                 permission.can_edit,
                 $3,
                 now()
          from public.recruitment_role_menu_permissions permission
          where permission.company_id = $4
            and permission.role_id = $5
          on conflict (company_id, role_id, workspace, menu_id) do update
          set can_view = public.recruitment_role_menu_permissions.can_view or excluded.can_view,
              can_add = public.recruitment_role_menu_permissions.can_add or excluded.can_add,
              can_edit = public.recruitment_role_menu_permissions.can_edit or excluded.can_edit,
              updated_by = excluded.updated_by,
              updated_at = now()
        $copy_recruit$
        using target_role_id, target_code, p_actor_user_id, item.company_id, source_role_id;
        get diagnostics affected_rows = row_count;
        recruit_permissions_copied := recruit_permissions_copied + affected_rows;
      end if;
    end if;

    update public.designation_product_access_policies policy
    set default_role_id = target_role_id,
        is_system_default = true,
        updated_by = p_actor_user_id,
        updated_at = now()
    where policy.id = item.policy_id;
    policies_configured := policies_configured + 1;
  end loop;

  -- Refresh only designation-owned memberships. Manual/person overrides,
  -- product owners, station accounts and technical administrators are never
  -- replaced by this operation.
  for designation_row in
    select distinct policy.designation_id
    from public.designation_product_access_policies policy
    where policy.company_id = p_company_id
      and policy.is_enabled
      and (p_designation_id is null or policy.designation_id = p_designation_id)
  loop
    perform public.reconcile_designation_product_memberships(
      p_company_id,
      designation_row.designation_id,
      p_actor_user_id
    );
  end loop;

  return jsonb_build_object(
    'roles_created', roles_created,
    'policies_configured', policies_configured,
    'shared_permissions_copied', shared_permissions_copied,
    'recruit_permissions_copied', recruit_permissions_copied
  );
end;
$$;

revoke all on function public.ensure_designation_product_access_defaults(uuid,uuid,uuid)
  from public, anon, authenticated;

grant execute on function public.ensure_designation_product_access_defaults(uuid,uuid,uuid)
  to service_role;

comment on function public.ensure_designation_product_access_defaults(uuid,uuid,uuid) is
  'Creates editable portal roles for enabled People designations and seeds them from the proven pre-cutover role without modifying explicit user or location grants.';

-- Complete the one-time cutover as part of the migration. Future People
-- designation saves call the same idempotent function for only that role.
do $$
declare
  company_row record;
begin
  for company_row in
    select company.id
    from public.companies company
    where company.is_active
    order by company.id
  loop
    perform public.ensure_designation_product_access_defaults(
      company_row.id,
      null,
      null
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;
