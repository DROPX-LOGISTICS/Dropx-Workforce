begin;

-- Suspension revokes the worker's operational access but deliberately keeps
-- the canonical person, engagement and reporting relationships active. A
-- suspended (is_active = false) Employee/Contractor source therefore still
-- exists and must not be mistaken for a missing source record.
create or replace function public.sync_people_engagement_projection(
  p_company_id uuid,
  p_engagement_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row record;
  source_exists boolean := false;
begin
  select engagement.person_id,
         engagement.worker_type,
         engagement.employee_id,
         engagement.contractor_id,
         assignment.designation_id,
         assignment.department_id,
         assignment.location_id,
         designation.name as designation_name
  into current_row
  from public.hr_engagements engagement
  join lateral (
    select candidate.designation_id,
           candidate.department_id,
           candidate.location_id
    from public.hr_work_assignments candidate
    where candidate.company_id = engagement.company_id
      and candidate.engagement_id = engagement.id
      and candidate.is_primary
      and candidate.effective_from <= current_date
      and (candidate.effective_to is null or candidate.effective_to >= current_date)
    order by candidate.effective_from desc, candidate.created_at desc
    limit 1
  ) assignment on true
  join public.designations designation
    on designation.company_id = engagement.company_id
   and designation.id = assignment.designation_id
   and designation.is_active
  join public.designation_categories category
    on category.company_id = designation.company_id
   and category.id = designation.designation_category_id
   and category.is_active
   and category.people_module = 'people_hr'
  where engagement.company_id = p_company_id
    and engagement.id = p_engagement_id
    and engagement.status = 'active'
    and (
      'people' = any(coalesce(designation.portal_scopes, '{}'::text[]))
      or (
        cardinality(coalesce(designation.portal_scopes, '{}'::text[])) = 0
        and exists (
          select 1
          from public.hr_designation_mappings mapping
          where mapping.company_id = designation.company_id
            and mapping.designation_id = designation.id
            and mapping.is_available
        )
      )
    );

  if not found then return; end if;

  if current_row.worker_type = 'employee' and current_row.employee_id is not null then
    update public.employees employee
    set designation_id = current_row.designation_id,
        department_id = coalesce(current_row.department_id, employee.department_id),
        location_id = coalesce(current_row.location_id, employee.location_id),
        people_lifecycle_status = case
          when nullif(btrim(coalesce(employee.people_lifecycle_status, '')), '') is null
            then case when employee.is_active then 'active' else 'suspended' end
          else employee.people_lifecycle_status
        end,
        updated_at = now()
    where employee.company_id = p_company_id
      and employee.id = current_row.employee_id
      and employee.deleted_at is null
      and (
        employee.designation_id is distinct from current_row.designation_id
        or (current_row.department_id is not null and employee.department_id is distinct from current_row.department_id)
        or (current_row.location_id is not null and employee.location_id is distinct from current_row.location_id)
        or nullif(btrim(coalesce(employee.people_lifecycle_status, '')), '') is null
      );
    source_exists := exists (
      select 1 from public.employees employee
      where employee.company_id = p_company_id
        and employee.id = current_row.employee_id
        and employee.deleted_at is null
    );
  elsif current_row.worker_type = 'contractor' and current_row.contractor_id is not null then
    update public.contractors contractor
    set designation = current_row.designation_name,
        department_id = coalesce(current_row.department_id, contractor.department_id),
        location_id = coalesce(current_row.location_id, contractor.location_id),
        people_lifecycle_status = case
          when nullif(btrim(coalesce(contractor.people_lifecycle_status, '')), '') is null
            then case when contractor.is_active then 'active' else 'suspended' end
          else contractor.people_lifecycle_status
        end,
        updated_at = now()
    where contractor.company_id = p_company_id
      and contractor.id = current_row.contractor_id
      and contractor.deleted_at is null
      and (
        contractor.designation is distinct from current_row.designation_name
        or (current_row.department_id is not null and contractor.department_id is distinct from current_row.department_id)
        or (current_row.location_id is not null and contractor.location_id is distinct from current_row.location_id)
        or nullif(btrim(coalesce(contractor.people_lifecycle_status, '')), '') is null
      );
    source_exists := exists (
      select 1 from public.contractors contractor
      where contractor.company_id = p_company_id
        and contractor.id = current_row.contractor_id
        and contractor.deleted_at is null
    );
  end if;

  if source_exists then
    update public.hr_people person
    set status = 'active',
        legacy_source_type = current_row.worker_type,
        legacy_source_id = coalesce(current_row.employee_id, current_row.contractor_id),
        updated_at = now()
    where person.company_id = p_company_id
      and person.id = current_row.person_id
      and (
        person.status is distinct from 'active'
        or person.legacy_source_type is distinct from current_row.worker_type
        or person.legacy_source_id is distinct from coalesce(current_row.employee_id, current_row.contractor_id)
      );
  end if;
end;
$$;

revoke all on function public.sync_people_engagement_projection(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.sync_people_engagement_projection(uuid,uuid)
  to service_role;

-- Reconcile projection fields for every active People engagement. Explicit
-- suspended/offboarding states are preserved as-is; attendance, pay, access,
-- assignment and reporting tables are not updated here.
do $$
declare
  item record;
begin
  for item in
    select engagement.company_id, engagement.id
    from public.hr_engagements engagement
    where engagement.status = 'active'
    order by engagement.company_id, engagement.id
  loop
    perform public.sync_people_engagement_projection(item.company_id, item.id);
  end loop;
end
$$;

commit;
