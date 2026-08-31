-- Close the final live People reporting gap without coupling the relationship
-- to the employee or contractor source table. The canonical person engagement
-- and current assignment remain authoritative.
do $$
declare
  v_company_id uuid;
  v_subject_assignment_id uuid;
  v_manager_assignment_id uuid;
  v_effective_from date := timezone('Asia/Kolkata', now())::date;
begin
  select company.id
  into v_company_id
  from public.companies company
  where upper(trim(company.name)) = 'DROPX LOGISTICS'
  order by company.created_at
  limit 1;

  if v_company_id is null then
    raise exception 'DropX Logistics company was not found.';
  end if;

  select assignment.id
  into v_subject_assignment_id
  from public.hr_people person
  join public.hr_engagements engagement
    on engagement.company_id = person.company_id
   and engagement.person_id = person.id
   and engagement.status = 'active'
  join public.hr_work_assignments assignment
    on assignment.company_id = engagement.company_id
   and assignment.engagement_id = engagement.id
   and assignment.is_primary
   and assignment.effective_from <= v_effective_from
   and (assignment.effective_to is null or assignment.effective_to >= v_effective_from)
  where person.company_id = v_company_id
    and person.status = 'active'
    and upper(trim(person.display_name)) = 'MUHAMMED AFSAR PP'
  order by assignment.effective_from desc, assignment.updated_at desc
  limit 1;

  select assignment.id
  into v_manager_assignment_id
  from public.hr_people person
  join public.hr_engagements engagement
    on engagement.company_id = person.company_id
   and engagement.person_id = person.id
   and engagement.status = 'active'
  join public.hr_work_assignments assignment
    on assignment.company_id = engagement.company_id
   and assignment.engagement_id = engagement.id
   and assignment.is_primary
   and assignment.effective_from <= v_effective_from
   and (assignment.effective_to is null or assignment.effective_to >= v_effective_from)
  where person.company_id = v_company_id
    and person.status = 'active'
    and upper(trim(person.display_name)) = 'NISAR AHAMMED NOTTATH'
  order by assignment.effective_from desc, assignment.updated_at desc
  limit 1;

  if v_subject_assignment_id is null or v_manager_assignment_id is null then
    raise exception 'Active Afsar or Nisar People assignment was not found.';
  end if;

  if exists (
    select 1
    from public.hr_reporting_relationships relationship
    where relationship.company_id = v_company_id
      and relationship.subject_assignment_id = v_subject_assignment_id
      and relationship.manager_assignment_id = v_manager_assignment_id
      and relationship.relationship_type = 'solid_line'
      and relationship.is_primary
      and relationship.effective_from <= v_effective_from
      and (relationship.effective_to is null or relationship.effective_to >= v_effective_from)
  ) then
    update public.hr_work_assignments
    set is_top_level = false,
        updated_at = now()
    where company_id = v_company_id
      and id = v_subject_assignment_id;
    return;
  end if;

  delete from public.hr_reporting_relationships relationship
  where relationship.company_id = v_company_id
    and relationship.subject_assignment_id = v_subject_assignment_id
    and relationship.relationship_type = 'solid_line'
    and relationship.is_primary
    and relationship.effective_from >= v_effective_from;

  update public.hr_reporting_relationships relationship
  set effective_to = v_effective_from - 1,
      updated_at = now()
  where relationship.company_id = v_company_id
    and relationship.subject_assignment_id = v_subject_assignment_id
    and relationship.relationship_type = 'solid_line'
    and relationship.is_primary
    and relationship.effective_from < v_effective_from
    and (relationship.effective_to is null or relationship.effective_to >= v_effective_from);

  update public.hr_work_assignments
  set is_top_level = false,
      updated_at = now()
  where company_id = v_company_id
    and id = v_subject_assignment_id;

  insert into public.hr_reporting_relationships (
    company_id,
    subject_assignment_id,
    manager_assignment_id,
    relationship_type,
    is_primary,
    effective_from
  ) values (
    v_company_id,
    v_subject_assignment_id,
    v_manager_assignment_id,
    'solid_line',
    true,
    v_effective_from
  );
end;
$$;
