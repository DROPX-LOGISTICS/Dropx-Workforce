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
  existing_ids jsonb;
  proposed_ids jsonb;
  merged_configs jsonb;
begin
  select *
    into selected_setting
    from public.dropx_id_generation_settings
   where company_id = p_company_id
     and setting_type = p_setting_type
   limit 1
   for update;

  if not found or not selected_setting.is_locked or selected_setting.scope_type <> 'multi_designation' then
    raise exception 'Only a locked Multi Designation Wise setting can use this mapping update.';
  end if;

  if (select array_agg(key order by key) from jsonb_object_keys(selected_setting.configs) key)
     is distinct from
     (select array_agg(key order by key) from jsonb_object_keys(p_configs) key) then
    raise exception 'Series cannot be added or removed after ID generation has started.';
  end if;

  for selected_key in select jsonb_object_keys(selected_setting.configs)
  loop
    if (selected_setting.configs -> selected_key) - 'designation_ids'
       is distinct from
       (p_configs -> selected_key) - 'designation_ids' then
      raise exception 'Series structure and counters cannot be changed after ID generation has started.';
    end if;

    existing_ids := coalesce(selected_setting.configs -> selected_key -> 'designation_ids', '[]'::jsonb);
    proposed_ids := coalesce(p_configs -> selected_key -> 'designation_ids', '[]'::jsonb);
    if not proposed_ids @> existing_ids then
      raise exception 'Existing designation mappings cannot be removed or moved after ID generation has started.';
    end if;
  end loop;

  if exists (
    select designation_id
      from jsonb_each(p_configs) series
      cross join lateral jsonb_array_elements_text(coalesce(series.value -> 'designation_ids', '[]'::jsonb)) as mapped(designation_id)
     group by designation_id
    having count(*) > 1
  ) then
    raise exception 'A designation cannot be mapped to more than one series.';
  end if;

  if exists (
    with proposed as (
      select distinct designation_id
        from jsonb_each(p_configs) series
        cross join lateral jsonb_array_elements_text(coalesce(series.value -> 'designation_ids', '[]'::jsonb)) as mapped(designation_id)
    ), existing as (
      select distinct designation_id
        from jsonb_each(selected_setting.configs) series
        cross join lateral jsonb_array_elements_text(coalesce(series.value -> 'designation_ids', '[]'::jsonb)) as mapped(designation_id)
    )
    select 1
      from proposed
      left join existing using (designation_id)
      left join public.designations designations
        on designations.id::text = proposed.designation_id
       and designations.company_id = p_company_id
       and designations.is_active = true
     where existing.designation_id is null
       and designations.id is null
  ) then
    raise exception 'One or more new designations are not active for this company.';
  end if;

  select jsonb_object_agg(
           series.key,
           jsonb_set(
             series.value,
             '{designation_ids}',
             coalesce(p_configs -> series.key -> 'designation_ids', '[]'::jsonb),
             true
           )
         )
    into merged_configs
    from jsonb_each(selected_setting.configs) series;

  update public.dropx_id_generation_settings
     set configs = merged_configs,
         updated_at = now()
   where id = selected_setting.id;
end;
$$;

grant execute on function public.update_locked_multi_designation_mappings(uuid, text, jsonb) to service_role;
