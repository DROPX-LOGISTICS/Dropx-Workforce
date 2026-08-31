begin;

-- People employees and People independent contractors are separate legal
-- engagement sources. This ledger makes every correction explicit and keeps
-- Workforce/Vendor/Helper registrations outside this process entirely.
create table if not exists public.hr_worker_classification_reconciliations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  worker_code text not null,
  from_worker_type text not null,
  to_worker_type text not null,
  source_record_id uuid,
  target_record_id uuid,
  status text not null default 'pending',
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  error_message text,
  requested_by uuid references public.profiles(id) on delete set null,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_worker_classification_direction_check check (
    from_worker_type in ('employee','contractor')
    and to_worker_type in ('employee','contractor')
    and from_worker_type <> to_worker_type
  ),
  constraint hr_worker_classification_status_check check (
    status in ('pending','completed','blocked','cancelled')
  ),
  unique (company_id, worker_code, from_worker_type, to_worker_type)
);

create index if not exists hr_worker_classification_status_idx
  on public.hr_worker_classification_reconciliations(company_id, status, updated_at desc);

-- A legal engagement is selected per person. The later legacy guard that tied
-- every contractor to the designation's single profile_destination would
-- incorrectly force mixed legal engagements back into Employees. Designation
-- controls role and portal policy; it does not control the legal pay source.
drop trigger if exists zz_contractor_guard_designation_destination on public.contractors;

-- A People role can be held under either legal pay source. This is a systemic
-- compatibility normalization, not a designation-name rule, and it never
-- changes a profile row.
update public.designations designation
set onboarding_categories = array(
      select distinct category
      from unnest(
        coalesce(designation.onboarding_categories, '{}'::text[])
        || array['employees','contractors']::text[]
      ) category
      order by category
    ),
    updated_at = now()
from public.designation_categories category
where category.company_id = designation.company_id
  and category.id = designation.designation_category_id
  and category.people_module = 'people_hr';

-- Legal source is a pay/statutory fact, never a designation fact. E-Shram is
-- intentionally excluded: only PF or ESI applicability/identifiers establish
-- an Employee engagement.
create or replace function public.people_expected_worker_type(
  p_statutory_applicability text[],
  p_pf_uan text,
  p_pf_account_no text,
  p_esi_no text
) returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when coalesce(p_statutory_applicability, '{}'::text[]) && array['pf','esi']::text[]
      or nullif(btrim(coalesce(p_pf_uan, '')), '') is not null
      or nullif(btrim(coalesce(p_pf_account_no, '')), '') is not null
      or nullif(btrim(coalesce(p_esi_no, '')), '') is not null
      then 'employee'
    else 'contractor'
  end
$$;

drop view if exists public.people_worker_classification_audit;
create view public.people_worker_classification_audit
with (security_invoker = true)
as
with current_assignments as (
  select distinct on (engagement.company_id, engagement.id)
    engagement.company_id,
    engagement.id as engagement_id,
    engagement.worker_type,
    engagement.employee_id,
    engagement.contractor_id,
    assignment.designation_id,
    designation.name as designation_name
  from public.hr_engagements engagement
  left join public.hr_work_assignments assignment
    on assignment.company_id = engagement.company_id
   and assignment.engagement_id = engagement.id
   and assignment.is_primary
   and assignment.effective_from <= current_date
   and (assignment.effective_to is null or assignment.effective_to >= current_date)
  left join public.designations designation
    on designation.company_id = assignment.company_id
   and designation.id = assignment.designation_id
  where engagement.status = 'active'
  order by engagement.company_id, engagement.id,
           assignment.effective_from desc nulls last, assignment.created_at desc nulls last
), workers as (
  select employee.company_id,
         'employee'::text as worker_type,
         employee.id as worker_id,
         employee.employee_code as worker_code,
         employee.full_name,
         employee.location_id,
         assignment.designation_id,
         assignment.designation_name,
         employee.statutory_applicability,
         employee.pf_uan,
         employee.pf_account_no,
         employee.esi_no,
         public.people_expected_worker_type(
           employee.statutory_applicability,
           employee.pf_uan,
           employee.pf_account_no,
           employee.esi_no
         ) as expected_worker_type,
         exists (
           select 1
           from public.hr_audit_log audit
           where audit.company_id = employee.company_id
             and audit.entity_id = employee.id
             and audit.action in (
               'restore_master_routed_employee_classification',
               'restore_employee_routed_contractor_draft'
             )
         ) as transition_affected,
         exists (
           select 1
           from public.contractors archived
           where archived.company_id = employee.company_id
             and archived.id = employee.id
             and archived.deleted_at is not null
             and archived.deletion_reason in (
               'Restored to employee register from Designation Master routing',
               'Restored to employee register from Designation Master routing.'
             )
         ) as recoverable_counterpart
  from public.employees employee
  left join current_assignments assignment
    on assignment.company_id = employee.company_id
   and assignment.worker_type = 'employee'
   and assignment.employee_id = employee.id
  where employee.deleted_at is null
    and employee.is_active
  union all
  select contractor.company_id,
         'contractor'::text,
         contractor.id,
         contractor.dropx_id,
         contractor.full_name,
         contractor.location_id,
         assignment.designation_id,
         assignment.designation_name,
         contractor.statutory_applicability,
         contractor.pf_uan,
         contractor.pf_account_no,
         contractor.esi_no,
         public.people_expected_worker_type(
           contractor.statutory_applicability,
           contractor.pf_uan,
           contractor.pf_account_no,
           contractor.esi_no
         ) as expected_worker_type,
         false as transition_affected,
         false as recoverable_counterpart
  from public.contractors contractor
  left join current_assignments assignment
    on assignment.company_id = contractor.company_id
   and assignment.worker_type = 'contractor'
   and assignment.contractor_id = contractor.id
  where contractor.deleted_at is null
    and contractor.is_active
)
select worker.*,
       case
         when worker.worker_type <> worker.expected_worker_type then 'wrong_source'
         when worker.designation_id is null then 'missing_assignment'
         else 'aligned'
       end as classification_state,
       reconciliation.id as reconciliation_id,
       reconciliation.status as reconciliation_status,
       reconciliation.error_message as reconciliation_error
from workers worker
left join public.hr_worker_classification_reconciliations reconciliation
  on reconciliation.company_id = worker.company_id
 and upper(reconciliation.worker_code) = upper(worker.worker_code)
 and reconciliation.from_worker_type = worker.worker_type
 and reconciliation.to_worker_type = case when worker.worker_type = 'employee' then 'contractor' else 'employee' end;

create or replace function public.reclassify_people_worker(
  p_company_id uuid,
  p_worker_code text,
  p_target_worker_type text,
  p_actor_user_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_employee public.employees%rowtype;
  source_contractor public.contractors%rowtype;
  source_engagement public.hr_engagements%rowtype;
  source_person_id uuid;
  assignment_designation_id uuid;
  assignment_designation_name text;
  table_item record;
  has_worker_type boolean;
  affected integer := 0;
  moved_references integer := 0;
  restore_archived_target boolean := false;
  sync_assignments text;
  expected_worker_type text;
  normalized_code text := upper(trim(p_worker_code));
  from_type text;
begin
  if p_target_worker_type not in ('employee','contractor') then
    raise exception 'Target type must be Employee or Independent Contractor.';
  end if;
  if normalized_code is null or normalized_code = '' then
    raise exception 'Choose a DropX ID.';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Record the source evidence for this correction.';
  end if;
  if p_actor_user_id is not null and not exists (
    select 1 from public.profiles
    where company_id = p_company_id and id = p_actor_user_id and is_active
  ) then
    raise exception 'The correction user is not active in this company.';
  end if;

  if p_target_worker_type = 'contractor' then
    from_type := 'employee';
    select * into source_employee
    from public.employees
    where company_id = p_company_id
      and deleted_at is null
      and upper(employee_code) = normalized_code
    for update;
    if source_employee.id is null then raise exception 'Active employee % was not found.', normalized_code; end if;
    expected_worker_type := public.people_expected_worker_type(
      source_employee.statutory_applicability,
      source_employee.pf_uan,
      source_employee.pf_account_no,
      source_employee.esi_no
    );
    if expected_worker_type <> 'contractor' then
      raise exception 'Employee % has PF or ESI evidence and cannot be moved to Independent Contractors.', normalized_code;
    end if;
    if exists (
      select 1 from public.contractors
      where company_id = p_company_id and deleted_at is null
        and (id = source_employee.id or upper(dropx_id) = normalized_code)
    ) then
      raise exception 'An active contractor already uses DropX ID %. Merge the duplicate before reclassification.', normalized_code;
    end if;
    if exists (
      select 1 from public.contractors
      where company_id = p_company_id and id <> source_employee.id
        and upper(dropx_id) = normalized_code
    ) then
      raise exception 'An archived contractor already uses DropX ID %. Restore-and-merge review is required.', normalized_code;
    end if;
    select exists (
      select 1
      from public.contractors
      where company_id = p_company_id
        and id = source_employee.id
        and deleted_at is not null
        and deletion_reason in (
          'Restored to employee register from Designation Master routing',
          'Restored to employee register from Designation Master routing.'
        )
    ) into restore_archived_target;

    select engagement.* into source_engagement
    from public.hr_engagements engagement
    where engagement.company_id = p_company_id
      and engagement.worker_type = 'employee'
      and engagement.employee_id = source_employee.id
      and engagement.status = 'active'
    for update;
    if source_engagement.id is null then raise exception 'Employee % has no active canonical People engagement.', normalized_code; end if;
    source_person_id := source_engagement.person_id;

    select assignment.designation_id, designation.name
    into assignment_designation_id, assignment_designation_name
    from public.hr_work_assignments assignment
    left join public.designations designation
      on designation.company_id = assignment.company_id and designation.id = assignment.designation_id
    where assignment.company_id = p_company_id
      and assignment.engagement_id = source_engagement.id
      and assignment.is_primary
      and assignment.effective_from <= current_date
      and (assignment.effective_to is null or assignment.effective_to >= current_date)
    order by assignment.effective_from desc, assignment.created_at desc
    limit 1;
    if assignment_designation_id is null then raise exception 'Employee % has no current People assignment.', normalized_code; end if;

    -- Populate the target from the complete source row so personal details,
    -- documents, bank/statutory data and lifecycle timestamps survive. PostgreSQL
    -- ignores JSON keys that do not exist in the target record; the small set of
    -- differently named columns is mapped explicitly below.
    if restore_archived_target then
      -- The previous repair retained the complete original contractor row.
      -- Restore it in place so every historical contractor foreign key keeps
      -- the same UUID and its document/pay metadata is not reconstructed.
      update public.contractors
      set designation = assignment_designation_name,
          is_active = source_employee.is_active,
          deleted_at = null,
          deleted_by = null,
          deletion_reason = null,
          people_lifecycle_status = source_employee.people_lifecycle_status,
          suspension_reason = source_employee.suspension_reason,
          suspended_at = source_employee.suspended_at,
          suspended_by = source_employee.suspended_by,
          reactivated_at = source_employee.reactivated_at,
          reactivated_by = source_employee.reactivated_by,
          last_working_date = source_employee.last_working_date,
          deactivated_at = source_employee.deactivated_at,
          deactivated_by = source_employee.deactivated_by,
          updated_at = now()
      where company_id = p_company_id and id = source_employee.id;

      -- Copy every same-named mutable profile field from the live Employee row
      -- back to the recovered Contractor row. This keeps edits made after the
      -- faulty transition without overwriting the original UUID/creation audit.
      select string_agg(format('%1$I = source.%1$I', target.column_name), ', ' order by target.ordinal_position)
      into sync_assignments
      from information_schema.columns target
      join information_schema.columns source
        on source.table_schema = 'public'
       and source.table_name = 'employees'
       and source.column_name = target.column_name
      where target.table_schema = 'public'
        and target.table_name = 'contractors'
        and target.column_name not in (
          'id','company_id','created_at','created_by','updated_at',
          'deleted_at','deleted_by','deletion_reason','dropx_id'
        );
      if sync_assignments is not null then
        execute format(
          'update public.contractors target set %s from jsonb_populate_record(null::public.contractors, $1) source where target.company_id = $2 and target.id = $3',
          sync_assignments
        ) using to_jsonb(source_employee), p_company_id, source_employee.id;
      end if;
      update public.contractors
      set designation = assignment_designation_name,
          postal_pin = source_employee.pincode,
          ifsc_code = source_employee.ifsc,
          onboarding_status = case
            when source_employee.profile_completion_status in ('active','rejected','submitted')
              then source_employee.profile_completion_status
            else 'pending'
          end,
          updated_at = now()
      where company_id = p_company_id and id = source_employee.id;
    else
      insert into public.contractors
      select (jsonb_populate_record(
        null::public.contractors,
        to_jsonb(source_employee) || jsonb_build_object(
          'dropx_id', source_employee.employee_code,
          'designation', assignment_designation_name,
          'postal_pin', source_employee.pincode,
          'ifsc_code', source_employee.ifsc,
          'onboarding_status', case
            when source_employee.profile_completion_status in ('active','rejected','submitted')
              then source_employee.profile_completion_status
            else 'pending'
          end,
          'onboarding_application_source', 'dashboard'
        )
      )).*;
    end if;

    -- Preserve every shift-assignment UUID and effective period while moving
    -- only its live legal owner.
    insert into public.hr_contractor_shift_assignments (
      id, company_id, contractor_id, shift_id, effective_from, effective_to,
      notes, created_by, created_at, updated_at
    )
    select assignment.id, assignment.company_id, source_employee.id,
           assignment.shift_id, assignment.effective_from, assignment.effective_to,
           assignment.notes, assignment.created_by, assignment.created_at, assignment.updated_at
    from public.hr_employee_shift_assignments assignment
    where assignment.company_id = p_company_id
      and assignment.employee_id = source_employee.id
    on conflict (id) do update
    set contractor_id = excluded.contractor_id,
        shift_id = excluded.shift_id,
        effective_from = excluded.effective_from,
        effective_to = excluded.effective_to,
        notes = excluded.notes,
        updated_at = excluded.updated_at;

    delete from public.hr_employee_shift_assignments
    where company_id = p_company_id and employee_id = source_employee.id;

    -- A People source correction must not drop compensation. Convert each
    -- Employee salary assignment's CTC input into the equivalent monthly
    -- contractor pay profile with the same assignment UUID and dates.
    if exists (
      select 1
      from public.hr_employee_salary_assignments assignment
      where assignment.company_id = p_company_id
        and assignment.employee_id = source_employee.id
        and not exists (
          select 1
          from public.hr_employee_salary_values salary_value
          join public.hr_payroll_heads payroll_head
            on payroll_head.id = salary_value.payroll_head_id
           and payroll_head.company_id = salary_value.company_id
           and payroll_head.code = 'CTC'
          where salary_value.company_id = assignment.company_id
            and salary_value.assignment_id = assignment.id
            and salary_value.amount > 0
        )
    ) then
      raise exception 'Employee % has a salary assignment without a positive CTC input; pay conversion was blocked before any profile change.', normalized_code;
    end if;

    insert into public.hr_contractor_pay_profiles (
      id, company_id, contractor_id, payment_basis, base_amount, shift_id,
      effective_from, effective_to, notes, created_by, updated_by,
      created_at, updated_at
    )
    select assignment.id, assignment.company_id, source_employee.id,
           'monthly', salary_value.amount, null,
           assignment.effective_from, assignment.effective_to,
           'Preserved from Employee salary assignment during statutory source correction.',
           assignment.created_by, p_actor_user_id,
           assignment.created_at, assignment.updated_at
    from public.hr_employee_salary_assignments assignment
    join public.hr_employee_salary_values salary_value
      on salary_value.company_id = assignment.company_id
     and salary_value.assignment_id = assignment.id
    join public.hr_payroll_heads payroll_head
      on payroll_head.id = salary_value.payroll_head_id
     and payroll_head.company_id = salary_value.company_id
     and payroll_head.code = 'CTC'
    where assignment.company_id = p_company_id
      and assignment.employee_id = source_employee.id
    on conflict (id) do update
    set contractor_id = excluded.contractor_id,
        payment_basis = excluded.payment_basis,
        base_amount = excluded.base_amount,
        effective_from = excluded.effective_from,
        effective_to = excluded.effective_to,
        notes = excluded.notes,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

    delete from public.hr_employee_salary_values salary_value
    using public.hr_employee_salary_assignments assignment
    where assignment.company_id = p_company_id
      and assignment.employee_id = source_employee.id
      and salary_value.company_id = assignment.company_id
      and salary_value.assignment_id = assignment.id;

    delete from public.hr_employee_salary_assignments
    where company_id = p_company_id and employee_id = source_employee.id;

    update public.hr_engagements
    set worker_type = 'contractor', employee_id = null,
        contractor_id = source_employee.id, updated_by = p_actor_user_id,
        updated_at = now()
    where id = source_engagement.id;

    update public.employees
    set is_active = false, deleted_at = now(), deleted_by = p_actor_user_id,
        updated_at = now()
    where company_id = p_company_id and id = source_employee.id;
  else
    from_type := 'contractor';
    select * into source_contractor
    from public.contractors
    where company_id = p_company_id
      and deleted_at is null
      and upper(dropx_id) = normalized_code
    for update;
    if source_contractor.id is null then raise exception 'Active contractor % was not found.', normalized_code; end if;
    expected_worker_type := public.people_expected_worker_type(
      source_contractor.statutory_applicability,
      source_contractor.pf_uan,
      source_contractor.pf_account_no,
      source_contractor.esi_no
    );
    if expected_worker_type <> 'employee' then
      raise exception 'Independent contractor % has no PF or ESI evidence and cannot be moved to Employees.', normalized_code;
    end if;
    if exists (
      select 1 from public.employees
      where company_id = p_company_id and deleted_at is null
        and (id = source_contractor.id or upper(employee_code) = normalized_code)
    ) then
      raise exception 'An active employee already uses DropX ID %. Merge the duplicate before reclassification.', normalized_code;
    end if;
    if exists (
      select 1 from public.employees
      where company_id = p_company_id and id <> source_contractor.id
        and upper(employee_code) = normalized_code
    ) then
      raise exception 'An archived employee already uses DropX ID %. Restore-and-merge review is required.', normalized_code;
    end if;

    select engagement.* into source_engagement
    from public.hr_engagements engagement
    where engagement.company_id = p_company_id
      and engagement.worker_type = 'contractor'
      and engagement.contractor_id = source_contractor.id
      and engagement.status = 'active'
    for update;
    if source_engagement.id is null then raise exception 'Contractor % has no active canonical People engagement.', normalized_code; end if;
    source_person_id := source_engagement.person_id;

    select assignment.designation_id, designation.name
    into assignment_designation_id, assignment_designation_name
    from public.hr_work_assignments assignment
    left join public.designations designation
      on designation.company_id = assignment.company_id and designation.id = assignment.designation_id
    where assignment.company_id = p_company_id
      and assignment.engagement_id = source_engagement.id
      and assignment.is_primary
      and assignment.effective_from <= current_date
      and (assignment.effective_to is null or assignment.effective_to >= current_date)
    order by assignment.effective_from desc, assignment.created_at desc
    limit 1;
    if assignment_designation_id is null then raise exception 'Contractor % has no current People assignment.', normalized_code; end if;

    select exists (
      select 1 from public.employees
      where company_id = p_company_id and id = source_contractor.id and deleted_at is not null
    ) into restore_archived_target;

    if restore_archived_target then
      update public.employees
      set is_active = source_contractor.is_active,
          deleted_at = null,
          deleted_by = null,
          updated_at = now()
      where company_id = p_company_id and id = source_contractor.id;

      select string_agg(format('%1$I = source.%1$I', target.column_name), ', ' order by target.ordinal_position)
      into sync_assignments
      from information_schema.columns target
      join information_schema.columns source
        on source.table_schema = 'public'
       and source.table_name = 'contractors'
       and source.column_name = target.column_name
      where target.table_schema = 'public'
        and target.table_name = 'employees'
        and target.column_name not in (
          'id','company_id','created_at','created_by','updated_at',
          'deleted_at','deleted_by','employee_code','designation_id'
        );
      if sync_assignments is not null then
        execute format(
          'update public.employees target set %s from jsonb_populate_record(null::public.employees, $1) source where target.company_id = $2 and target.id = $3',
          sync_assignments
        ) using to_jsonb(source_contractor), p_company_id, source_contractor.id;
      end if;
      update public.employees
      set employee_code = source_contractor.dropx_id,
          designation_id = assignment_designation_id,
          pincode = source_contractor.postal_pin,
          ifsc = source_contractor.ifsc_code,
          profile_completion_status = case
            when source_contractor.onboarding_status = 'active' then 'active'
            when source_contractor.onboarding_status in ('submitted','under_review','approved') then 'submitted'
            when source_contractor.onboarding_status = 'rejected' then 'rejected'
            else 'pending'
          end,
          updated_at = now()
      where company_id = p_company_id and id = source_contractor.id;
    else
      insert into public.employees
      select (jsonb_populate_record(
        null::public.employees,
        to_jsonb(source_contractor) || jsonb_build_object(
          'employee_code', source_contractor.dropx_id,
          'designation_id', assignment_designation_id,
          'pincode', source_contractor.postal_pin,
          'ifsc', source_contractor.ifsc_code,
          'profile_completion_status', case
            when source_contractor.onboarding_status = 'active' then 'active'
            when source_contractor.onboarding_status in ('submitted','under_review','approved') then 'submitted'
            when source_contractor.onboarding_status = 'rejected' then 'rejected'
            else 'pending'
          end
        )
      )).*;
    end if;

    insert into public.hr_employee_shift_assignments (
      id, company_id, employee_id, shift_id, effective_from, effective_to,
      notes, created_by, created_at, updated_at
    )
    select assignment.id, assignment.company_id, source_contractor.id,
           assignment.shift_id, assignment.effective_from, assignment.effective_to,
           assignment.notes, assignment.created_by, assignment.created_at, assignment.updated_at
    from public.hr_contractor_shift_assignments assignment
    where assignment.company_id = p_company_id
      and assignment.contractor_id = source_contractor.id
    on conflict (id) do update
    set employee_id = excluded.employee_id,
        shift_id = excluded.shift_id,
        effective_from = excluded.effective_from,
        effective_to = excluded.effective_to,
        notes = excluded.notes,
        updated_at = excluded.updated_at;

    delete from public.hr_contractor_shift_assignments
    where company_id = p_company_id and contractor_id = source_contractor.id;

    if exists (
      select 1 from public.hr_contractor_pay_profiles pay_profile
      where pay_profile.company_id = p_company_id
        and pay_profile.contractor_id = source_contractor.id
    ) and not exists (
      select 1
      from public.hr_salary_configurations configuration
      join public.hr_salary_configuration_items item
        on item.configuration_id = configuration.id
       and item.is_enabled
       and item.calculation_type = 'input'
      join public.hr_payroll_heads payroll_head
        on payroll_head.id = item.payroll_head_id
       and payroll_head.company_id = configuration.company_id
       and payroll_head.code = 'CTC'
      where configuration.company_id = p_company_id
        and configuration.is_active
        and configuration.is_default
    ) then
      raise exception 'Independent contractor % has pay configured, but no active default Employee CTC configuration exists; pay conversion was blocked.', normalized_code;
    end if;

    if exists (
      select 1 from public.hr_contractor_pay_profiles pay_profile
      where pay_profile.company_id = p_company_id
        and pay_profile.contractor_id = source_contractor.id
    ) and exists (
      select 1 from public.hr_employee_salary_assignments assignment
      where assignment.company_id = p_company_id
        and assignment.employee_id = source_contractor.id
    ) then
      raise exception 'Worker % has both Contractor pay and archived Employee salary assignments; merge review is required before changing source.', normalized_code;
    end if;

    insert into public.hr_employee_salary_assignments (
      id, company_id, employee_id, configuration_id, effective_from,
      effective_to, created_by, created_at, updated_at
    )
    select pay_profile.id, pay_profile.company_id, source_contractor.id,
           salary_target.configuration_id, pay_profile.effective_from,
           pay_profile.effective_to, pay_profile.created_by,
           pay_profile.created_at, pay_profile.updated_at
    from public.hr_contractor_pay_profiles pay_profile
    join lateral (
      select configuration.id as configuration_id, item.payroll_head_id
      from public.hr_salary_configurations configuration
      join public.hr_salary_configuration_items item
        on item.configuration_id = configuration.id
       and item.is_enabled
       and item.calculation_type = 'input'
      join public.hr_payroll_heads payroll_head
        on payroll_head.id = item.payroll_head_id
       and payroll_head.company_id = configuration.company_id
       and payroll_head.code = 'CTC'
      where configuration.company_id = pay_profile.company_id
        and configuration.is_active
        and configuration.is_default
      order by configuration.effective_from desc, configuration.created_at desc
      limit 1
    ) salary_target on true
    where pay_profile.company_id = p_company_id
      and pay_profile.contractor_id = source_contractor.id;

    insert into public.hr_employee_salary_values (
      company_id, assignment_id, payroll_head_id, amount, created_at, updated_at
    )
    select pay_profile.company_id, pay_profile.id,
           salary_target.payroll_head_id, pay_profile.base_amount,
           pay_profile.created_at, pay_profile.updated_at
    from public.hr_contractor_pay_profiles pay_profile
    join lateral (
      select item.payroll_head_id
      from public.hr_salary_configurations configuration
      join public.hr_salary_configuration_items item
        on item.configuration_id = configuration.id
       and item.is_enabled
       and item.calculation_type = 'input'
      join public.hr_payroll_heads payroll_head
        on payroll_head.id = item.payroll_head_id
       and payroll_head.company_id = configuration.company_id
       and payroll_head.code = 'CTC'
      where configuration.company_id = pay_profile.company_id
        and configuration.is_active
        and configuration.is_default
      order by configuration.effective_from desc, configuration.created_at desc
      limit 1
    ) salary_target on true
    where pay_profile.company_id = p_company_id
      and pay_profile.contractor_id = source_contractor.id;

    delete from public.hr_contractor_pay_profiles
    where company_id = p_company_id and contractor_id = source_contractor.id;

    update public.hr_engagements
    set worker_type = 'employee', employee_id = source_contractor.id,
        contractor_id = null, updated_by = p_actor_user_id,
        updated_at = now()
    where id = source_engagement.id;

    update public.contractors
    set is_active = false, deleted_at = now(), deleted_by = p_actor_user_id,
        updated_at = now()
    where company_id = p_company_id and id = source_contractor.id;
  end if;

  update public.hr_people
  set legacy_source_type = p_target_worker_type,
      legacy_source_id = coalesce(source_employee.id, source_contractor.id),
      updated_by = p_actor_user_id,
      updated_at = now()
  where company_id = p_company_id and id = source_person_id;

  -- Tables using the paired employee/contractor foreign keys keep the same
  -- source UUID. Only the legal-source column changes, so request identity and
  -- every historical primary key remain stable.
  for table_item in
    select columns.table_schema, columns.table_name,
           bool_or(columns.column_name = 'worker_type') as has_worker_type,
           bool_or(columns.column_name = 'company_id') as has_company_id
    from information_schema.columns columns
    join information_schema.tables tables
      on tables.table_schema = columns.table_schema
     and tables.table_name = columns.table_name
     and tables.table_type = 'BASE TABLE'
    where columns.table_schema = 'public'
      and columns.column_name in ('employee_id','contractor_id','worker_type')
      and columns.table_name not in ('hr_engagements','biometric_enrolments')
    group by columns.table_schema, columns.table_name
    having bool_or(columns.column_name = 'employee_id')
       and bool_or(columns.column_name = 'contractor_id')
  loop
    has_worker_type := table_item.has_worker_type;
    if p_target_worker_type = 'contractor' then
      execute format(
        'update public.%I set employee_id = null, contractor_id = $1%s where employee_id = $1%s',
        table_item.table_name,
        case
          when not has_worker_type then ''
          when table_item.table_name in ('attendance_daily','attendance_punches','biometric_enrolments')
            then ', worker_type = ''individual_contract'''
          else ', worker_type = ''contractor'''
        end,
        case when table_item.has_company_id then ' and company_id = $2' else '' end
      ) using source_employee.id, p_company_id;
    else
      execute format(
        'update public.%I set contractor_id = null, employee_id = $1%s where contractor_id = $1%s',
        table_item.table_name,
        case when has_worker_type then ', worker_type = ''employee''' else '' end,
        case when table_item.has_company_id then ' and company_id = $2' else '' end
      ) using source_contractor.id, p_company_id;
    end if;
    get diagnostics affected = row_count;
    moved_references := moved_references + affected;
  end loop;

  -- Profile-keyed operational history (integrity flags, location samples,
  -- lifecycle history and punch ownership) follows the same UUID. This is an
  -- ownership-label correction only; timestamps, decisions and raw data stay
  -- untouched.
  for table_item in
    select columns.table_name,
           bool_or(columns.column_name = 'company_id') as has_company_id
    from information_schema.columns columns
    join information_schema.tables tables
      on tables.table_schema = columns.table_schema
     and tables.table_name = columns.table_name
     and tables.table_type = 'BASE TABLE'
    where columns.table_schema = 'public'
      and columns.column_name in ('profile_type','profile_id')
    group by columns.table_name
    having bool_or(columns.column_name = 'profile_type')
       and bool_or(columns.column_name = 'profile_id')
  loop
    execute format(
      'update public.%I set profile_type = $1 where profile_id = $2 and profile_type = $3%s',
      table_item.table_name,
      case when table_item.has_company_id then ' and company_id = $4' else '' end
    ) using p_target_worker_type, coalesce(source_employee.id, source_contractor.id), from_type, p_company_id;
    get diagnostics affected = row_count;
    moved_references := moved_references + affected;
  end loop;

  for table_item in
    select columns.table_name,
           bool_or(columns.column_name = 'company_id') as has_company_id
    from information_schema.columns columns
    join information_schema.tables tables
      on tables.table_schema = columns.table_schema
     and tables.table_name = columns.table_name
     and tables.table_type = 'BASE TABLE'
    where columns.table_schema = 'public'
      and columns.column_name in ('profile_type','account_id')
    group by columns.table_name
    having bool_or(columns.column_name = 'profile_type')
       and bool_or(columns.column_name = 'account_id')
  loop
    execute format(
      'update public.%I set profile_type = $1 where account_id = $2 and profile_type = $3%s',
      table_item.table_name,
      case when table_item.has_company_id then ' and company_id = $4' else '' end
    ) using p_target_worker_type, coalesce(source_employee.id, source_contractor.id), from_type, p_company_id;
    get diagnostics affected = row_count;
    moved_references := moved_references + affected;
  end loop;

  if to_regclass('public.biometric_enrolments') is not null then
    if p_target_worker_type = 'contractor' then
      update public.biometric_enrolments
      set worker_type = 'individual_contract', employee_id = null,
          contractor_id = source_employee.id, profile_type = 'contractor',
          account_id = source_employee.id, updated_at = now()
      where company_id = p_company_id
        and (employee_id = source_employee.id or (profile_type = 'employee' and account_id = source_employee.id));
    else
      update public.biometric_enrolments
      set worker_type = 'employee', employee_id = source_contractor.id,
          contractor_id = null, profile_type = 'employee',
          account_id = source_contractor.id, updated_at = now()
      where company_id = p_company_id
        and (contractor_id = source_contractor.id or (profile_type = 'contractor' and account_id = source_contractor.id));
    end if;
    get diagnostics affected = row_count;
    moved_references := moved_references + affected;
  end if;

  for table_item in
    select columns.table_name,
           bool_or(columns.column_name = 'worker_type') as has_worker_type,
           bool_or(columns.column_name = 'worker_id') as has_worker_id,
           bool_or(columns.column_name = 'company_id') as has_company_id
    from information_schema.columns columns
    join information_schema.tables tables
      on tables.table_schema = columns.table_schema
     and tables.table_name = columns.table_name
     and tables.table_type = 'BASE TABLE'
    where columns.table_schema = 'public'
      and columns.column_name in ('worker_type','worker_id')
      and columns.table_name not in (
        'hr_worker_classification_reconciliations',
        'hr_payroll_run_people'
      )
    group by columns.table_name
    having bool_or(columns.column_name = 'worker_type')
       and bool_or(columns.column_name = 'worker_id')
  loop
    execute format(
      'update public.%I set worker_type = $1 where worker_id = $2 and worker_type = $3%s',
      table_item.table_name,
      case when table_item.has_company_id then ' and company_id = $4' else '' end
    ) using p_target_worker_type, coalesce(source_employee.id, source_contractor.id), from_type, p_company_id;
    get diagnostics affected = row_count;
    moved_references := moved_references + affected;
  end loop;

  if to_regclass('public.connect_profile_verifications') is not null then
    update public.connect_profile_verifications
    set profile_type = p_target_worker_type, updated_at = now()
    where company_id = p_company_id
      and account_id = coalesce(source_employee.id, source_contractor.id)
      and profile_type = from_type;
  end if;

  if to_regclass('public.profile_document_trash') is not null then
    update public.profile_document_trash
    set owner_type = p_target_worker_type
    where company_id = p_company_id
      and owner_id = coalesce(source_employee.id, source_contractor.id)
      and owner_type = from_type;
  end if;

  insert into public.hr_worker_classification_reconciliations (
    company_id, worker_code, from_worker_type, to_worker_type,
    source_record_id, target_record_id, status, reason, evidence,
    requested_by, completed_by, completed_at, updated_at
  ) values (
    p_company_id, normalized_code, from_type, p_target_worker_type,
    coalesce(source_employee.id, source_contractor.id),
    coalesce(source_employee.id, source_contractor.id),
    'completed', trim(p_reason),
    jsonb_build_object(
      'same_uuid_preserved', true,
      'canonical_person_id', source_person_id,
      'canonical_engagement_id', source_engagement.id,
      'designation_id', assignment_designation_id,
      'classification_rule', 'PF or ESI evidence means Employee; neither means Independent Contractor',
      'expected_worker_type', expected_worker_type,
      'moved_reference_rows', moved_references
    ),
    p_actor_user_id, p_actor_user_id, now(), now()
  )
  on conflict (company_id, worker_code, from_worker_type, to_worker_type) do update
  set source_record_id = excluded.source_record_id,
      target_record_id = excluded.target_record_id,
      status = 'completed',
      reason = excluded.reason,
      evidence = excluded.evidence,
      error_message = null,
      completed_by = excluded.completed_by,
      completed_at = excluded.completed_at,
      updated_at = now();

  insert into public.hr_audit_log (
    company_id, actor_user_id, entity_type, entity_id, action, after_data
  ) values (
    p_company_id, p_actor_user_id, 'people_worker_classification',
    coalesce(source_employee.id, source_contractor.id), 'reclassify',
    jsonb_build_object(
      'worker_code', normalized_code,
      'from_worker_type', from_type,
      'to_worker_type', p_target_worker_type,
      'reason', trim(p_reason),
      'same_uuid_preserved', true,
      'classification_rule', 'statutory_pf_esi',
      'moved_reference_rows', moved_references
    )
  );

  return jsonb_build_object(
    'worker_code', normalized_code,
    'from_worker_type', from_type,
    'to_worker_type', p_target_worker_type,
    'record_id', coalesce(source_employee.id, source_contractor.id),
    'moved_reference_rows', moved_references
  );
end;
$$;

revoke all on function public.reclassify_people_worker(uuid,text,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.reclassify_people_worker(uuid,text,text,uuid,text)
  to service_role;

-- Recover the specifically reported missing canonical person first. No person,
-- assignment or reporting row is fabricated: D0785 is restored only from its
-- archived source row and existing canonical engagement, preserving the UUID
-- that reportees already reference.
do $$
declare
  item record;
  failure text;
  changed_rows integer;
begin
  for item in
    select coalesce(employee.company_id, contractor.company_id) as company_id,
           coalesce(employee.id, contractor.id) as source_record_id,
           employee.id is not null as has_employee,
           contractor.id is not null as has_contractor,
           employee.deleted_at is null and coalesce(employee.is_active,false) as active_employee,
           contractor.deleted_at is null and coalesce(contractor.is_active,false) as active_contractor,
           public.people_expected_worker_type(
             coalesce(employee.statutory_applicability, contractor.statutory_applicability),
             coalesce(employee.pf_uan, contractor.pf_uan),
             coalesce(employee.pf_account_no, contractor.pf_account_no),
             coalesce(employee.esi_no, contractor.esi_no)
           ) as expected_worker_type,
           count(*) over (
             partition by coalesce(employee.company_id, contractor.company_id)
           ) as candidate_count
    from public.employees employee
    full join public.contractors contractor
      on contractor.company_id = employee.company_id
     and contractor.id = employee.id
    where upper(coalesce(employee.employee_code, '')) = 'D0785'
       or upper(coalesce(contractor.dropx_id, '')) = 'D0785'
  loop
    begin
      if item.candidate_count <> 1 then
        raise exception 'D0785 resolves to % source UUIDs in one company; automatic recovery stopped.', item.candidate_count;
      end if;

      if item.expected_worker_type = 'contractor' and not item.active_contractor then
        if item.has_employee then
          update public.employees
          set is_active = true, deleted_at = null, deleted_by = null, updated_at = now()
          where company_id = item.company_id and id = item.source_record_id;
          update public.hr_engagements
          set status = 'active', worker_type = 'employee',
              employee_id = item.source_record_id, contractor_id = null,
              updated_at = now()
          where company_id = item.company_id
            and (employee_id = item.source_record_id or contractor_id = item.source_record_id);
          get diagnostics changed_rows = row_count;
          if changed_rows = 0 then
            raise exception 'D0785 has no recoverable canonical engagement.';
          end if;
          perform public.reclassify_people_worker(
            item.company_id, 'D0785', 'contractor', null,
            'Recovered from the faulty designation-driven table transition; statutory PF/ESI evidence requires Independent Contractor.'
          );
        elsif item.has_contractor then
          update public.contractors
          set is_active = true, deleted_at = null, deleted_by = null,
              deletion_reason = null, updated_at = now()
          where company_id = item.company_id and id = item.source_record_id;
          update public.hr_engagements
          set status = 'active', worker_type = 'contractor', employee_id = null,
              contractor_id = item.source_record_id, updated_at = now()
          where company_id = item.company_id
            and (employee_id = item.source_record_id or contractor_id = item.source_record_id);
          get diagnostics changed_rows = row_count;
          if changed_rows = 0 then
            raise exception 'D0785 has no recoverable canonical engagement.';
          end if;
        end if;
      elsif item.expected_worker_type = 'employee' and not item.active_employee then
        if item.has_contractor then
          update public.contractors
          set is_active = true, deleted_at = null, deleted_by = null,
              deletion_reason = null, updated_at = now()
          where company_id = item.company_id and id = item.source_record_id;
          update public.hr_engagements
          set status = 'active', worker_type = 'contractor', employee_id = null,
              contractor_id = item.source_record_id, updated_at = now()
          where company_id = item.company_id
            and (employee_id = item.source_record_id or contractor_id = item.source_record_id);
          get diagnostics changed_rows = row_count;
          if changed_rows = 0 then
            raise exception 'D0785 has no recoverable canonical engagement.';
          end if;
          perform public.reclassify_people_worker(
            item.company_id, 'D0785', 'employee', null,
            'Recovered from the faulty designation-driven table transition; statutory PF/ESI evidence requires Employee.'
          );
        elsif item.has_employee then
          update public.employees
          set is_active = true, deleted_at = null, deleted_by = null, updated_at = now()
          where company_id = item.company_id and id = item.source_record_id;
          update public.hr_engagements
          set status = 'active', worker_type = 'employee',
              employee_id = item.source_record_id, contractor_id = null,
              updated_at = now()
          where company_id = item.company_id
            and (employee_id = item.source_record_id or contractor_id = item.source_record_id);
          get diagnostics changed_rows = row_count;
          if changed_rows = 0 then
            raise exception 'D0785 has no recoverable canonical engagement.';
          end if;
        end if;
      end if;

      update public.hr_people person
      set legacy_source_type = item.expected_worker_type,
          legacy_source_id = item.source_record_id,
          updated_at = now()
      from public.hr_engagements engagement
      where engagement.company_id = item.company_id
        and engagement.person_id = person.id
        and (engagement.employee_id = item.source_record_id or engagement.contractor_id = item.source_record_id);

      insert into public.hr_audit_log (
        company_id, entity_type, entity_id, action, after_data
      ) values (
        item.company_id, 'people_worker_classification', item.source_record_id,
        'recover_missing_canonical_person',
        jsonb_build_object(
          'worker_code', 'D0785',
          'expected_worker_type', item.expected_worker_type,
          'same_uuid_preserved', true,
          'classification_rule', 'statutory_pf_esi'
        )
      );
    exception when others then
      failure := sqlerrm;
      insert into public.hr_worker_classification_reconciliations (
        company_id, worker_code, from_worker_type, to_worker_type,
        source_record_id, status, reason, evidence, error_message, updated_at
      ) values (
        item.company_id, 'D0785',
        case when item.expected_worker_type = 'contractor' then 'employee' else 'contractor' end,
        item.expected_worker_type,
        item.source_record_id, 'blocked',
        'Recover the missing canonical D0785 profile from its archived source and existing engagement.',
        jsonb_build_object('automatic_change_applied',false,'same_uuid_required',true),
        failure, now()
      )
      on conflict (company_id, worker_code, from_worker_type, to_worker_type) do update
      set status = 'blocked', error_message = excluded.error_message,
          evidence = excluded.evidence, updated_at = now();
    end;
  end loop;
end
$$;

-- Apply the statutory rule across both current People tables. Each row runs in
-- its own subtransaction: one blocked pay/reference dependency is recorded for
-- review and cannot roll back the safe corrections around it.
do $$
declare
  item record;
  failure text;
begin
  for item in
    select audit.company_id, audit.worker_type, audit.worker_id,
           upper(audit.worker_code) as worker_code,
           audit.expected_worker_type,
           audit.statutory_applicability,
           nullif(btrim(coalesce(audit.pf_uan,'')), '') is not null as has_pf_uan,
           nullif(btrim(coalesce(audit.pf_account_no,'')), '') is not null as has_pf_account,
           nullif(btrim(coalesce(audit.esi_no,'')), '') is not null as has_esi_no,
           audit.transition_affected,
           audit.recoverable_counterpart
    from public.people_worker_classification_audit audit
    where audit.classification_state = 'wrong_source'
      and nullif(btrim(coalesce(audit.worker_code,'')), '') is not null
    order by audit.company_id, audit.worker_code
  loop
    begin
      perform public.reclassify_people_worker(
        item.company_id,
        item.worker_code,
        item.expected_worker_type,
        null,
        case
          when item.transition_affected or item.recoverable_counterpart
            then 'Automatic rollback of designation-driven table transition; legal source follows PF/ESI evidence.'
          else 'Automatic statutory reconciliation; legal source follows PF/ESI evidence.'
        end
      );
    exception when others then
      failure := sqlerrm;
      insert into public.hr_worker_classification_reconciliations (
        company_id, worker_code, from_worker_type, to_worker_type,
        source_record_id, status, reason, evidence, error_message, updated_at
      ) values (
        item.company_id, item.worker_code, item.worker_type, item.expected_worker_type,
        item.worker_id, 'blocked',
        'Statutory source reconciliation was stopped before commit because a dependency could not be preserved safely.',
        jsonb_build_object(
          'statutory_applicability', item.statutory_applicability,
          'has_pf_uan', item.has_pf_uan,
          'has_pf_account', item.has_pf_account,
          'has_esi_no', item.has_esi_no,
          'transition_affected', item.transition_affected,
          'recoverable_counterpart', item.recoverable_counterpart,
          'automatic_change_applied', false
        ),
        failure, now()
      )
      on conflict (company_id, worker_code, from_worker_type, to_worker_type) do update
      set source_record_id = excluded.source_record_id,
          status = 'blocked',
          reason = excluded.reason,
          evidence = excluded.evidence,
          error_message = excluded.error_message,
          updated_at = now();
    end;
  end loop;
end
$$;

alter table public.hr_worker_classification_reconciliations enable row level security;
drop policy if exists hr_worker_classification_service_role
  on public.hr_worker_classification_reconciliations;
create policy hr_worker_classification_service_role
  on public.hr_worker_classification_reconciliations
  for all to service_role using (true) with check (true);

grant select on public.people_worker_classification_audit to authenticated;

notify pgrst, 'reload schema';
commit;
