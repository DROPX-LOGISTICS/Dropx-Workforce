begin;

-- Resolve a designation by its owning product, not by a hardcoded category
-- code. This prevents a same-named People designation from intercepting a
-- Workforce registration and lets category codes remain admin-configurable.
create or replace function public.sync_workforce_legacy_payload(
  p_source_profile_type text,
  p_record jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  company_id_value uuid;
  source_id_value uuid;
  designation_value text;
  designation_id_value uuid;
  designation_people_module text;
  profile_destination_value text;
  delivery_associate_id_value uuid;
  target_id_value uuid;
  target_profile_type_value text;
  previous_target_profile_type_value text;
  previous_target_profile_id_value uuid;
  workforce_payload jsonb;
begin
  if p_source_profile_type not in ('field_executive', 'contractor') then
    raise exception 'Unsupported legacy Workforce source: %', p_source_profile_type;
  end if;

  company_id_value := nullif(p_record ->> 'company_id', '')::uuid;
  source_id_value := nullif(p_record ->> 'id', '')::uuid;
  designation_value := btrim(coalesce(p_record ->> 'designation', ''));

  if company_id_value is null or source_id_value is null or designation_value = '' then
    return null;
  end if;

  select designation.id, category.people_module, designation.profile_destination
  into designation_id_value, designation_people_module, profile_destination_value
  from public.designations designation
  join public.designation_categories category
    on category.id = designation.designation_category_id
   and category.company_id = designation.company_id
  where designation.company_id = company_id_value
    and designation.is_active
    and category.is_active
    and category.people_module = 'delivery_network'
    and designation.profile_destination in ('workforce', 'vendors')
    and (
      upper(btrim(designation.code)) = upper(designation_value)
      or lower(btrim(designation.name)) = lower(designation_value)
    )
  order by case when lower(btrim(designation.name)) = lower(designation_value) then 0 else 1 end,
    designation.updated_at desc nulls last,
    designation.id
  limit 1;

  if designation_id_value is null or designation_people_module <> 'delivery_network' then
    update public.workforce
    set migration_state = 'reclassified',
        compatibility_mode = false,
        is_active = false,
        synced_at = now(),
        updated_at = now()
    where company_id = company_id_value
      and source_profile_type = p_source_profile_type
      and source_profile_id = source_id_value;

    update public.workforce_identity_links
    set compatibility_active = false,
        updated_at = now()
    where company_id = company_id_value
      and legacy_profile_type = p_source_profile_type
      and legacy_profile_id = source_id_value;
    return null;
  end if;

  select link.target_profile_type, link.target_profile_id
  into previous_target_profile_type_value, previous_target_profile_id_value
  from public.workforce_identity_links link
  where link.company_id = company_id_value
    and link.legacy_profile_type = p_source_profile_type
    and link.legacy_profile_id = source_id_value;

  select associate.id
  into delivery_associate_id_value
  from public.delivery_associates associate
  where nullif(p_record ->> 'dropx_id', '') is not null
    and upper(associate.dropx_id) = upper(p_record ->> 'dropx_id')
  limit 1;

  if profile_destination_value = 'vendors' then
    target_profile_type_value := 'vendor';
    target_id_value := public.upsert_record_from_json('public.vendors'::regclass, p_record);

    update public.workforce
    set migration_state = 'moved_to_vendor',
        compatibility_mode = true,
        is_active = false,
        synced_at = now(),
        updated_at = now()
    where company_id = company_id_value
      and source_profile_type = p_source_profile_type
      and source_profile_id = source_id_value;
  else
    target_profile_type_value := 'workforce';
    workforce_payload := p_record || jsonb_build_object(
      'source_profile_type', p_source_profile_type,
      'source_profile_id', source_id_value,
      'designation_id', designation_id_value,
      'delivery_associate_id', delivery_associate_id_value,
      'approval_required', coalesce((p_record ->> 'approval_required')::boolean, true),
      'provider_id_status', coalesce(nullif(p_record ->> 'provider_id_status', ''), 'pending'),
      'compatibility_mode', true,
      'migration_state', 'mirrored',
      'synced_at', now()
    );
    target_id_value := public.upsert_record_from_json('public.workforce'::regclass, workforce_payload);

    if previous_target_profile_type_value = 'vendor' then
      update public.vendors
      set is_active = false,
          updated_at = now()
      where id = previous_target_profile_id_value
        and company_id = company_id_value;
    end if;
  end if;

  insert into public.workforce_identity_links (
    company_id,
    target_profile_type,
    target_profile_id,
    legacy_profile_type,
    legacy_profile_id,
    delivery_associate_id,
    compatibility_active,
    updated_at
  )
  values (
    company_id_value,
    target_profile_type_value,
    target_id_value,
    p_source_profile_type,
    source_id_value,
    delivery_associate_id_value,
    true,
    now()
  )
  on conflict (company_id, legacy_profile_type, legacy_profile_id) do update
  set target_profile_type = excluded.target_profile_type,
      target_profile_id = excluded.target_profile_id,
      delivery_associate_id = excluded.delivery_associate_id,
      compatibility_active = true,
      updated_at = now();

  return target_id_value;
end;
$$;

revoke all on function public.sync_workforce_legacy_payload(text, jsonb) from public, anon, authenticated;
grant execute on function public.sync_workforce_legacy_payload(text, jsonb) to service_role;

notify pgrst, 'reload schema';

commit;
