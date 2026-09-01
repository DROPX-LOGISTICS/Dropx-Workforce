begin;

-- Some long-lived Dashboard identities predate the People identity graph.
-- Their profile still has the exact employee/DropX ID and the working station
-- scope, but without a person link the designation reconciler cannot replace
-- legacy names such as Cluster Head with the current People designation.
-- Link only unambiguous, active, one-to-one ID matches. Existing or conflicting
-- links and station mailbox identities are deliberately left unchanged.
create temporary table _exact_people_identity_links on commit drop as
with source_matches as (
  select
    profile.company_id,
    profile.id as user_id,
    engagement.person_id,
    assignment.designation_id,
    'employee_id'::text as match_source
  from public.profiles profile
  join public.employees employee
    on employee.company_id = profile.company_id
   and employee.deleted_at is null
   and employee.is_active
   and nullif(btrim(profile.employee_id), '') is not null
   and upper(btrim(employee.employee_code)) = upper(btrim(profile.employee_id))
  join public.hr_engagements engagement
    on engagement.company_id = employee.company_id
   and engagement.worker_type = 'employee'
   and engagement.employee_id = employee.id
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
  where profile.is_active

  union all

  select
    profile.company_id,
    profile.id as user_id,
    engagement.person_id,
    assignment.designation_id,
    'dropx_id'::text as match_source
  from public.profiles profile
  join public.contractors contractor
    on contractor.company_id = profile.company_id
   and contractor.deleted_at is null
   and contractor.is_active
   and nullif(btrim(profile.employee_id), '') is not null
   and upper(btrim(contractor.dropx_id)) = upper(btrim(profile.employee_id))
  join public.hr_engagements engagement
    on engagement.company_id = contractor.company_id
   and engagement.worker_type = 'contractor'
   and engagement.contractor_id = contractor.id
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
  where profile.is_active
), unique_matches as (
  select source.*,
         count(*) over (partition by source.company_id, source.user_id) as user_matches,
         count(*) over (partition by source.company_id, source.person_id) as person_matches
  from source_matches source
)
select company_id, user_id, person_id, designation_id, match_source
from unique_matches candidate
where candidate.user_matches = 1
  and candidate.person_matches = 1
  and not exists (
    select 1
    from public.stations station
    join public.profiles station_profile
      on station_profile.company_id = station.company_id
     and station_profile.id = candidate.user_id
     and lower(btrim(station_profile.email)) = lower(btrim(station.station_email))
    where station.company_id = candidate.company_id
      and station.is_active
      and nullif(btrim(station.station_email), '') is not null
  )
  and not exists (
    select 1
    from public.hr_user_person_links link
    where link.company_id = candidate.company_id
      and link.status = 'active'
      and (
        (link.user_id = candidate.user_id and link.person_id <> candidate.person_id)
        or (link.person_id = candidate.person_id and link.user_id <> candidate.user_id)
      )
  );

insert into public.hr_user_person_links (
  company_id, user_id, person_id, status, verified_by, verified_at, updated_at
)
select company_id, user_id, person_id, 'active', null, now(), now()
from _exact_people_identity_links
on conflict (company_id, user_id) do update
set status = 'active',
    verified_at = coalesce(public.hr_user_person_links.verified_at, now()),
    updated_at = now()
where public.hr_user_person_links.person_id = excluded.person_id;

-- Keep the synced Google directory row attached to the same canonical person.
update public.google_workspace_accounts workspace
set profile_id = identity.user_id,
    person_id = identity.person_id,
    designation_id = identity.designation_id,
    source_type = 'people_person',
    source_record_id = identity.person_id,
    updated_at = now()
from _exact_people_identity_links identity
join public.profiles profile
  on profile.company_id = identity.company_id
 and profile.id = identity.user_id
where workspace.company_id = identity.company_id
  and lower(btrim(workspace.primary_email)) = lower(btrim(profile.email))
  and lower(coalesce(workspace.account_state, '')) = 'active'
  and not coalesce(workspace.suspended, false)
  and (workspace.person_id is null or workspace.person_id = identity.person_id)
  and (workspace.profile_id is null or workspace.profile_id = identity.user_id);

-- Refresh the exact designation memberships. The reconciler changes legacy
-- designation-managed roles and scopes, while preserving explicit manual,
-- owner, product-admin and person-level exceptions.
do $$
declare
  target record;
begin
  for target in
    select distinct company_id, designation_id
    from _exact_people_identity_links
    order by company_id, designation_id
  loop
    perform public.reconcile_designation_product_memberships(
      target.company_id,
      target.designation_id,
      null
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;
