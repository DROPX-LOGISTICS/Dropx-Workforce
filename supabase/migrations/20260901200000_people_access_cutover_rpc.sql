begin;

-- Location accounts are station identities managed by Dashboard. They are not
-- People designations, and they need a distinct membership source so that
-- designation reconciliation can never absorb or withdraw them.
alter table public.company_product_memberships
  drop constraint if exists company_product_memberships_source_check;

alter table public.company_product_memberships
  add constraint company_product_memberships_source_check
  check (source_system in (
    'manual','product_owner','product_admin','legacy_dashboard','people_hr',
    'recruit','google_workspace','designation_policy','person_override',
    'location_master'
  ));

-- This service-role-only operation performs the authorised, one-time access
-- cutover after the schema and all portal UIs are live. It is deliberately not
-- invoked by this migration: production data changes happen through the
-- Super Admin control in Dashboard and are therefore explicit and auditable.
create or replace function public.perform_people_access_cutover(
  p_company_id uuid,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  workspace_links integer := 0;
  designation_memberships integer := 0;
  withdrawn_people_finance integer := 0;
  location_memberships integer := 0;
  withdrawn_location_finance integer := 0;
  payment_heads_remapped integer := 0;
  payment_requests_remapped integer := 0;
  designation_row record;
begin
  if not exists (
    select 1 from public.companies company
    where company.id = p_company_id and company.is_active
  ) then
    raise exception 'Select an active company.';
  end if;

  drop table if exists pg_temp._safe_workspace_links;
  create temporary table _safe_workspace_links on commit drop as
  with current_people as (
    select distinct on (person.company_id, person.id)
      person.company_id,
      person.id as person_id,
      person.display_name,
      assignment.designation_id
    from public.hr_people person
    join public.hr_engagements engagement
      on engagement.company_id = person.company_id
     and engagement.person_id = person.id
     and engagement.status = 'active'
    join public.hr_work_assignments assignment
      on assignment.company_id = engagement.company_id
     and assignment.engagement_id = engagement.id
     and assignment.is_primary
     and assignment.effective_from <= current_date
     and (assignment.effective_to is null or assignment.effective_to >= current_date)
    join public.designations designation
      on designation.company_id = assignment.company_id
     and designation.id = assignment.designation_id
     and designation.is_active
    join public.designation_categories category
      on category.company_id = designation.company_id
     and category.id = designation.designation_category_id
     and category.people_module = 'people_hr'
     and category.is_active
    where person.company_id = p_company_id
      and person.status = 'active'
    order by person.company_id, person.id, assignment.effective_from desc, assignment.created_at desc
  ), raw_matches as (
    select
      workspace.id as workspace_account_id,
      workspace.company_id,
      workspace.primary_email,
      profile.id as user_id,
      current_person.person_id,
      current_person.designation_id,
      count(*) over (partition by workspace.id) as people_matches,
      count(*) over (partition by current_person.person_id) as workspace_matches
    from public.google_workspace_accounts workspace
    join public.profiles profile
      on profile.company_id = workspace.company_id
     and profile.is_active
     and lower(trim(profile.email)) = lower(trim(workspace.primary_email))
    join current_people current_person
      on current_person.company_id = workspace.company_id
     and regexp_replace(lower(current_person.display_name), '[^a-z0-9]+', '', 'g') =
         regexp_replace(lower(coalesce(nullif(trim(workspace.full_name), ''), profile.full_name)), '[^a-z0-9]+', '', 'g')
    where workspace.company_id = p_company_id
      and lower(coalesce(workspace.account_state, '')) = 'active'
      and not coalesce(workspace.suspended, false)
      and (workspace.person_id is null or workspace.person_id = current_person.person_id)
      and not exists (
        select 1
        from public.hr_user_person_links link
        where link.company_id = workspace.company_id
          and link.user_id = profile.id
          and link.status = 'active'
          and link.person_id <> current_person.person_id
      )
      and not exists (
        select 1
        from public.hr_user_person_links link
        where link.company_id = workspace.company_id
          and link.person_id = current_person.person_id
          and link.status = 'active'
          and link.user_id <> profile.id
      )
  )
  select workspace_account_id, company_id, primary_email, user_id, person_id, designation_id
  from raw_matches
  where people_matches = 1 and workspace_matches = 1;

  insert into public.hr_user_person_links (
    company_id, user_id, person_id, status, verified_by, verified_at, updated_at
  )
  select company_id, user_id, person_id, 'active', p_actor_user_id, now(), now()
  from pg_temp._safe_workspace_links
  on conflict (company_id, user_id) do update
  set person_id = excluded.person_id,
      status = 'active',
      verified_by = excluded.verified_by,
      verified_at = excluded.verified_at,
      updated_at = now();

  get diagnostics workspace_links = row_count;

  update public.google_workspace_accounts workspace
  set person_id = safe.person_id,
      profile_id = safe.user_id,
      designation_id = safe.designation_id,
      source_type = 'people_person',
      source_record_id = safe.person_id,
      updated_at = now()
  from pg_temp._safe_workspace_links safe
  where workspace.id = safe.workspace_account_id;

  drop table if exists pg_temp._legacy_people_memberships;
  create temporary table _legacy_people_memberships on commit drop as
  select
    membership.id as membership_id,
    membership.company_id,
    membership.product_code,
    membership.user_id,
    membership.role_id as legacy_role_id,
    candidate.designation_id,
    designation.code as designation_code,
    designation.name as designation_name
  from public.company_product_memberships membership
  join public.people_portal_access_candidates candidate
    on candidate.company_id = membership.company_id
   and candidate.user_id = membership.user_id
  join public.designations designation
    on designation.company_id = candidate.company_id
   and designation.id = candidate.designation_id
  where membership.company_id = p_company_id
    and membership.is_active
    and membership.source_system not in ('manual','person_override','product_owner','product_admin')
    and membership.product_code in ('operations','workforce','recruit','people','finance')
    and not exists (
      select 1
      from public.stations station
      join public.profiles station_profile
        on station_profile.company_id = station.company_id
       and lower(trim(station_profile.email)) = lower(trim(station.station_email))
      where station.company_id = membership.company_id
        and station.is_active
        and station_profile.id = membership.user_id
    );

  -- Preserve existing Ops, Workforce and Recruit eligibility, but express it
  -- through the current People designation instead of generated legacy roles.
  insert into public.user_roles (
    company_id, product_code, code, name, parent_role_id,
    location_access_mode, is_system, is_active
  )
  select distinct
    legacy.company_id,
    legacy.product_code,
    upper(legacy.product_code) || '_' ||
      regexp_replace(upper(legacy.designation_code), '[^A-Z0-9]+', '_', 'g'),
    legacy.designation_name,
    null,
    'role_based',
    false,
    true
  from pg_temp._legacy_people_memberships legacy
  where (
    legacy.product_code in ('operations','workforce')
    or (legacy.product_code = 'recruit' and legacy.legacy_role_id is not null)
  )
  and not exists (
    select 1
    from public.user_roles role
    where role.company_id = legacy.company_id
      and upper(role.code) = upper(legacy.product_code) || '_' ||
        regexp_replace(upper(legacy.designation_code), '[^A-Z0-9]+', '_', 'g')
  );

  insert into public.designation_product_access_policies (
    company_id, designation_id, product_code, default_role_id,
    location_access_mode, is_enabled, is_system_default,
    created_by, updated_by, updated_at
  )
  select distinct
    legacy.company_id,
    legacy.designation_id,
    legacy.product_code,
    role.id,
    'assignment',
    true,
    false,
    p_actor_user_id,
    p_actor_user_id,
    now()
  from pg_temp._legacy_people_memberships legacy
  left join public.user_roles role
    on role.company_id = legacy.company_id
   and upper(role.code) = upper(legacy.product_code) || '_' ||
     regexp_replace(upper(legacy.designation_code), '[^A-Z0-9]+', '_', 'g')
   and role.is_active
  where legacy.product_code in ('operations','workforce','recruit')
  on conflict (company_id, designation_id, product_code) do update
  set default_role_id = coalesce(public.designation_product_access_policies.default_role_id, excluded.default_role_id),
      is_enabled = true,
      updated_by = excluded.updated_by,
      updated_at = now();

  drop table if exists pg_temp._membership_targets;
  create temporary table _membership_targets on commit drop as
  select
    legacy.membership_id,
    legacy.company_id,
    legacy.product_code,
    legacy.user_id,
    legacy.legacy_role_id,
    legacy.designation_id,
    policy.id as policy_id,
    policy.default_role_id as target_role_id
  from pg_temp._legacy_people_memberships legacy
  join public.designation_product_access_policies policy
    on policy.company_id = legacy.company_id
   and policy.designation_id = legacy.designation_id
   and policy.product_code = legacy.product_code
   and policy.is_enabled
   and policy.default_role_id is not null;

  -- The canonical designation role receives the union of the permissions that
  -- its users already had. This is what prevents a payment/menu regression.
  insert into public.role_page_permissions (
    company_id, role_id, page_id, can_view, can_add, can_edit, updated_at
  )
  select
    permission.company_id,
    target.target_role_id,
    permission.page_id,
    permission.can_view,
    permission.can_add,
    permission.can_edit,
    now()
  from pg_temp._membership_targets target
  join public.role_page_permissions permission
    on permission.company_id = target.company_id
   and permission.role_id = target.legacy_role_id
  where target.legacy_role_id is not null
  on conflict (company_id, role_id, page_id) do update
  set can_view = public.role_page_permissions.can_view or excluded.can_view,
      can_add = public.role_page_permissions.can_add or excluded.can_add,
      can_edit = public.role_page_permissions.can_edit or excluded.can_edit,
      updated_at = now();

  update public.company_product_memberships membership
  set role_id = target.target_role_id,
      role_code_snapshot = role.code,
      source_system = 'designation_policy',
      source_record_id = target.policy_id,
      designation_id = target.designation_id,
      designation_policy_id = target.policy_id,
      updated_at = now()
  from pg_temp._membership_targets target
  join public.user_roles role
    on role.company_id = target.company_id
   and role.id = target.target_role_id
  where membership.id = target.membership_id;

  get diagnostics designation_memberships = row_count;

  -- People Admin is not the individual employee app, and Finance is strictly
  -- Finance/Accounts/Owner. Old grants outside an enabled designation policy
  -- are withdrawn without touching the user's profile or operational data.
  update public.company_product_memberships membership
  set is_active = false,
      updated_at = now()
  from pg_temp._legacy_people_memberships legacy
  where membership.id = legacy.membership_id
    and legacy.product_code in ('people','finance')
    and not exists (
      select 1
      from public.designation_product_access_policies policy
      where policy.company_id = legacy.company_id
        and policy.designation_id = legacy.designation_id
        and policy.product_code = legacy.product_code
        and policy.is_enabled
    );

  get diagnostics withdrawn_people_finance = row_count;

  for designation_row in
    select distinct candidate.designation_id
    from public.people_portal_access_candidates candidate
    where candidate.company_id = p_company_id
  loop
    perform public.reconcile_designation_product_memberships(
      p_company_id, designation_row.designation_id, p_actor_user_id
    );
  end loop;

  drop table if exists pg_temp._location_accounts;
  create temporary table _location_accounts on commit drop as
  select
    station.company_id,
    profile.id as user_id,
    array_agg(distinct station.id) as location_scope_ids
  from public.stations station
  join public.profiles profile
    on profile.company_id = station.company_id
   and profile.is_active
   and lower(trim(profile.email)) = lower(trim(station.station_email))
  where station.company_id = p_company_id
    and station.is_active
    and nullif(trim(station.station_email), '') is not null
  group by station.company_id, profile.id;

  insert into public.user_roles (
    company_id, product_code, code, name, parent_role_id,
    location_access_mode, is_system, is_active
  )
  select
    p_company_id,
    product.product_code,
    upper(product.product_code) || '_LOCATION',
    'Location Account',
    null,
    'role_based',
    false,
    true
  from (values ('operations'),('people'),('workforce'),('recruit'),('finance')) product(product_code)
  where not exists (
    select 1 from public.user_roles role
    where role.company_id = p_company_id
      and upper(role.code) = upper(product.product_code) || '_LOCATION'
  );

  update public.company_product_memberships membership
  set role_id = role.id,
      role_code_snapshot = role.code,
      source_system = 'location_master',
      source_record_id = null,
      has_all_location_access = false,
      location_scope_ids = location.location_scope_ids,
      designation_id = null,
      designation_policy_id = null,
      updated_at = now()
  from pg_temp._location_accounts location,
       public.user_roles role
  where membership.company_id = location.company_id
    and membership.user_id = location.user_id
    and membership.product_code in ('operations','people','workforce','recruit')
    and membership.is_active
    and membership.source_system not in ('manual','person_override','product_owner','product_admin')
    and role.company_id = location.company_id
    and role.code = upper(membership.product_code) || '_LOCATION'
    and role.is_active;

  get diagnostics location_memberships = row_count;

  update public.company_product_memberships membership
  set is_active = false,
      updated_at = now()
  from pg_temp._location_accounts location
  where membership.company_id = location.company_id
    and membership.user_id = location.user_id
    and membership.product_code = 'finance'
    and membership.is_active
    and membership.source_system not in ('manual','person_override','product_owner','product_admin');

  get diagnostics withdrawn_location_finance = row_count;

  drop table if exists pg_temp._payment_role_map;
  create temporary table _payment_role_map (
    company_id uuid not null,
    old_role_id uuid not null,
    new_role_id uuid not null,
    primary key (company_id, old_role_id)
  ) on commit drop;

  insert into pg_temp._payment_role_map (company_id, old_role_id, new_role_id)
  select old_role.company_id, old_role.id, policy.default_role_id
  from (values
    ('CLUSTER_HEAD','operations','CLM'),
    ('REGIONAL_HEAD','operations','RM'),
    ('ZONAL_HEAD','operations','BH'),
    ('FLEET','operations','FLTM'),
    ('NATIONAL_HEAD','operations','NH'),
    ('PROGRAM_HEAD','operations','PGM'),
    ('ACCOUNTS','finance','ACE'),
    ('FINANCE_HEAD','finance','FINMGR')
  ) mapping(old_code, product_code, designation_code)
  join public.user_roles old_role
    on old_role.company_id = p_company_id
   and upper(old_role.code) = mapping.old_code
  join public.designations designation
    on designation.company_id = old_role.company_id
   and upper(designation.code) = mapping.designation_code
  join public.designation_product_access_policies policy
    on policy.company_id = designation.company_id
   and policy.designation_id = designation.id
   and policy.product_code = mapping.product_code
   and policy.is_enabled
   and policy.default_role_id is not null
  on conflict (company_id, old_role_id) do update
  set new_role_id = excluded.new_role_id;

  insert into public.role_page_permissions (
    company_id, role_id, page_id, can_view, can_add, can_edit, updated_at
  )
  select permission.company_id, mapping.new_role_id, permission.page_id,
         permission.can_view, permission.can_add, permission.can_edit, now()
  from pg_temp._payment_role_map mapping
  join public.role_page_permissions permission
    on permission.company_id = mapping.company_id
   and permission.role_id = mapping.old_role_id
  on conflict (company_id, role_id, page_id) do update
  set can_view = public.role_page_permissions.can_view or excluded.can_view,
      can_add = public.role_page_permissions.can_add or excluded.can_add,
      can_edit = public.role_page_permissions.can_edit or excluded.can_edit,
      updated_at = now();

  update public.payment_heads head
  set initial_approval_role_id = coalesce((
        select mapping.new_role_id from pg_temp._payment_role_map mapping
        where mapping.company_id = head.company_id and mapping.old_role_id = head.initial_approval_role_id
      ), head.initial_approval_role_id),
      final_approval_role_id = coalesce((
        select mapping.new_role_id from pg_temp._payment_role_map mapping
        where mapping.company_id = head.company_id and mapping.old_role_id = head.final_approval_role_id
      ), head.final_approval_role_id),
      initial_approval_role_ids = coalesce((
        select array_agg(remapped.role_id order by remapped.first_position)
        from (
          select coalesce(mapping.new_role_id, item.role_id) as role_id, min(item.position) as first_position
          from unnest(coalesce(head.initial_approval_role_ids, '{}'::uuid[])) with ordinality item(role_id, position)
          left join pg_temp._payment_role_map mapping
            on mapping.company_id = head.company_id and mapping.old_role_id = item.role_id
          group by coalesce(mapping.new_role_id, item.role_id)
        ) remapped
      ), '{}'::uuid[]),
      final_approval_role_ids = coalesce((
        select array_agg(remapped.role_id order by remapped.first_position)
        from (
          select coalesce(mapping.new_role_id, item.role_id) as role_id, min(item.position) as first_position
          from unnest(coalesce(head.final_approval_role_ids, '{}'::uuid[])) with ordinality item(role_id, position)
          left join pg_temp._payment_role_map mapping
            on mapping.company_id = head.company_id and mapping.old_role_id = item.role_id
          group by coalesce(mapping.new_role_id, item.role_id)
        ) remapped
      ), '{}'::uuid[]),
      payment_process_role_ids = coalesce((
        select array_agg(remapped.role_id order by remapped.first_position)
        from (
          select coalesce(mapping.new_role_id, item.role_id) as role_id, min(item.position) as first_position
          from unnest(coalesce(head.payment_process_role_ids, '{}'::uuid[])) with ordinality item(role_id, position)
          left join pg_temp._payment_role_map mapping
            on mapping.company_id = head.company_id and mapping.old_role_id = item.role_id
          group by coalesce(mapping.new_role_id, item.role_id)
        ) remapped
      ), '{}'::uuid[]),
      updated_at = now()
  where head.company_id = p_company_id
    and (
      exists (select 1 from pg_temp._payment_role_map mapping where mapping.company_id = head.company_id and mapping.old_role_id = head.initial_approval_role_id)
      or exists (select 1 from pg_temp._payment_role_map mapping where mapping.company_id = head.company_id and mapping.old_role_id = head.final_approval_role_id)
      or exists (select 1 from pg_temp._payment_role_map mapping where mapping.company_id = head.company_id and mapping.old_role_id = any(head.initial_approval_role_ids))
      or exists (select 1 from pg_temp._payment_role_map mapping where mapping.company_id = head.company_id and mapping.old_role_id = any(head.final_approval_role_ids))
      or exists (select 1 from pg_temp._payment_role_map mapping where mapping.company_id = head.company_id and mapping.old_role_id = any(head.payment_process_role_ids))
    );

  get diagnostics payment_heads_remapped = row_count;

  update public.payment_requests request
  set current_approver_role_id = coalesce((
        select mapping.new_role_id from pg_temp._payment_role_map mapping
        where mapping.company_id = request.company_id and mapping.old_role_id = request.current_approver_role_id
      ), request.current_approver_role_id),
      final_approval_role_id = coalesce((
        select mapping.new_role_id from pg_temp._payment_role_map mapping
        where mapping.company_id = request.company_id and mapping.old_role_id = request.final_approval_role_id
      ), request.final_approval_role_id),
      current_approver_role_ids = coalesce((
        select array_agg(remapped.role_id order by remapped.first_position)
        from (
          select coalesce(mapping.new_role_id, item.role_id) as role_id, min(item.position) as first_position
          from unnest(coalesce(request.current_approver_role_ids, '{}'::uuid[])) with ordinality item(role_id, position)
          left join pg_temp._payment_role_map mapping
            on mapping.company_id = request.company_id and mapping.old_role_id = item.role_id
          group by coalesce(mapping.new_role_id, item.role_id)
        ) remapped
      ), '{}'::uuid[]),
      final_approval_role_ids = coalesce((
        select array_agg(remapped.role_id order by remapped.first_position)
        from (
          select coalesce(mapping.new_role_id, item.role_id) as role_id, min(item.position) as first_position
          from unnest(coalesce(request.final_approval_role_ids, '{}'::uuid[])) with ordinality item(role_id, position)
          left join pg_temp._payment_role_map mapping
            on mapping.company_id = request.company_id and mapping.old_role_id = item.role_id
          group by coalesce(mapping.new_role_id, item.role_id)
        ) remapped
      ), '{}'::uuid[]),
      payment_process_role_ids = coalesce((
        select array_agg(remapped.role_id order by remapped.first_position)
        from (
          select coalesce(mapping.new_role_id, item.role_id) as role_id, min(item.position) as first_position
          from unnest(coalesce(request.payment_process_role_ids, '{}'::uuid[])) with ordinality item(role_id, position)
          left join pg_temp._payment_role_map mapping
            on mapping.company_id = request.company_id and mapping.old_role_id = item.role_id
          group by coalesce(mapping.new_role_id, item.role_id)
        ) remapped
      ), '{}'::uuid[]),
      updated_at = now()
  where request.company_id = p_company_id
    and (
      exists (select 1 from pg_temp._payment_role_map mapping where mapping.company_id = request.company_id and mapping.old_role_id = request.current_approver_role_id)
      or exists (select 1 from pg_temp._payment_role_map mapping where mapping.company_id = request.company_id and mapping.old_role_id = request.final_approval_role_id)
      or exists (select 1 from pg_temp._payment_role_map mapping where mapping.company_id = request.company_id and mapping.old_role_id = any(request.current_approver_role_ids))
      or exists (select 1 from pg_temp._payment_role_map mapping where mapping.company_id = request.company_id and mapping.old_role_id = any(request.final_approval_role_ids))
      or exists (select 1 from pg_temp._payment_role_map mapping where mapping.company_id = request.company_id and mapping.old_role_id = any(request.payment_process_role_ids))
    );

  get diagnostics payment_requests_remapped = row_count;

  return jsonb_build_object(
    'workspace_links', workspace_links,
    'designation_memberships_migrated', designation_memberships,
    'people_or_finance_memberships_withdrawn', withdrawn_people_finance,
    'location_memberships_migrated', location_memberships,
    'location_finance_memberships_withdrawn', withdrawn_location_finance,
    'payment_heads_remapped', payment_heads_remapped,
    'payment_requests_remapped', payment_requests_remapped
  );
end;
$$;

revoke all on function public.perform_people_access_cutover(uuid,uuid)
  from public, anon, authenticated;

grant execute on function public.perform_people_access_cutover(uuid,uuid)
  to service_role;

comment on function public.perform_people_access_cutover(uuid,uuid) is
  'Explicit Super Admin cutover from legacy dashboard roles to People designation roles and Dashboard-owned location accounts. Preserves scopes and remaps live payment approval routing.';

notify pgrst, 'reload schema';

commit;
