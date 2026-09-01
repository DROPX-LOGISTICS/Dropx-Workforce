begin;

-- People designation policy is authoritative for designation-managed portal
-- memberships.  The original cutover deliberately preserved every existing
-- role_id with COALESCE, which also preserved legacy dashboard roles forever.
-- Keep explicit person/product-owner/admin overrides intact, but replace the
-- role on every other membership with the current designation default.
create or replace function public.reconcile_designation_product_memberships(
  p_company_id uuid,
  p_designation_id uuid,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  granted_count integer := 0;
  withdrawn_count integer := 0;
begin
  if not exists (
    select 1
    from public.designations designation
    join public.designation_categories category
      on category.id = designation.designation_category_id
    where designation.company_id = p_company_id
      and designation.id = p_designation_id
      and category.people_module = 'people_hr'
  ) then
    raise exception 'Only a People designation can define portal access.';
  end if;

  insert into public.company_product_memberships (
    company_id, product_code, user_id, role_id, role_code_snapshot,
    source_system, source_record_id, has_all_location_access,
    location_scope_ids, designation_id, designation_policy_id,
    is_active, assigned_by, updated_at
  )
  select
    candidate.company_id,
    policy.product_code,
    candidate.user_id,
    policy.default_role_id,
    role.code,
    'designation_policy',
    policy.id,
    policy.location_access_mode = 'all_locations' or candidate.has_all_location_access,
    case
      when policy.location_access_mode in ('all_locations','none')
        or candidate.has_all_location_access then '{}'::uuid[]
      else coalesce(candidate.location_scope_ids, '{}'::uuid[])
    end,
    policy.designation_id,
    policy.id,
    true,
    p_actor_user_id,
    now()
  from public.people_portal_access_candidates candidate
  join public.designation_product_access_policies policy
    on policy.company_id = candidate.company_id
   and policy.designation_id = candidate.designation_id
   and policy.is_enabled
  left join public.user_roles role
    on role.company_id = policy.company_id
   and role.id = policy.default_role_id
   and role.is_active
  where candidate.company_id = p_company_id
    and candidate.designation_id = p_designation_id
  on conflict (company_id, product_code, user_id) do update
  set
    role_id = case
      when public.company_product_memberships.source_system in (
        'manual', 'person_override', 'product_owner', 'product_admin'
      ) then public.company_product_memberships.role_id
      else excluded.role_id
    end,
    role_code_snapshot = case
      when public.company_product_memberships.source_system in (
        'manual', 'person_override', 'product_owner', 'product_admin'
      ) then public.company_product_memberships.role_code_snapshot
      else excluded.role_code_snapshot
    end,
    source_system = case
      when public.company_product_memberships.source_system in (
        'manual', 'person_override', 'product_owner', 'product_admin'
      ) then public.company_product_memberships.source_system
      else excluded.source_system
    end,
    source_record_id = case
      when public.company_product_memberships.source_system in (
        'manual', 'person_override', 'product_owner', 'product_admin'
      ) then public.company_product_memberships.source_record_id
      else excluded.source_record_id
    end,
    designation_id = excluded.designation_id,
    designation_policy_id = excluded.designation_policy_id,
    has_all_location_access = case
      when public.company_product_memberships.source_system in (
        'manual', 'person_override', 'product_owner', 'product_admin'
      ) then public.company_product_memberships.has_all_location_access
      else excluded.has_all_location_access
    end,
    location_scope_ids = case
      when public.company_product_memberships.source_system in (
        'manual', 'person_override', 'product_owner', 'product_admin'
      ) then public.company_product_memberships.location_scope_ids
      else excluded.location_scope_ids
    end,
    is_active = true,
    assigned_by = coalesce(excluded.assigned_by, public.company_product_memberships.assigned_by),
    updated_at = now();

  get diagnostics granted_count = row_count;

  update public.company_product_memberships membership
  set is_active = false,
      updated_at = now()
  where membership.company_id = p_company_id
    and membership.designation_id = p_designation_id
    and membership.source_system = 'designation_policy'
    and membership.is_active
    and not exists (
      select 1
      from public.designation_product_access_policies policy
      where policy.company_id = membership.company_id
        and policy.designation_id = membership.designation_id
        and policy.product_code = membership.product_code
        and policy.is_enabled
    );

  get diagnostics withdrawn_count = row_count;

  return jsonb_build_object(
    'designation_id', p_designation_id,
    'memberships_granted_or_refreshed', granted_count,
    'policy_memberships_withdrawn', withdrawn_count
  );
end;
$$;

revoke all on function public.reconcile_designation_product_memberships(uuid,uuid,uuid)
  from public, anon, authenticated;

grant execute on function public.reconcile_designation_product_memberships(uuid,uuid,uuid)
  to service_role;

comment on function public.reconcile_designation_product_memberships(uuid,uuid,uuid) is
  'Reconciles People designation portal memberships. Designation policy owns the role and central location scope; explicit person/product-owner/admin overrides are preserved.';

notify pgrst, 'reload schema';

commit;
