begin;

-- A designation's legal engagement and its storage destination are separate
-- decisions. Keep the destination on the designation master so registration
-- routing never depends on a role-code list or an implicit fall-through.
alter table public.designations
  add column if not exists profile_destination text;

update public.designations designation
set profile_destination = case
  when category.people_module = 'delivery_network'
    and 'vendors' = any(coalesce(designation.onboarding_categories, array[]::text[]))
    then 'vendors'
  when category.people_module = 'delivery_network'
    then 'workforce'
  when 'employees' = any(coalesce(designation.onboarding_categories, array[]::text[]))
    then 'employees'
  when 'field_executives' = any(coalesce(designation.onboarding_categories, array[]::text[]))
    then 'field_executives'
  when 'contractors' = any(coalesce(designation.onboarding_categories, array[]::text[]))
    then 'contractors'
  when 'workers' = any(coalesce(designation.onboarding_categories, array[]::text[]))
    then 'workers'
  else 'employees'
end
from public.designation_categories category
where category.id = designation.designation_category_id
  and category.company_id = designation.company_id
  and designation.profile_destination is null;

alter table public.designations
  alter column profile_destination set default 'employees',
  alter column profile_destination set not null;

alter table public.designations
  drop constraint if exists designations_profile_destination_check;

alter table public.designations
  add constraint designations_profile_destination_check
  check (profile_destination in (
    'employees',
    'field_executives',
    'contractors',
    'workers',
    'workforce',
    'vendors'
  ));

create or replace function public.validate_designation_profile_destination()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  people_module_value text;
begin
  select category.people_module
  into people_module_value
  from public.designation_categories category
  where category.id = new.designation_category_id
    and category.company_id = new.company_id
    and category.is_active;

  if people_module_value is null then
    raise exception 'An active designation category is required before selecting a profile destination.';
  end if;

  if people_module_value = 'delivery_network'
    and new.profile_destination not in ('workforce', 'vendors') then
    raise exception 'Workforce designations can route only to workforce or vendors.';
  end if;

  if people_module_value = 'people_hr'
    and new.profile_destination not in ('employees', 'field_executives', 'contractors', 'workers') then
    raise exception 'HR designations cannot route to workforce or vendors.';
  end if;

  return new;
end;
$$;

drop trigger if exists designations_validate_profile_destination on public.designations;
create trigger designations_validate_profile_destination
before insert or update of company_id, designation_category_id, profile_destination
on public.designations
for each row execute function public.validate_designation_profile_destination();

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
  designation_category_code text;
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

  select designation.id, category.code, designation.profile_destination
  into designation_id_value, designation_category_code, profile_destination_value
  from public.designations designation
  join public.designation_categories category
    on category.id = designation.designation_category_id
   and category.company_id = designation.company_id
  where designation.company_id = company_id_value
    and designation.is_active
    and (
      upper(designation.code) = upper(designation_value)
      or lower(btrim(designation.name)) = lower(designation_value)
    )
  order by case when lower(btrim(designation.name)) = lower(designation_value) then 0 else 1 end
  limit 1;

  if designation_id_value is null or designation_category_code <> 'workforce' then
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

  if profile_destination_value not in ('workforce', 'vendors') then
    raise exception 'Unsupported Workforce profile destination: %', profile_destination_value;
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

-- Re-route already mirrored profiles only when the master destination changes.
-- Invitation and draft rows remain untouched, so in-progress DropX One
-- registrations continue against their original source profile.
create or replace function public.resync_workforce_designation_destination()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.sync_workforce_legacy_payload(
    'field_executive',
    jsonb_set(to_jsonb(profile), '{designation}', to_jsonb(new.code), true)
  )
  from public.field_executives profile
  where profile.company_id = new.company_id
    and (
      upper(profile.designation) in (upper(old.code), upper(new.code))
      or lower(btrim(profile.designation)) in (lower(btrim(old.name)), lower(btrim(new.name)))
    );

  perform public.sync_workforce_legacy_payload(
    'contractor',
    jsonb_set(to_jsonb(profile), '{designation}', to_jsonb(new.code), true)
  )
  from public.contractors profile
  where profile.company_id = new.company_id
    and (
      upper(profile.designation) in (upper(old.code), upper(new.code))
      or lower(btrim(profile.designation)) in (lower(btrim(old.name)), lower(btrim(new.name)))
    );

  return new;
end;
$$;

drop trigger if exists designations_resync_workforce_destination on public.designations;
create trigger designations_resync_workforce_destination
after update of designation_category_id, profile_destination
on public.designations
for each row
when (
  old.designation_category_id is distinct from new.designation_category_id
  or old.profile_destination is distinct from new.profile_destination
)
execute function public.resync_workforce_designation_destination();

revoke all on function public.validate_designation_profile_destination() from public, anon, authenticated;
revoke all on function public.resync_workforce_designation_destination() from public, anon, authenticated;
revoke all on function public.sync_workforce_legacy_payload(text, jsonb) from public, anon, authenticated;
grant execute on function public.sync_workforce_legacy_payload(text, jsonb) to service_role;

comment on column public.designations.profile_destination is
  'Master-defined canonical profile table used by registration mirroring and reclassification.';

notify pgrst, 'reload schema';

commit;
