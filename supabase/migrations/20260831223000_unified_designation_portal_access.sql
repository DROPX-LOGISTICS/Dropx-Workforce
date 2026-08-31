begin;

-- People Designation Master is the single source of portal eligibility. Each
-- product still owns its role and page-permission matrix.
alter table public.designations
  drop constraint if exists designations_portal_scopes_check;

alter table public.designations
  add constraint designations_portal_scopes_check
  check (
    cardinality(portal_scopes) > 0
    and portal_scopes <@ array[
      'operations', 'people', 'workforce', 'recruit', 'finance', 'tech'
    ]::text[]
  );

alter table public.designations
  add column if not exists workspace_account_requirement text not null default 'optional';

alter table public.designations
  drop constraint if exists designations_workspace_account_requirement_check;

alter table public.designations
  add constraint designations_workspace_account_requirement_check
  check (workspace_account_requirement in ('required','optional','not_required'));

create table if not exists public.designation_product_access_policies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  designation_id uuid not null references public.designations(id) on delete cascade,
  product_code text not null,
  default_role_id uuid references public.user_roles(id) on delete set null,
  location_access_mode text not null default 'assignment',
  is_enabled boolean not null default true,
  is_system_default boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint designation_product_access_policy_unique
    unique (company_id, designation_id, product_code),
  constraint designation_product_access_policy_product_check
    check (product_code in ('operations','people','workforce','recruit','finance','tech')),
  constraint designation_product_access_policy_location_check
    check (location_access_mode in ('assignment','reporting_scope','all_locations','none'))
);

create index if not exists designation_product_access_policy_company_idx
  on public.designation_product_access_policies(company_id, product_code, is_enabled);

-- Seed conservative business defaults for People designations. Portal
-- eligibility does not itself expose a menu; the role configured inside that
-- portal remains the permission authority. Finance remains Owner/Finance only.
with classified as (
  select designation.id,
         designation.company_id,
         upper(concat_ws(' ', designation.code, designation.name, department.code, department.name)) as identity_text
  from public.designations designation
  join public.designation_categories category
    on category.id = designation.designation_category_id
   and category.company_id = designation.company_id
   and category.people_module = 'people_hr'
  left join public.hr_designation_mappings mapping
    on mapping.company_id = designation.company_id
   and mapping.designation_id = designation.id
  left join public.hr_departments department
    on department.company_id = mapping.company_id
   and department.id = mapping.department_id
)
update public.designations designation
set portal_scopes = case
      when classified.identity_text ~ '(OWNER|MANAGING PARTNER)'
        then array['people','operations','workforce','recruit','finance','tech']::text[]
      when classified.identity_text ~ '(FINANCE|ACCOUNT|ACCOUNTS|ACCOUNTANT)'
        then array['people','finance']::text[]
      when classified.identity_text ~ '(FULL STACK|DEVELOPER|ENGINEER|TECHNOLOGY| TECH)'
        then array['people','operations','workforce','recruit','tech']::text[]
      when classified.identity_text ~ '(NATIONAL HEAD|BUSINESS HEAD)'
        then array['people','operations','workforce','recruit']::text[]
      when classified.identity_text ~ '(HR |HUMAN RESOURCE|TALENT ACQUISITION|RECRUIT|PAYROLL)'
        then array['people','recruit']::text[]
      when classified.identity_text ~ '(WORKFORCE)'
        then array['people','workforce']::text[]
      when classified.identity_text ~ '(OPERATIONS|CLUSTER MANAGER|REGIONAL MANAGER|AREA OPERATIONS|PROGRAM MANAGER)'
        then array['people','operations','workforce']::text[]
      else array['people']::text[]
    end,
    updated_at = now()
from classified
where designation.id = classified.id;

insert into public.designation_product_access_policies (
  company_id, designation_id, product_code, default_role_id,
  location_access_mode, is_enabled, is_system_default
)
select designation.company_id,
       designation.id,
       product.product_code,
       coalesce(exact_role.id, owner_role.id),
       case
         when normalized.identity_text ~ '(OWNER|MANAGING PARTNER)'
           then 'all_locations'
         else 'assignment'
       end,
       true,
       true
from public.designations designation
join public.designation_categories category
  on category.id = designation.designation_category_id
 and category.company_id = designation.company_id
 and category.people_module = 'people_hr'
left join public.hr_designation_mappings mapping
  on mapping.company_id = designation.company_id
 and mapping.designation_id = designation.id
left join public.hr_departments department
  on department.company_id = mapping.company_id
 and department.id = mapping.department_id
cross join lateral unnest(designation.portal_scopes) product(product_code)
cross join lateral (
  select upper(concat_ws(' ', designation.code, designation.name, department.code, department.name)) as identity_text,
         regexp_replace(upper(designation.code), '[^A-Z0-9]+', '_', 'g') as designation_code
) normalized
left join lateral (
  select role.id
  from public.user_roles role
  where role.company_id = designation.company_id
    and role.is_active
    and role.product_code = product.product_code
    and upper(role.code) in (
      upper(product.product_code) || '_' || normalized.designation_code,
      normalized.designation_code
    )
  order by case when upper(role.code) = upper(product.product_code) || '_' || normalized.designation_code then 0 else 1 end
  limit 1
) exact_role on true
left join lateral (
  select role.id
  from public.user_roles role
  where normalized.identity_text ~ '(OWNER|MANAGING PARTNER)'
    and role.company_id = designation.company_id
    and role.is_active
    and role.product_code = product.product_code
    and upper(role.code) = upper(product.product_code) || '_OWNER'
  limit 1
) owner_role on true
on conflict (company_id, designation_id, product_code) do nothing;

alter table public.company_product_memberships
  add column if not exists designation_id uuid references public.designations(id) on delete set null,
  add column if not exists designation_policy_id uuid references public.designation_product_access_policies(id) on delete set null;

alter table public.company_product_memberships
  drop constraint if exists company_product_memberships_source_check;

alter table public.company_product_memberships
  add constraint company_product_memberships_source_check
  check (source_system in (
    'manual','product_owner','product_admin','legacy_dashboard','people_hr',
    'recruit','google_workspace','designation_policy','person_override'
  ));

create index if not exists company_product_memberships_designation_idx
  on public.company_product_memberships(company_id, designation_id, product_code)
  where designation_id is not null;

-- A person's managed-location scope is employment data, so it exists before a
-- Workspace account is provisioned and survives an email rename. Portal
-- memberships consume this scope; they do not own it.
create table if not exists public.people_person_access_scopes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  person_id uuid not null references public.hr_people(id) on delete cascade,
  location_scope_ids uuid[] not null default '{}',
  has_all_location_access boolean not null default false,
  workspace_identity_override text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, person_id),
  constraint people_person_access_scope_workspace_override_check
    check (workspace_identity_override is null or workspace_identity_override in ('required','not_required'))
);

create index if not exists people_person_access_scope_company_idx
  on public.people_person_access_scopes(company_id, person_id);

-- Dashboard remains the owner of the station record itself. Ops defines the
-- reusable responsibility/escalation slots; People assigns current occupants
-- with effective-dated history. No designation name or hierarchy is hardcoded.
create table if not exists public.station_responsibility_roles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  escalation_order integer not null default 100,
  owning_product_code text not null default 'operations',
  routes_approvals boolean not null default false,
  contact_email_mode text not null default 'workspace_account',
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  constraint station_responsibility_role_product_check
    check (owning_product_code in ('operations','people','workforce','recruit','finance','tech')),
  constraint station_responsibility_role_email_mode_check
    check (contact_email_mode in ('station_account','workspace_account','none')),
  constraint station_responsibility_role_order_check check (escalation_order between 1 and 10000)
);

-- This table already exists in production with the legacy responsibility code
-- and assignee email. Evolve it in place so that history survives the cutover.
alter table public.station_responsibility_assignments
  drop constraint if exists station_responsibility_code_check;

alter table public.station_responsibility_assignments
  alter column assignee_email drop not null,
  add column if not exists responsibility_role_id uuid references public.station_responsibility_roles(id) on delete restrict,
  add column if not exists assignment_id uuid references public.hr_work_assignments(id) on delete restrict,
  add column if not exists business_line text,
  add column if not exists is_primary boolean not null default true,
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.station_responsibility_assignments
  drop constraint if exists station_responsibility_assignment_business_line_check;

alter table public.station_responsibility_assignments
  add constraint station_responsibility_assignment_business_line_check
  check (business_line is null or business_line in ('q_commerce','edsp','corporate','other'));

-- Convert every legacy responsibility code into an editable Operations-owned
-- role. The data drives the role names; designation or hierarchy names are not
-- embedded in application code.
insert into public.station_responsibility_roles (
  company_id, code, name, escalation_order, owning_product_code, routes_approvals,
  contact_email_mode, is_active
)
select legacy.company_id,
       legacy.responsibility_code,
       initcap(replace(legacy.responsibility_code, '_', ' ')),
       row_number() over (partition by legacy.company_id order by legacy.responsibility_code) * 100,
       'operations', false,
       case when legacy.uses_station_account then 'station_account' else 'workspace_account' end,
       true
from (
  select responsibility.company_id,
         responsibility.responsibility_code,
         bool_or(
           station.station_email is not null
           and responsibility.assignee_email is not null
           and lower(station.station_email) = lower(responsibility.assignee_email)
         ) as uses_station_account
  from public.station_responsibility_assignments responsibility
  join public.stations station
    on station.company_id = responsibility.company_id
   and station.id = responsibility.station_id
  where nullif(trim(responsibility.responsibility_code), '') is not null
  group by responsibility.company_id, responsibility.responsibility_code
) legacy
on conflict (company_id, code) do nothing;

update public.station_responsibility_assignments responsibility
set responsibility_role_id = role.id
from public.station_responsibility_roles role
where responsibility.responsibility_role_id is null
  and role.company_id = responsibility.company_id
  and role.code = responsibility.responsibility_code;

with mapped as (
  select distinct on (responsibility.id)
         responsibility.id,
         assignment.id as assignment_id,
         assignment.business_line
  from public.station_responsibility_assignments responsibility
  join public.profiles profile
    on profile.company_id = responsibility.company_id
   and (
     profile.id = responsibility.assignee_user_id
     or (
       responsibility.assignee_email is not null
       and lower(profile.email) = lower(responsibility.assignee_email)
     )
   )
  join public.hr_user_person_links person_link
    on person_link.company_id = profile.company_id
   and person_link.user_id = profile.id
   and person_link.status = 'active'
  join public.hr_engagements engagement
    on engagement.company_id = person_link.company_id
   and engagement.person_id = person_link.person_id
   and engagement.status = 'active'
  join public.hr_work_assignments assignment
    on assignment.company_id = engagement.company_id
   and assignment.engagement_id = engagement.id
   and assignment.is_primary
   and assignment.effective_from <= current_date
   and (assignment.effective_to is null or assignment.effective_to >= current_date)
  order by responsibility.id, assignment.effective_from desc, assignment.created_at desc
)
update public.station_responsibility_assignments responsibility
set assignment_id = mapped.assignment_id,
    business_line = mapped.business_line,
    updated_at = now()
from mapped
where responsibility.id = mapped.id
  and responsibility.assignment_id is null;

create unique index if not exists station_responsibility_current_primary_unique
  on public.station_responsibility_assignments(company_id, station_id, responsibility_role_id)
  where responsibility_role_id is not null and is_primary and effective_to is null;

create index if not exists station_responsibility_assignment_person_idx
  on public.station_responsibility_assignments(company_id, assignment_id, effective_to);

create or replace function public.assign_station_responsibility(
  p_company_id uuid,
  p_station_id uuid,
  p_responsibility_role_id uuid,
  p_assignment_id uuid,
  p_effective_from date,
  p_actor_user_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
  assignment_business_line text;
  role_code text;
  role_email_mode text;
  assignee_user_id uuid;
  assignee_email text;
begin
  if p_effective_from is null then raise exception 'Choose an effective date.'; end if;
  if not exists (select 1 from public.stations where company_id = p_company_id and id = p_station_id and is_active) then
    raise exception 'Select an active station.';
  end if;
  select role.code, role.contact_email_mode into role_code, role_email_mode
  from public.station_responsibility_roles role
  where role.company_id = p_company_id
    and role.id = p_responsibility_role_id
    and role.is_active;
  if role_code is null then raise exception 'Select an active station responsibility.'; end if;
  select assignment.business_line into assignment_business_line
    from public.hr_work_assignments assignment
    join public.hr_engagements engagement on engagement.company_id = assignment.company_id and engagement.id = assignment.engagement_id and engagement.status = 'active'
    where assignment.company_id = p_company_id and assignment.id = p_assignment_id and assignment.is_primary
      and assignment.effective_from <= p_effective_from
      and (assignment.effective_to is null or assignment.effective_to >= p_effective_from);
  if assignment_business_line is null then raise exception 'Select a current People assignment.'; end if;

  select person_link.user_id, profile.email
  into assignee_user_id, assignee_email
  from public.hr_work_assignments assignment
  join public.hr_engagements engagement
    on engagement.company_id = assignment.company_id
   and engagement.id = assignment.engagement_id
  left join public.hr_user_person_links person_link
    on person_link.company_id = engagement.company_id
   and person_link.person_id = engagement.person_id
   and person_link.status = 'active'
  left join public.profiles profile
    on profile.company_id = person_link.company_id
   and profile.id = person_link.user_id
  where assignment.company_id = p_company_id
    and assignment.id = p_assignment_id
  order by person_link.updated_at desc nulls last, person_link.created_at desc
  limit 1;

  if role_email_mode = 'station_account' then
    select station.station_email into assignee_email
    from public.stations station
    where station.company_id = p_company_id and station.id = p_station_id;
    if nullif(trim(assignee_email), '') is null then
      raise exception 'This responsibility uses the station account, but the station has no DropX Workspace email.';
    end if;
  elsif role_email_mode = 'workspace_account' and nullif(trim(assignee_email), '') is null then
    raise exception 'The selected person needs an active DropX Workspace identity for this responsibility.';
  end if;

  update public.station_responsibility_assignments responsibility
  set effective_to = greatest(responsibility.effective_from, p_effective_from - 1),
      updated_by = p_actor_user_id,
      updated_at = now()
  where responsibility.company_id = p_company_id
    and responsibility.station_id = p_station_id
    and (
      responsibility.responsibility_role_id = p_responsibility_role_id
      or responsibility.responsibility_code = role_code
    )
    and responsibility.is_primary
    and responsibility.effective_to is null;

  insert into public.station_responsibility_assignments (
    company_id, station_id, responsibility_code, assignee_user_id, assignee_email,
    responsibility_role_id, assignment_id, business_line,
    is_primary, effective_from, assigned_by, created_by, updated_by
  ) values (
    p_company_id, p_station_id, role_code, assignee_user_id, assignee_email,
    p_responsibility_role_id, p_assignment_id, assignment_business_line,
    true, p_effective_from, p_actor_user_id, p_actor_user_id, p_actor_user_id
  ) returning id into saved_id;
  return saved_id;
end;
$$;

revoke all on function public.assign_station_responsibility(uuid,uuid,uuid,uuid,date,uuid)
  from public, anon, authenticated;
grant execute on function public.assign_station_responsibility(uuid,uuid,uuid,uuid,date,uuid)
  to service_role;

alter table public.hr_worker_transition_plans
  add column if not exists managed_location_ids uuid[] not null default '{}',
  add column if not exists station_responsibility_count integer not null default 0,
  add column if not exists pending_approval_count integer not null default 0,
  add column if not exists handover_result jsonb not null default '{}'::jsonb;

-- This view intentionally resolves both employees and People-classified
-- independent contractors through the canonical People identity graph.
create or replace view public.people_portal_access_candidates
with (security_invoker = true)
as
select distinct on (profile.company_id, profile.id)
  profile.company_id,
  profile.id as user_id,
  profile.email,
  profile.full_name,
  person_link.person_id,
  engagement.worker_type,
  engagement.employee_id,
  engagement.contractor_id,
  assignment.designation_id,
  assignment.org_unit_id,
  coalesce(person_scope.location_scope_ids, profile.location_scope_ids, '{}'::uuid[]) as location_scope_ids,
  coalesce(person_scope.has_all_location_access, false) as has_all_location_access,
  coalesce(person_scope.workspace_identity_override, designation.workspace_account_requirement) as workspace_account_requirement,
  profile.is_active
from public.profiles profile
join public.hr_user_person_links person_link
  on person_link.company_id = profile.company_id
 and person_link.user_id = profile.id
 and person_link.status = 'active'
join public.hr_engagements engagement
  on engagement.company_id = person_link.company_id
 and engagement.person_id = person_link.person_id
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
left join public.people_person_access_scopes person_scope
  on person_scope.company_id = person_link.company_id
 and person_scope.person_id = person_link.person_id
where profile.is_active
order by profile.company_id, profile.id, assignment.effective_from desc, assignment.created_at desc;

comment on view public.people_portal_access_candidates is
  'Canonical active People identities and their current designation for product-access reconciliation.';

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
    join public.designation_categories category on category.id = designation.designation_category_id
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
      when policy.location_access_mode in ('all_locations','none') or candidate.has_all_location_access then '{}'::uuid[]
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
    role_id = coalesce(public.company_product_memberships.role_id, excluded.role_id),
    role_code_snapshot = coalesce(public.company_product_memberships.role_code_snapshot, excluded.role_code_snapshot),
    designation_id = excluded.designation_id,
    designation_policy_id = excluded.designation_policy_id,
    has_all_location_access = case
      when public.company_product_memberships.source_system in ('manual','product_owner','product_admin')
        then public.company_product_memberships.has_all_location_access
      else excluded.has_all_location_access
    end,
    location_scope_ids = case
      when public.company_product_memberships.source_system in ('manual','product_owner','product_admin')
        then public.company_product_memberships.location_scope_ids
      else excluded.location_scope_ids
    end,
    is_active = true,
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

-- Preserve every existing Recruit login during the cutover. Future grants are
-- designation-policy driven, while these rows remain explicit person overrides
-- until HR links the login to a current People identity.
insert into public.company_product_memberships (
  company_id, product_code, user_id, role_id, role_code_snapshot,
  source_system, has_all_location_access, location_scope_ids,
  is_active, updated_at
)
select access.company_id,
       'recruit',
       access.profile_id,
       profile.role_id,
       role.code,
       'person_override',
       coalesce(access.can_access_all_locations, false),
       case
         when coalesce(access.can_access_all_locations, false) then '{}'::uuid[]
         else coalesce(profile.location_scope_ids, '{}'::uuid[])
       end,
       access.is_active,
       now()
from public.recruitment_user_access access
join public.profiles profile
  on profile.company_id = access.company_id
 and profile.id = access.profile_id
left join public.user_roles role
  on role.company_id = profile.company_id
 and role.id = profile.role_id
on conflict (company_id, product_code, user_id) do update
set is_active = excluded.is_active,
    updated_at = now();

-- Materialise the designation defaults now, not only after the next HR edit.
do $$
declare
  item record;
begin
  for item in
    select distinct company_id, designation_id
    from public.designation_product_access_policies
    where is_enabled
  loop
    perform public.reconcile_designation_product_memberships(
      item.company_id, item.designation_id, null
    );
  end loop;
end
$$;

-- Exit closure calls this before access revocation. It atomically transfers
-- station responsibility and every still-open user-specific approval pointer
-- to the selected successor without changing request state or decision history.
create or replace function public.complete_people_access_handover(
  p_company_id uuid,
  p_departing_person_id uuid,
  p_successor_assignment_id uuid,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  successor_person_id uuid;
  successor_user_id uuid;
  successor_email text;
  departing_user_ids uuid[] := '{}'::uuid[];
  departing_location_ids uuid[] := '{}'::uuid[];
  departing_has_all boolean := false;
  affected integer := 0;
  approval_total integer := 0;
  responsibility_total integer := 0;
  result jsonb := '{}'::jsonb;
begin
  select engagement.person_id
  into successor_person_id
  from public.hr_work_assignments assignment
  join public.hr_engagements engagement
    on engagement.company_id = assignment.company_id
   and engagement.id = assignment.engagement_id
   and engagement.status = 'active'
  where assignment.company_id = p_company_id
    and assignment.id = p_successor_assignment_id
    and assignment.is_primary
    and assignment.effective_from <= current_date
    and (assignment.effective_to is null or assignment.effective_to >= current_date);

  if successor_person_id is null or successor_person_id = p_departing_person_id then
    raise exception 'Select a valid active successor.';
  end if;

  select link.user_id, profile.email
  into successor_user_id, successor_email
  from public.hr_user_person_links link
  join public.profiles profile
    on profile.company_id = link.company_id
   and profile.id = link.user_id
   and profile.is_active
  where link.company_id = p_company_id
    and link.person_id = successor_person_id
    and link.status = 'active'
  order by link.updated_at desc nulls last, link.created_at desc
  limit 1;

  if successor_user_id is null then
    raise exception 'The selected successor needs an active DropX Workspace identity before handover.';
  end if;

  select coalesce(array_agg(link.user_id), '{}'::uuid[])
  into departing_user_ids
  from public.hr_user_person_links link
  where link.company_id = p_company_id
    and link.person_id = p_departing_person_id;

  select coalesce(scope.location_scope_ids, profile_scope.location_scope_ids, '{}'::uuid[]),
         coalesce(scope.has_all_location_access, false)
  into departing_location_ids, departing_has_all
  from (select 1) seed
  left join public.people_person_access_scopes scope
    on scope.company_id = p_company_id
   and scope.person_id = p_departing_person_id
  left join lateral (
    select profile.location_scope_ids
    from public.profiles profile
    join public.hr_user_person_links link
      on link.company_id = profile.company_id
     and link.user_id = profile.id
    where link.company_id = p_company_id
      and link.person_id = p_departing_person_id
    order by profile.updated_at desc nulls last
    limit 1
  ) profile_scope on true;

  insert into public.people_person_access_scopes (
    company_id, person_id, location_scope_ids, has_all_location_access,
    created_by, updated_by
  )
  values (
    p_company_id, successor_person_id, departing_location_ids,
    departing_has_all, p_actor_user_id, p_actor_user_id
  )
  on conflict (company_id, person_id) do update
  set location_scope_ids = case
        when public.people_person_access_scopes.has_all_location_access or excluded.has_all_location_access
          then '{}'::uuid[]
        else array(
          select distinct location_id
          from unnest(public.people_person_access_scopes.location_scope_ids || excluded.location_scope_ids) location_id
          order by location_id
        )
      end,
      has_all_location_access = public.people_person_access_scopes.has_all_location_access or excluded.has_all_location_access,
      updated_by = p_actor_user_id,
      updated_at = now();

  update public.profiles profile
  set location_scope_ids = case
        when departing_has_all then '{}'::uuid[]
        else array(
          select distinct location_id
          from unnest(coalesce(profile.location_scope_ids, '{}'::uuid[]) || departing_location_ids) location_id
          order by location_id
        )
      end,
      updated_at = now()
  where profile.company_id = p_company_id
    and profile.id = successor_user_id;

  update public.company_product_memberships membership
  set has_all_location_access = membership.has_all_location_access or departing_has_all,
      location_scope_ids = case
        when membership.has_all_location_access or departing_has_all then '{}'::uuid[]
        else array(
          select distinct location_id
          from unnest(coalesce(membership.location_scope_ids, '{}'::uuid[]) || departing_location_ids) location_id
          order by location_id
        )
      end,
      updated_at = now()
  where membership.company_id = p_company_id
    and membership.user_id = successor_user_id
    and membership.is_active;

  -- Preserve responsibility history while moving the active station slots.
  with departing_assignments as (
    select assignment.id
    from public.hr_engagements engagement
    join public.hr_work_assignments assignment
      on assignment.company_id = engagement.company_id
     and assignment.engagement_id = engagement.id
     and assignment.is_primary
    where engagement.company_id = p_company_id
      and engagement.person_id = p_departing_person_id
  ), closed as (
    update public.station_responsibility_assignments responsibility
    set effective_to = greatest(responsibility.effective_from, current_date - 1),
        updated_by = p_actor_user_id,
        updated_at = now()
    where responsibility.company_id = p_company_id
      and responsibility.assignment_id in (select id from departing_assignments)
      and responsibility.effective_to is null
    returning responsibility.station_id, responsibility.responsibility_code,
              responsibility.responsibility_role_id, responsibility.is_primary
  )
  insert into public.station_responsibility_assignments (
    company_id, station_id, responsibility_code, assignee_user_id, assignee_email,
    responsibility_role_id, assignment_id, business_line,
    is_primary, effective_from, assigned_by, created_by, updated_by
  )
  select p_company_id, station_id, responsibility_code, successor_user_id, successor_email,
         responsibility_role_id,
         p_successor_assignment_id,
         (select business_line from public.hr_work_assignments where id = p_successor_assignment_id),
         is_primary, current_date,
         p_actor_user_id, p_actor_user_id, p_actor_user_id
  from closed
  on conflict (company_id, station_id, responsibility_role_id)
    where responsibility_role_id is not null and is_primary and effective_to is null
  do update set responsibility_code = excluded.responsibility_code,
                assignee_user_id = excluded.assignee_user_id,
                assignee_email = excluded.assignee_email,
                assignment_id = excluded.assignment_id,
                business_line = excluded.business_line,
                effective_from = excluded.effective_from,
                assigned_by = p_actor_user_id,
                updated_by = p_actor_user_id,
                updated_at = now();
  get diagnostics responsibility_total = row_count;

  if cardinality(departing_user_ids) > 0 then
    if to_regclass('public.payment_requests') is not null then
      execute 'update public.payment_requests set current_approver_user_id = $1, updated_at = now() where company_id = $2 and current_approver_user_id = any($3)'
        using successor_user_id, p_company_id, departing_user_ids;
      get diagnostics affected = row_count;
      approval_total := approval_total + affected;
      result := result || jsonb_build_object('payment_requests', affected);
    end if;

    if to_regclass('public.payment_request_approvals') is not null then
      execute 'update public.payment_request_approvals set approver_user_id = $1 where company_id = $2 and approver_user_id = any($3) and upper(coalesce(status, '''')) = ''PENDING'''
        using successor_user_id, p_company_id, departing_user_ids;
      get diagnostics affected = row_count;
      approval_total := approval_total + affected;
      result := result || jsonb_build_object('payment_request_approvals', affected);
    end if;

    if to_regclass('public.hr_leave_approval_steps') is not null then
      execute 'update public.hr_leave_approval_steps set approver_user_id = $1, approver_person_id = $2, updated_at = now() where company_id = $3 and approver_user_id = any($4) and status in (''queued'',''pending'')'
        using successor_user_id, successor_person_id, p_company_id, departing_user_ids;
      get diagnostics affected = row_count;
      approval_total := approval_total + affected;
      result := result || jsonb_build_object('leave_approvals', affected);
    end if;

    if to_regclass('public.hr_expense_approval_steps') is not null then
      execute 'update public.hr_expense_approval_steps set approver_user_id = $1, approver_person_id = $2, updated_at = now() where company_id = $3 and approver_user_id = any($4) and status in (''pending'',''waiting'')'
        using successor_user_id, successor_person_id, p_company_id, departing_user_ids;
      get diagnostics affected = row_count;
      approval_total := approval_total + affected;
      result := result || jsonb_build_object('expense_approvals', affected);
    end if;

    if to_regclass('public.hr_wfh_approval_steps') is not null then
      execute 'update public.hr_wfh_approval_steps set approver_user_id = $1, approver_person_id = $2, updated_at = now() where company_id = $3 and approver_user_id = any($4) and status in (''queued'',''pending'')'
        using successor_user_id, successor_person_id, p_company_id, departing_user_ids;
      get diagnostics affected = row_count;
      approval_total := approval_total + affected;
      result := result || jsonb_build_object('wfh_approvals', affected);
    end if;

    if to_regclass('public.attendance_regularization_approval_steps') is not null then
      execute 'update public.attendance_regularization_approval_steps set approver_user_id = $1, approver_person_id = $2, updated_at = now() where company_id = $3 and approver_user_id = any($4) and status in (''queued'',''pending'')'
        using successor_user_id, successor_person_id, p_company_id, departing_user_ids;
      get diagnostics affected = row_count;
      approval_total := approval_total + affected;
      result := result || jsonb_build_object('attendance_approvals', affected);
    end if;

    if to_regclass('public.attendance_location_review_approval_steps') is not null then
      execute 'update public.attendance_location_review_approval_steps set approver_user_id = $1, approver_person_id = $2, updated_at = now() where company_id = $3 and approver_user_id = any($4) and status in (''queued'',''pending'')'
        using successor_user_id, successor_person_id, p_company_id, departing_user_ids;
      get diagnostics affected = row_count;
      approval_total := approval_total + affected;
      result := result || jsonb_build_object('location_review_approvals', affected);
    end if;

    if to_regclass('public.hr_roster_approval_steps') is not null then
      execute 'update public.hr_roster_approval_steps set approver_user_id = $1, updated_at = now() where company_id = $2 and approver_user_id = any($3) and status in (''pending'',''waiting'')'
        using successor_user_id, p_company_id, departing_user_ids;
      get diagnostics affected = row_count;
      approval_total := approval_total + affected;
      result := result || jsonb_build_object('roster_approvals', affected);
    end if;

    if to_regclass('public.hr_exit_approvals') is not null then
      execute 'update public.hr_exit_approvals set assigned_user_id = $1, updated_at = now() where company_id = $2 and assigned_user_id = any($3) and status = ''pending'''
        using successor_user_id, p_company_id, departing_user_ids;
      get diagnostics affected = row_count;
      approval_total := approval_total + affected;
      result := result || jsonb_build_object('exit_approvals', affected);
    end if;

    if to_regclass('public.hr_exit_tasks') is not null then
      execute 'update public.hr_exit_tasks set owner_user_id = $1, updated_at = now() where company_id = $2 and owner_user_id = any($3) and status in (''pending'',''in_progress'')'
        using successor_user_id, p_company_id, departing_user_ids;
      get diagnostics affected = row_count;
      approval_total := approval_total + affected;
      result := result || jsonb_build_object('exit_tasks', affected);
    end if;
  end if;

  return result || jsonb_build_object(
    'departing_person_id', p_departing_person_id,
    'successor_person_id', successor_person_id,
    'successor_user_id', successor_user_id,
    'locations_transferred', cardinality(departing_location_ids),
    'all_locations_transferred', departing_has_all,
    'station_responsibilities_transferred', responsibility_total,
    'open_approvals_transferred', approval_total
  );
end;
$$;

revoke all on function public.complete_people_access_handover(uuid,uuid,uuid,uuid)
  from public, anon, authenticated;

grant execute on function public.complete_people_access_handover(uuid,uuid,uuid,uuid)
  to service_role;

-- Keep a Workspace designation policy in sync with the portal checkboxes while
-- retaining Google-specific settings such as OU, groups and approval mode.
create or replace function public.sync_workspace_policy_product_codes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  policy_company_id uuid;
  policy_designation_id uuid;
  policy_actor_id uuid;
begin
  if tg_op = 'DELETE' then
    policy_company_id := old.company_id;
    policy_designation_id := old.designation_id;
    policy_actor_id := old.updated_by;
  else
    policy_company_id := new.company_id;
    policy_designation_id := new.designation_id;
    policy_actor_id := new.updated_by;
  end if;

  update public.google_workspace_designation_policies workspace_policy
  set product_codes = coalesce((
        select array_agg(policy.product_code order by policy.product_code)
        from public.designation_product_access_policies policy
        where policy.company_id = policy_company_id
          and policy.designation_id = policy_designation_id
          and policy.is_enabled
      ), '{}'::text[]),
      updated_by = policy_actor_id,
      updated_at = now()
  where workspace_policy.company_id = policy_company_id
    and workspace_policy.designation_id = policy_designation_id;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists designation_product_access_sync_workspace
  on public.designation_product_access_policies;
create trigger designation_product_access_sync_workspace
after insert or update or delete
on public.designation_product_access_policies
for each row execute function public.sync_workspace_policy_product_codes();

alter table public.designation_product_access_policies enable row level security;
alter table public.people_person_access_scopes enable row level security;
alter table public.station_responsibility_roles enable row level security;
alter table public.station_responsibility_assignments enable row level security;

drop policy if exists designation_product_access_service_role
  on public.designation_product_access_policies;
create policy designation_product_access_service_role
  on public.designation_product_access_policies
  for all to service_role
  using (true) with check (true);

drop policy if exists people_person_access_scope_service_role
  on public.people_person_access_scopes;
create policy people_person_access_scope_service_role
  on public.people_person_access_scopes
  for all to service_role
  using (true) with check (true);

drop policy if exists station_responsibility_roles_service_role
  on public.station_responsibility_roles;
create policy station_responsibility_roles_service_role
  on public.station_responsibility_roles
  for all to service_role using (true) with check (true);

drop policy if exists station_responsibility_assignments_service_role
  on public.station_responsibility_assignments;
create policy station_responsibility_assignments_service_role
  on public.station_responsibility_assignments
  for all to service_role using (true) with check (true);

grant select on public.designation_product_access_policies to authenticated;
grant select on public.people_person_access_scopes to authenticated;
grant select on public.station_responsibility_roles to authenticated;
grant select on public.station_responsibility_assignments to authenticated;
grant select on public.people_portal_access_candidates to service_role;

notify pgrst, 'reload schema';
commit;
