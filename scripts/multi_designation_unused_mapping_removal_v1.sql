create or replace function public.multi_designation_has_generated_id(
  p_company_id uuid,
  p_setting_type text,
  p_designation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  designation_code text;
  designation_name text;
  id_exists boolean;
begin
  select code, name into designation_code, designation_name
  from public.designations
  where id = p_designation_id and company_id = p_company_id;
  if not found then return false; end if;

  if p_setting_type = 'dropx_id' then
    select exists (
      select 1 from public.employees
      where company_id = p_company_id and designation_id = p_designation_id and nullif(employee_code, '') is not null
      union all
      select 1 from public.field_executives
      where company_id = p_company_id and (designation = designation_name or designation = designation_code) and nullif(dropx_id, '') is not null
      union all
      select 1 from public.contractors
      where company_id = p_company_id and (designation = designation_name or designation = designation_code) and nullif(dropx_id, '') is not null
      union all
      select 1 from public.vendors
      where company_id = p_company_id and (designation = designation_name or designation = designation_code) and nullif(dropx_id, '') is not null
      union all
      select 1 from public.workers
      where company_id = p_company_id and (designation = designation_name or designation = designation_code) and nullif(dropx_id, '') is not null
    ) into id_exists;
  else
    select exists (
      select 1 from public.employees
      where company_id = p_company_id and designation_id = p_designation_id and nullif(biometric_id, '') is not null
      union all
      select 1 from public.field_executives
      where company_id = p_company_id and (designation = designation_name or designation = designation_code) and nullif(biometric_id, '') is not null
      union all
      select 1 from public.contractors
      where company_id = p_company_id and (designation = designation_name or designation = designation_code) and nullif(biometric_id, '') is not null
      union all
      select 1 from public.vendors
      where company_id = p_company_id and (designation = designation_name or designation = designation_code) and nullif(biometric_id, '') is not null
      union all
      select 1 from public.workers
      where company_id = p_company_id and (designation = designation_name or designation = designation_code) and nullif(biometric_id, '') is not null
    ) into id_exists;
  end if;
  return coalesce(id_exists, false);
end;
$$;

revoke all on function public.multi_designation_has_generated_id(uuid, text, uuid) from public;
grant execute on function public.multi_designation_has_generated_id(uuid, text, uuid) to service_role;

create or replace function public.update_locked_multi_designation_mappings(
  p_company_id uuid,
  p_setting_type text,
  p_configs jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_setting public.dropx_id_generation_settings%rowtype;
  selected_key text;
  existing_config jsonb;
  proposed_config jsonb;
  existing_ids jsonb;
  proposed_ids jsonb;
  removed_designation_id text;
begin
  select * into selected_setting from public.dropx_id_generation_settings
  where company_id = p_company_id and setting_type = p_setting_type limit 1 for update;
  if not found or not selected_setting.is_locked or selected_setting.scope_type <> 'multi_designation' then
    raise exception 'Only a locked Multi Designation Wise setting can use this update.';
  end if;

  for selected_key, existing_config in select key, value from jsonb_each(selected_setting.configs)
  loop
    if coalesce((existing_config ->> 'is_locked')::boolean, true) then
      proposed_config := p_configs -> selected_key;
      if proposed_config is null then raise exception 'A series that has generated an ID cannot be removed.'; end if;
      if (existing_config - 'designation_ids' - 'is_locked') is distinct from (proposed_config - 'designation_ids' - 'is_locked') then
        raise exception 'A series that has generated an ID cannot be edited.';
      end if;
      existing_ids := coalesce(existing_config -> 'designation_ids', '[]'::jsonb);
      proposed_ids := coalesce(proposed_config -> 'designation_ids', '[]'::jsonb);
      for removed_designation_id in
        select value from jsonb_array_elements_text(existing_ids)
        except select value from jsonb_array_elements_text(proposed_ids)
      loop
        if public.multi_designation_has_generated_id(p_company_id, p_setting_type, removed_designation_id::uuid) then
          raise exception 'This designation cannot be removed because an ID has already been generated for it.';
        end if;
      end loop;
    end if;
  end loop;

  if exists (
    select designation_id from jsonb_each(p_configs) series
    cross join lateral jsonb_array_elements_text(coalesce(series.value -> 'designation_ids', '[]'::jsonb)) mapped(designation_id)
    group by designation_id having count(*) > 1
  ) then raise exception 'A designation cannot be mapped to more than one series.'; end if;

  update public.dropx_id_generation_settings set configs = p_configs, updated_at = now()
  where id = selected_setting.id;
end;
$$;

grant execute on function public.update_locked_multi_designation_mappings(uuid, text, jsonb) to service_role;
