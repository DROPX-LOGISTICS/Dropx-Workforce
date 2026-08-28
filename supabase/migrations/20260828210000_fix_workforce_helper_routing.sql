begin;

-- Housekeeping profiles already live in workforce_helpers. Make that physical
-- register a supported source and target so the master can preserve the
-- existing record instead of forcing it into a stricter generic worker table.
create or replace function public.designation_register_counts(p_company_id uuid)
returns table(
  designation_id uuid,
  table_name text,
  total_count bigint,
  active_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  register_value text;
begin
  foreach register_value in array array[
    'employees',
    'contractors',
    'workforce',
    'vendors',
    'workers',
    'workforce_helpers'
  ] loop
    if register_value in ('employees', 'workforce') then
      return query execute format(
        'select designation.id, %L::text, count(profile.id), count(profile.id) filter (where profile.is_active) '
          'from public.designations designation '
          'left join public.%I profile on profile.company_id = designation.company_id and profile.designation_id = designation.id '
          'where designation.company_id = $1 group by designation.id',
        register_value,
        register_value
      ) using p_company_id;
    else
      return query execute format(
        'select designation.id, %L::text, count(profile.id), count(profile.id) filter (where profile.is_active) '
          'from public.designations designation '
          'left join public.%I profile on profile.company_id = designation.company_id '
          'and (upper(profile.designation) = upper(designation.code) or lower(btrim(profile.designation)) = lower(btrim(designation.name))) '
          'where designation.company_id = $1 group by designation.id',
        register_value,
        register_value
      ) using p_company_id;
    end if;
  end loop;
end;
$$;

create or replace function public.upsert_record_from_json(
  p_target_table regclass,
  p_record jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  column_list text;
  assignment_list text;
  target_id uuid;
begin
  if p_target_table not in (
    'public.employees'::regclass,
    'public.contractors'::regclass,
    'public.workforce'::regclass,
    'public.vendors'::regclass,
    'public.workers'::regclass,
    'public.workforce_helpers'::regclass,
    'public.field_executives'::regclass
  ) then
    raise exception 'Unsupported profile table: %', p_target_table;
  end if;

  select
    string_agg(format('%I', attribute.attname), ', ' order by attribute.attnum),
    string_agg(
      format('%1$I = excluded.%1$I', attribute.attname),
      ', ' order by attribute.attnum
    ) filter (where attribute.attname <> 'id')
  into column_list, assignment_list
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = p_target_table
    and attribute.attnum > 0
    and not attribute.attisdropped
    and attribute.attgenerated = ''
    and p_record ? attribute.attname;

  if column_list is null or not (p_record ? 'id') then
    raise exception 'Profile payload must contain an id for %', p_target_table;
  end if;

  execute format(
    'insert into %1$s (%2$s) select %2$s from jsonb_populate_record(null::%1$s, $1) '
      'on conflict (id) do update set %3$s returning id',
    p_target_table,
    column_list,
    assignment_list
  )
  into target_id
  using p_record;

  return target_id;
end;
$$;

-- OLD/NEW are table-shaped records. Referencing designation_id inside a
-- boolean expression on text-designation tables causes PostgreSQL to resolve a
-- field that does not exist. Branch by table first so vendor/worker upserts can
-- safely reach their text designation column.
create or replace function public.enforce_designation_register_route()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  route_value record;
  designation_id_value uuid;
  designation_value text;
begin
  if tg_op = 'UPDATE' then
    if tg_table_name in ('employees', 'workforce') then
      if new.designation_id is not distinct from old.designation_id then
        return new;
      end if;
    else
      if new.designation is not distinct from old.designation then
        return new;
      end if;
    end if;
  end if;

  if tg_table_name in ('employees', 'workforce') then
    designation_id_value := new.designation_id;
  else
    designation_value := new.designation;
  end if;

  select * into route_value
  from public.resolve_designation_register(
    new.company_id,
    designation_id_value,
    designation_value
  );

  if route_value.designation_id is null then
    raise exception 'This designation is not mapped in Workforce Master. Map it before registration.';
  end if;
  if not route_value.registration_enabled then
    raise exception 'Registration is disabled for this designation in Workforce Master.';
  end if;
  if route_value.table_name = tg_table_name then
    return new;
  end if;
  if tg_table_name in ('contractors', 'field_executives')
    and route_value.table_name = 'workforce' then
    return new;
  end if;

  raise exception 'Designation is routed to %, not %.', route_value.table_name, tg_table_name;
end;
$$;

create or replace function public.route_profile_record(
  p_source_register text,
  p_record jsonb,
  p_designation_id uuid,
  p_target_register text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  company_id_value uuid := nullif(p_record ->> 'company_id', '')::uuid;
  source_id_value uuid := nullif(p_record ->> 'id', '')::uuid;
  designation_name_value text;
  target_id_value uuid;
  payload_value jsonb;
  target_table_value regclass;
  source_profile_type_value text;
begin
  if p_source_register not in (
    'employees',
    'contractors',
    'workforce',
    'vendors',
    'workers',
    'workforce_helpers',
    'field_executives'
  ) then
    raise exception 'Unsupported source register: %', p_source_register;
  end if;
  if p_target_register not in ('employees', 'contractors', 'workforce', 'vendors', 'workers', 'workforce_helpers') then
    raise exception 'Unsupported target register: %', p_target_register;
  end if;
  if company_id_value is null or source_id_value is null or p_designation_id is null then
    raise exception 'Company, profile id, and designation are required for reconciliation.';
  end if;

  select designation.name into designation_name_value
  from public.designations designation
  where designation.id = p_designation_id
    and designation.company_id = company_id_value;
  if designation_name_value is null then
    raise exception 'Designation is not available for this company.';
  end if;

  if p_source_register = p_target_register then
    target_id_value := source_id_value;
  else
    payload_value := p_record || jsonb_build_object(
      'id', source_id_value,
      'company_id', company_id_value,
      'designation', designation_name_value,
      'designation_id', p_designation_id,
      'updated_at', now()
    );

    if p_target_register = 'employees' then
      payload_value := payload_value || jsonb_build_object(
        'employee_code', coalesce(nullif(p_record ->> 'employee_code', ''), nullif(p_record ->> 'dropx_id', '')),
        'profile_completion_status', coalesce(nullif(p_record ->> 'profile_completion_status', ''), nullif(p_record ->> 'onboarding_status', ''), 'pending')
      );
      target_table_value := 'public.employees'::regclass;
    elsif p_target_register = 'workforce' then
      source_profile_type_value := case p_source_register
        when 'employees' then 'employee'
        when 'vendors' then 'vendor'
        when 'workers' then 'worker'
        when 'workforce_helpers' then 'worker'
        when 'workforce' then 'canonical'
        when 'field_executives' then 'field_executive'
        else 'contractor'
      end;
      payload_value := payload_value || jsonb_build_object(
        'source_profile_type', source_profile_type_value,
        'source_profile_id', source_id_value,
        'approval_required', coalesce((p_record ->> 'approval_required')::boolean, true),
        'provider_id_status', coalesce(nullif(p_record ->> 'provider_id_status', ''), 'pending'),
        'compatibility_mode', p_source_register <> 'workforce',
        'migration_state', case when p_source_register = 'workforce' then 'canonical' else 'mirrored' end,
        'synced_at', now()
      );
      target_table_value := 'public.workforce'::regclass;
    elsif p_target_register = 'contractors' then
      payload_value := payload_value || jsonb_build_object(
        'dropx_id', coalesce(nullif(p_record ->> 'dropx_id', ''), nullif(p_record ->> 'employee_code', '')),
        'onboarding_status', coalesce(nullif(p_record ->> 'onboarding_status', ''), nullif(p_record ->> 'profile_completion_status', ''), 'pending')
      );
      target_table_value := 'public.contractors'::regclass;
    elsif p_target_register = 'vendors' then
      payload_value := payload_value || jsonb_build_object(
        'dropx_id', coalesce(nullif(p_record ->> 'dropx_id', ''), nullif(p_record ->> 'employee_code', '')),
        'onboarding_status', coalesce(nullif(p_record ->> 'onboarding_status', ''), nullif(p_record ->> 'profile_completion_status', ''), 'pending')
      );
      target_table_value := 'public.vendors'::regclass;
    elsif p_target_register = 'workers' then
      payload_value := payload_value || jsonb_build_object(
        'dropx_id', coalesce(nullif(p_record ->> 'dropx_id', ''), nullif(p_record ->> 'employee_code', '')),
        'onboarding_status', coalesce(nullif(p_record ->> 'onboarding_status', ''), nullif(p_record ->> 'profile_completion_status', ''), 'pending')
      );
      target_table_value := 'public.workers'::regclass;
    else
      payload_value := payload_value || jsonb_build_object(
        'dropx_id', coalesce(nullif(p_record ->> 'dropx_id', ''), nullif(p_record ->> 'employee_code', '')),
        'onboarding_status', coalesce(nullif(p_record ->> 'onboarding_status', ''), nullif(p_record ->> 'profile_completion_status', ''), 'pending')
      );
      target_table_value := 'public.workforce_helpers'::regclass;
    end if;

    target_id_value := public.upsert_record_from_json(target_table_value, payload_value);

    perform set_config('dropx.routing_skip_sync', 'on', true);
    execute format(
      'update public.%I set is_active = false, updated_at = now() where id = $1 and company_id = $2',
      p_source_register
    ) using source_id_value, company_id_value;
    perform set_config('dropx.routing_skip_sync', 'off', true);
  end if;

  insert into public.person_register_links (
    company_id,
    designation_id,
    source_register,
    source_profile_id,
    target_register,
    target_profile_id,
    compatibility_active,
    updated_at
  ) values (
    company_id_value,
    p_designation_id,
    p_source_register,
    source_id_value,
    p_target_register,
    target_id_value,
    p_source_register <> p_target_register,
    now()
  )
  on conflict (company_id, source_register, source_profile_id) do update
  set designation_id = excluded.designation_id,
      target_register = excluded.target_register,
      target_profile_id = excluded.target_profile_id,
      compatibility_active = excluded.compatibility_active,
      updated_at = now();

  return target_id_value;
end;
$$;

create or replace function public.reconcile_designation_register_route(
  p_company_id uuid,
  p_designation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  route_value record;
  designation_value record;
  source_register_value text;
  source_record_value jsonb;
  moved_count integer := 0;
  retained_count integer := 0;
  failed_count integer := 0;
  failure_samples jsonb := '[]'::jsonb;
begin
  select * into route_value
  from public.resolve_designation_register(p_company_id, p_designation_id, null);
  if route_value.designation_id is null then
    raise exception 'Map this designation to an active register before reconciling.';
  end if;

  select id, code, name into designation_value
  from public.designations
  where id = p_designation_id and company_id = p_company_id;

  foreach source_register_value in array array[
    'employees',
    'contractors',
    'vendors',
    'workers',
    'workforce_helpers',
    'workforce',
    'field_executives'
  ] loop
    for source_record_value in execute case
      when source_register_value in ('employees', 'workforce') then format(
        'select to_jsonb(profile) from public.%I profile where profile.company_id = $1 and profile.designation_id = $2',
        source_register_value
      )
      else format(
        'select to_jsonb(profile) from public.%I profile where profile.company_id = $1 and (upper(profile.designation) = upper($3) or lower(btrim(profile.designation)) = lower(btrim($4)))',
        source_register_value
      )
    end using p_company_id, p_designation_id, designation_value.code, designation_value.name
    loop
      begin
        perform public.route_profile_record(
          source_register_value,
          source_record_value,
          p_designation_id,
          route_value.table_name
        );
        if source_register_value = route_value.table_name then
          retained_count := retained_count + 1;
        else
          moved_count := moved_count + 1;
        end if;
      exception when others then
        failed_count := failed_count + 1;
        if jsonb_array_length(failure_samples) < 10 then
          failure_samples := failure_samples || jsonb_build_array(jsonb_build_object(
            'source_register', source_register_value,
            'source_profile_id', source_record_value ->> 'id',
            'error', sqlerrm
          ));
        end if;
      end;
    end loop;
  end loop;

  return jsonb_build_object(
    'target_register', route_value.table_name,
    'moved', moved_count,
    'retained', retained_count,
    'failed', failed_count,
    'failure_samples', failure_samples,
    'completed_at', now()
  );
end;
$$;

drop trigger if exists workforce_helpers_enforce_designation_register on public.workforce_helpers;
create trigger workforce_helpers_enforce_designation_register
before insert or update of designation
on public.workforce_helpers
for each row execute function public.enforce_designation_register_route();

revoke all on function public.designation_register_counts(uuid) from public, anon, authenticated;
revoke all on function public.enforce_designation_register_route() from public, anon, authenticated;
revoke all on function public.upsert_record_from_json(regclass, jsonb) from public, anon, authenticated;
revoke all on function public.route_profile_record(text, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.reconcile_designation_register_route(uuid, uuid) from public, anon, authenticated;

grant execute on function public.designation_register_counts(uuid) to service_role;
grant execute on function public.upsert_record_from_json(regclass, jsonb) to service_role;
grant execute on function public.route_profile_record(text, jsonb, uuid, text) to service_role;
grant execute on function public.reconcile_designation_register_route(uuid, uuid) to service_role;

notify pgrst, 'reload schema';

commit;
