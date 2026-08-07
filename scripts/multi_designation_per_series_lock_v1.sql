-- Lock only the Multi Designation Wise series that has generated an ID.
-- Legacy locked configurations did not store a per-series flag, so their existing
-- series remain locked; every newly added series starts editable.

update public.dropx_id_generation_settings settings
set configs = (
  select jsonb_object_agg(series.key, series.value || jsonb_build_object(
    'is_locked', case when series.value ? 'is_locked' then (series.value ->> 'is_locked')::boolean else settings.is_locked end
  ))
  from jsonb_each(settings.configs) series
)
where settings.scope_type = 'multi_designation';

create or replace function public.generate_configured_worker_id(
  p_company_id uuid,
  p_setting_type text,
  p_category text,
  p_location_id uuid default null,
  p_model_id uuid default null,
  p_designation_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_setting public.dropx_id_generation_settings%rowtype;
  selected_key text;
  selected_config jsonb;
  selected_prefix text;
  selected_separator text;
  selected_suffix text;
  selected_serial integer;
  selected_digits integer;
  serial_text text;
  generated_id text;
begin
  select * into selected_setting
  from public.dropx_id_generation_settings
  where company_id = p_company_id and setting_type = p_setting_type and is_active = true
  limit 1 for update;
  if not found then return null; end if;

  selected_key := case selected_setting.scope_type
    when 'designation' then p_designation_id::text
    when 'multi_designation' then (
      select entry.key from jsonb_each(selected_setting.configs) entry
      where entry.value -> 'designation_ids' ? p_designation_id::text limit 1
    )
    when 'location' then p_location_id::text
    when 'model' then p_model_id::text
    when 'company' then 'company'
    else p_category
  end;
  if selected_key is null or selected_key = '' then return null; end if;
  selected_config := selected_setting.configs -> selected_key;
  if selected_config is null then return null; end if;

  selected_prefix := nullif(selected_config ->> 'prefix', '');
  selected_separator := coalesce(selected_config ->> 'separator', '');
  selected_suffix := nullif(selected_config ->> 'suffix', '');
  selected_serial := greatest(coalesce((selected_config ->> 'next_serial_no')::integer, 1), 1);
  selected_digits := least(greatest(coalesce((selected_config ->> 'serial_digits')::integer, 3), 1), 12);
  serial_text := lpad(selected_serial::text, selected_digits, '0');
  generated_id := coalesce(selected_prefix, '') ||
    case when coalesce(selected_prefix, '') <> '' then selected_separator else '' end || serial_text ||
    case when coalesce(selected_suffix, '') <> '' then selected_separator || selected_suffix else '' end;

  update public.dropx_id_generation_settings
  set configs = case when selected_setting.scope_type = 'multi_designation' then
        jsonb_set(
          jsonb_set(configs, array[selected_key, 'next_serial_no'], to_jsonb(selected_serial + 1), true),
          array[selected_key, 'is_locked'], 'true'::jsonb, true
        )
      else jsonb_set(configs, array[selected_key, 'next_serial_no'], to_jsonb(selected_serial + 1), true)
      end,
      is_locked = true,
      updated_at = now()
  where id = selected_setting.id;
  return generated_id;
end;
$$;

grant execute on function public.generate_configured_worker_id(uuid, text, text, uuid, uuid, uuid) to service_role;

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
begin
  select * into selected_setting
  from public.dropx_id_generation_settings
  where company_id = p_company_id and setting_type = p_setting_type
  limit 1 for update;

  if not found or not selected_setting.is_locked or selected_setting.scope_type <> 'multi_designation' then
    raise exception 'Only a locked Multi Designation Wise setting can use this update.';
  end if;

  for selected_key, existing_config in select key, value from jsonb_each(selected_setting.configs)
  loop
    if coalesce((existing_config ->> 'is_locked')::boolean, true) then
      proposed_config := p_configs -> selected_key;
      if proposed_config is null then
        raise exception 'A series that has generated an ID cannot be removed.';
      end if;
      if (existing_config - 'designation_ids' - 'is_locked') is distinct from (proposed_config - 'designation_ids' - 'is_locked') then
        raise exception 'A series that has generated an ID cannot be edited.';
      end if;
      existing_ids := coalesce(existing_config -> 'designation_ids', '[]'::jsonb);
      proposed_ids := coalesce(proposed_config -> 'designation_ids', '[]'::jsonb);
      if not proposed_ids @> existing_ids then
        raise exception 'Existing designation mappings cannot be removed from a locked series.';
      end if;
    end if;
  end loop;

  if exists (
    select designation_id
    from jsonb_each(p_configs) series
    cross join lateral jsonb_array_elements_text(coalesce(series.value -> 'designation_ids', '[]'::jsonb)) mapped(designation_id)
    group by designation_id having count(*) > 1
  ) then
    raise exception 'A designation cannot be mapped to more than one series.';
  end if;

  update public.dropx_id_generation_settings
  set configs = p_configs, updated_at = now()
  where id = selected_setting.id;
end;
$$;

grant execute on function public.update_locked_multi_designation_mappings(uuid, text, jsonb) to service_role;
