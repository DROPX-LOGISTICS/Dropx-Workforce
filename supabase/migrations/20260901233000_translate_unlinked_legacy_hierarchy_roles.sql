begin;

-- A profile without a People person cannot inherit a designation. Preserve
-- such explicit/manual accounts and their station scope, but translate the
-- three retired hierarchy aliases to the matching current People role. This
-- is a compatibility exception, not a new source of designation access.
create temporary table _unlinked_hierarchy_role_map on commit drop as
select distinct on (legacy.company_id, legacy.id)
  legacy.company_id,
  legacy.id as old_role_id,
  canonical.id as new_role_id,
  canonical.code as new_role_code
from (values
  ('CLUSTER_HEAD','CLM',10),
  ('REGIONAL_HEAD','RM',20),
  ('ZONAL_HEAD','BH',30)
) alias(legacy_code, designation_code, priority)
join public.user_roles legacy
  on regexp_replace(upper(legacy.code), '^(OPERATIONS|FINANCE|WORKFORCE|PEOPLE|RECRUIT)_', '') = alias.legacy_code
join public.designations designation
  on designation.company_id = legacy.company_id
 and upper(designation.code) = alias.designation_code
 and designation.is_active
join public.designation_product_access_policies policy
  on policy.company_id = designation.company_id
 and policy.designation_id = designation.id
 and policy.product_code = 'operations'
 and policy.is_enabled
 and policy.default_role_id is not null
join public.user_roles canonical
  on canonical.company_id = policy.company_id
 and canonical.id = policy.default_role_id
 and canonical.is_active
where legacy.id <> canonical.id
order by legacy.company_id, legacy.id, alias.priority;

create temporary table _unlinked_hierarchy_profiles on commit drop as
select profile.company_id, profile.id as user_id, mapping.old_role_id,
       mapping.new_role_id, mapping.new_role_code
from public.profiles profile
join _unlinked_hierarchy_role_map mapping
  on mapping.company_id = profile.company_id
 and mapping.old_role_id = profile.role_id
where profile.is_active
  and not exists (
    select 1
    from public.people_portal_access_candidates candidate
    where candidate.company_id = profile.company_id
      and candidate.user_id = profile.id
  )
  and not exists (
    select 1
    from public.stations station
    where station.company_id = profile.company_id
      and station.is_active
      and lower(btrim(station.station_email)) = lower(btrim(profile.email))
  );

update public.profiles profile
set role_id = target.new_role_id
from _unlinked_hierarchy_profiles target
where profile.company_id = target.company_id
  and profile.id = target.user_id
  and profile.role_id = target.old_role_id;

update public.company_product_memberships membership
set role_id = target.new_role_id,
    role_code_snapshot = target.new_role_code,
    updated_at = now()
from _unlinked_hierarchy_profiles target
where membership.company_id = target.company_id
  and membership.user_id = target.user_id
  and membership.role_id = target.old_role_id;

notify pgrst, 'reload schema';

commit;
