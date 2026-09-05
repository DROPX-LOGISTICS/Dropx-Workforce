begin;

-- One mobile number represents one human identity. A person can only receive a
-- second, different Workforce engagement after the existing lifecycle approval;
-- duplicate registrations for the same designation are never allowed.
create or replace function public.normalize_onboarding_mobile(p_mobile text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when length(regexp_replace(coalesce(p_mobile, ''), '[^0-9]', '', 'g')) >= 10
      then right(regexp_replace(coalesce(p_mobile, ''), '[^0-9]', '', 'g'), 10)
    else regexp_replace(coalesce(p_mobile, ''), '[^0-9]', '', 'g')
  end
$$;

create or replace function public.onboarding_identity_conflicts(
  p_company_id uuid,
  p_mobile text,
  p_exclude_source text default null,
  p_exclude_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with requested as (
    select public.normalize_onboarding_mobile(p_mobile) as mobile
  ), matches as (
    select 'employees'::text as source_type, employee.id as source_id,
      employee.full_name as display_name, employee.designation_id,
      designation.code as designation_code, designation.name as designation_name,
      case when employee.is_active then 'active' else 'inactive' end as profile_status
    from public.employees employee
    cross join requested
    left join public.designations designation
      on designation.company_id = employee.company_id and designation.id = employee.designation_id
    where employee.company_id = p_company_id
      and employee.deleted_at is null
      and requested.mobile <> ''
      and public.normalize_onboarding_mobile(employee.mobile) = requested.mobile

    union all

    select 'contractors', contractor.id, contractor.full_name, designation.id,
      designation.code, coalesce(designation.name, contractor.designation),
      coalesce(contractor.onboarding_status, case when contractor.is_active then 'active' else 'inactive' end)
    from public.contractors contractor
    cross join requested
    left join public.designations designation
      on designation.company_id = contractor.company_id
     and (lower(designation.name) = lower(contractor.designation) or lower(designation.code) = lower(contractor.designation))
    where contractor.company_id = p_company_id
      and contractor.deleted_at is null
      and requested.mobile <> ''
      and public.normalize_onboarding_mobile(contractor.mobile) = requested.mobile

    union all

    select 'workforce', workforce.id, workforce.full_name, workforce.designation_id,
      designation.code, coalesce(designation.name, workforce.designation),
      coalesce(workforce.onboarding_status, case when workforce.is_active then 'active' else 'inactive' end)
    from public.workforce workforce
    cross join requested
    left join public.designations designation
      on designation.company_id = workforce.company_id and designation.id = workforce.designation_id
    where workforce.company_id = p_company_id
      and workforce.deleted_at is null
      and requested.mobile <> ''
      and public.normalize_onboarding_mobile(workforce.mobile) = requested.mobile

    union all

    select 'field_executives', executive.id, executive.full_name, designation.id,
      designation.code, coalesce(designation.name, executive.designation),
      coalesce(executive.onboarding_status, case when executive.is_active then 'active' else 'inactive' end)
    from public.field_executives executive
    cross join requested
    left join public.designations designation
      on designation.company_id = executive.company_id
     and (lower(designation.name) = lower(executive.designation) or lower(designation.code) = lower(executive.designation))
    where executive.company_id = p_company_id
      and executive.deleted_at is null
      and requested.mobile <> ''
      and public.normalize_onboarding_mobile(executive.mobile) = requested.mobile

    union all

    select 'vendors', vendor.id, vendor.full_name, designation.id,
      designation.code, coalesce(designation.name, vendor.designation),
      coalesce(vendor.onboarding_status, case when vendor.is_active then 'active' else 'inactive' end)
    from public.vendors vendor
    cross join requested
    left join public.designations designation
      on designation.company_id = vendor.company_id
     and (lower(designation.name) = lower(vendor.designation) or lower(designation.code) = lower(vendor.designation))
    where vendor.company_id = p_company_id
      and vendor.deleted_at is null
      and requested.mobile <> ''
      and public.normalize_onboarding_mobile(vendor.mobile) = requested.mobile

    union all

    select 'workers', worker.id, worker.full_name, designation.id,
      designation.code, coalesce(designation.name, worker.designation),
      coalesce(worker.onboarding_status, case when worker.is_active then 'active' else 'inactive' end)
    from public.workers worker
    cross join requested
    left join public.designations designation
      on designation.company_id = worker.company_id
     and (lower(designation.name) = lower(worker.designation) or lower(designation.code) = lower(worker.designation))
    where worker.company_id = p_company_id
      and worker.deleted_at is null
      and requested.mobile <> ''
      and public.normalize_onboarding_mobile(worker.mobile) = requested.mobile

    union all

    select 'workforce_helpers', helper.id, helper.full_name, designation.id,
      designation.code, coalesce(designation.name, helper.designation),
      coalesce(helper.onboarding_status, case when helper.is_active then 'active' else 'inactive' end)
    from public.workforce_helpers helper
    cross join requested
    left join public.designations designation
      on designation.company_id = helper.company_id
     and (lower(designation.name) = lower(helper.designation) or lower(designation.code) = lower(helper.designation))
    where helper.company_id = p_company_id
      and helper.deleted_at is null
      and requested.mobile <> ''
      and public.normalize_onboarding_mobile(helper.mobile) = requested.mobile
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'source_type', source_type,
    'source_id', source_id,
    'display_name', display_name,
    'designation_id', designation_id,
    'designation_code', designation_code,
    'designation_name', designation_name,
    'profile_status', profile_status
  ) order by source_type, display_name), '[]'::jsonb)
  from matches
  where not (source_type = coalesce(p_exclude_source, '') and source_id = p_exclude_id)
$$;

create or replace function public.evaluate_onboarding_identity(
  p_company_id uuid,
  p_mobile text,
  p_designation_id uuid default null,
  p_designation_name text default null,
  p_exclude_source text default null,
  p_exclude_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with requested as (
    select
      public.normalize_onboarding_mobile(p_mobile) as mobile,
      upper(regexp_replace(coalesce(designation.code, p_designation_name, ''), '[^A-Za-z0-9]', '', 'g')) as code_key,
      upper(regexp_replace(coalesce(designation.name, p_designation_name, ''), '[^A-Za-z0-9]', '', 'g')) as name_key
    from (select 1) seed
    left join public.designations designation
      on designation.company_id = p_company_id and designation.id = p_designation_id
  ), matches as (
    select item,
      upper(regexp_replace(coalesce(item ->> 'designation_code', ''), '[^A-Za-z0-9]', '', 'g')) as code_key,
      upper(regexp_replace(coalesce(item ->> 'designation_name', ''), '[^A-Za-z0-9]', '', 'g')) as name_key,
      nullif(item ->> 'designation_id', '')::uuid as designation_id
    from jsonb_array_elements(public.onboarding_identity_conflicts(
      p_company_id, p_mobile, p_exclude_source, p_exclude_id
    )) item
  ), classified as (
    select item,
      (
        (p_designation_id is not null and designation_id = p_designation_id)
        or (requested.code_key <> '' and requested.code_key in (matches.code_key, matches.name_key))
        or (requested.name_key <> '' and requested.name_key in (matches.code_key, matches.name_key))
      ) as exact_designation
    from matches cross join requested
  )
  select jsonb_build_object(
    'normalized_mobile', (select mobile from requested),
    'exact_matches', coalesce(jsonb_agg(item) filter (where exact_designation), '[]'::jsonb),
    'other_matches', coalesce(jsonb_agg(item) filter (where not exact_designation), '[]'::jsonb)
  )
  from classified
$$;

alter table public.workforce
  add column if not exists identity_exception_required boolean not null default false,
  add column if not exists identity_exception_context jsonb not null default '{}'::jsonb,
  add column if not exists identity_exception_approved_at timestamptz,
  add column if not exists identity_exception_approved_by uuid;

create or replace function public.enforce_onboarding_mobile_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_data jsonb := to_jsonb(new);
  old_data jsonb;
  company_value uuid;
  profile_id_value uuid;
  designation_id_value uuid;
  designation_name_value text;
  normalized_mobile_value text;
  evaluation jsonb;
  exact_matches jsonb;
  other_matches jsonb;
  existing_name text;
  existing_designation text;
begin
  company_value := nullif(new_data ->> 'company_id', '')::uuid;
  profile_id_value := nullif(new_data ->> 'id', '')::uuid;
  designation_id_value := nullif(new_data ->> 'designation_id', '')::uuid;
  designation_name_value := nullif(btrim(new_data ->> 'designation'), '');
  normalized_mobile_value := public.normalize_onboarding_mobile(new_data ->> 'mobile');

  if company_value is null or normalized_mobile_value = '' then return new; end if;

  if tg_op = 'UPDATE' then
    old_data := to_jsonb(old);
    if public.normalize_onboarding_mobile(old_data ->> 'mobile') = normalized_mobile_value
       and coalesce(old_data ->> 'designation_id', '') = coalesce(new_data ->> 'designation_id', '')
       and lower(coalesce(old_data ->> 'designation', '')) = lower(coalesce(new_data ->> 'designation', '')) then
      if tg_table_name = 'workforce'
         and coalesce((new_data ->> 'identity_exception_required')::boolean, false)
         and lower(coalesce(new_data ->> 'onboarding_status', '')) = 'active'
         and nullif(new_data ->> 'identity_exception_approved_at', '') is null then
        raise exception using
          errcode = '23514',
          message = 'Review and explicitly approve the existing-person exception before activating this Workforce engagement.';
      end if;
      return new;
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(company_value::text || ':' || normalized_mobile_value, 0)
  );

  evaluation := public.evaluate_onboarding_identity(
    company_value,
    normalized_mobile_value,
    designation_id_value,
    designation_name_value,
    tg_table_name,
    profile_id_value
  );
  exact_matches := coalesce(evaluation -> 'exact_matches', '[]'::jsonb);
  other_matches := coalesce(evaluation -> 'other_matches', '[]'::jsonb);

  if jsonb_array_length(exact_matches) > 0 then
    existing_name := coalesce(exact_matches -> 0 ->> 'display_name', 'an existing person');
    existing_designation := coalesce(exact_matches -> 0 ->> 'designation_name', exact_matches -> 0 ->> 'designation_code', 'this designation');
    raise exception using
      errcode = '23505',
      message = format('Mobile number is already registered to %s as %s. Continue the existing profile; duplicate registration for the same designation is not allowed.', existing_name, existing_designation);
  end if;

  if jsonb_array_length(other_matches) = 0 then
    if tg_table_name = 'workforce' then
      new.identity_exception_required := false;
      new.identity_exception_context := '{}'::jsonb;
      new.identity_exception_approved_at := null;
      new.identity_exception_approved_by := null;
    end if;
    return new;
  end if;

  existing_name := coalesce(other_matches -> 0 ->> 'display_name', 'an existing person');
  existing_designation := coalesce(other_matches -> 0 ->> 'designation_name', other_matches -> 0 ->> 'designation_code', 'another designation');

  if tg_table_name <> 'workforce' then
    raise exception using
      errcode = '23505',
      message = format('Mobile number already belongs to %s (%s). A second profile is not allowed here; only a different Workforce engagement may proceed through lifecycle approval.', existing_name, existing_designation);
  end if;

  if coalesce((new_data ->> 'approval_required')::boolean, false) is not true
     or lower(coalesce(new_data ->> 'onboarding_status', '')) = 'active'
     or coalesce((new_data ->> 'is_active')::boolean, false) is true then
    raise exception using
      errcode = '23514',
      message = 'An existing person can receive a different Workforce designation only through the pending lifecycle approval flow.';
  end if;

  new.identity_exception_required := true;
  new.identity_exception_context := jsonb_build_object(
    'reason', 'existing_person_different_designation',
    'normalized_mobile', normalized_mobile_value,
    'existing_profiles', other_matches,
    'requested_designation_id', designation_id_value,
    'requested_designation', designation_name_value,
    'detected_at', now()
  );
  return new;
end
$$;

do $$
declare
  item record;
begin
  for item in
    select * from (values
      ('employees', 'mobile, designation_id'),
      ('contractors', 'mobile, designation'),
      ('workforce', 'mobile, designation_id, designation, onboarding_status, approval_required, identity_exception_approved_at'),
      ('field_executives', 'mobile, designation'),
      ('vendors', 'mobile, designation'),
      ('workers', 'mobile, designation'),
      ('workforce_helpers', 'mobile, designation')
    ) as target(table_name, update_columns)
  loop
    if to_regclass('public.' || item.table_name) is not null then
      execute format('drop trigger if exists enforce_mobile_identity_on_%I on public.%I', item.table_name, item.table_name);
      execute format(
        'create trigger enforce_mobile_identity_on_%I before insert or update of %s on public.%I for each row execute function public.enforce_onboarding_mobile_identity()',
        item.table_name,
        item.update_columns,
        item.table_name
      );
    end if;
  end loop;
end
$$;

create or replace function public.enforce_recruitment_application_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  company_value uuid;
  normalized_mobile_value text;
  role_id_value uuid;
  role_name_value text;
  evaluation jsonb;
begin
  select application.company_id, lead.normalized_phone, requisition.role_id,
    coalesce(role.name, role.code)
  into company_value, normalized_mobile_value, role_id_value, role_name_value
  from (select new.company_id, new.lead_id, new.requisition_id) application
  join public.recruitment_leads lead
    on lead.company_id = application.company_id and lead.id = application.lead_id
  join public.recruitment_job_requisitions requisition
    on requisition.company_id = application.company_id and requisition.id = application.requisition_id
  left join public.recruitment_roles role
    on role.company_id = requisition.company_id and role.id = requisition.role_id;

  normalized_mobile_value := public.normalize_onboarding_mobile(normalized_mobile_value);
  if company_value is null or normalized_mobile_value = '' then return new; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(company_value::text || ':' || normalized_mobile_value, 0)
  );

  if exists (
    select 1
    from public.recruitment_applications application
    join public.recruitment_leads lead
      on lead.company_id = application.company_id and lead.id = application.lead_id
    join public.recruitment_job_requisitions requisition
      on requisition.company_id = application.company_id and requisition.id = application.requisition_id
    where application.company_id = company_value
      and application.id <> new.id
      and application.status not in ('withdrawn', 'rejected')
      and public.normalize_onboarding_mobile(lead.normalized_phone) = normalized_mobile_value
      and requisition.role_id = role_id_value
  ) then
    raise exception using errcode = '23505',
      message = 'This person already has an application for the same designation. Continue the existing application instead of registering again.';
  end if;

  evaluation := public.evaluate_onboarding_identity(
    company_value, normalized_mobile_value, null, role_name_value, null, null
  );
  if jsonb_array_length(coalesce(evaluation -> 'exact_matches', '[]'::jsonb)) > 0 then
    raise exception using errcode = '23505',
      message = 'This person already has an active or historical profile for the same designation. Continue that profile instead of onboarding again.';
  end if;
  return new;
end
$$;

do $$
begin
  if to_regclass('public.recruitment_applications') is not null then
    drop trigger if exists enforce_mobile_identity_on_recruitment_applications on public.recruitment_applications;
    create trigger enforce_mobile_identity_on_recruitment_applications
      before insert or update of lead_id, requisition_id, status
      on public.recruitment_applications
      for each row execute function public.enforce_recruitment_application_identity();
  end if;
end
$$;

revoke all on function public.onboarding_identity_conflicts(uuid, text, text, uuid) from public;
revoke all on function public.evaluate_onboarding_identity(uuid, text, uuid, text, text, uuid) from public;
grant execute on function public.onboarding_identity_conflicts(uuid, text, text, uuid) to service_role;
grant execute on function public.evaluate_onboarding_identity(uuid, text, uuid, text, text, uuid) to service_role;

notify pgrst, 'reload schema';

commit;
