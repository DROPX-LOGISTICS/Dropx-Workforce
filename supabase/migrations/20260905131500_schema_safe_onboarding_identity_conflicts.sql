begin;

-- Canonical registers were created at different times and do not all expose
-- the same lifecycle columns. Identity checks must inspect the live schema
-- instead of assuming optional columns such as deleted_at exist everywhere.
create or replace function public.onboarding_identity_conflicts(
  p_company_id uuid,
  p_mobile text,
  p_exclude_source text default null,
  p_exclude_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_mobile_value text := public.normalize_onboarding_mobile(p_mobile);
  register record;
  register_relation regclass;
  register_matches jsonb;
  result jsonb := '[]'::jsonb;
  has_designation_id boolean;
  has_designation_text boolean;
  has_deleted_at boolean;
  has_onboarding_status boolean;
  designation_join text;
  designation_name_expression text;
  status_expression text;
  deleted_filter text;
begin
  if p_company_id is null or normalized_mobile_value = '' then return result; end if;

  for register in
    select source_name
    from unnest(array[
      'employees',
      'contractors',
      'workforce',
      'field_executives',
      'vendors',
      'workers',
      'workforce_helpers'
    ]::text[]) as source_name
  loop
    register_relation := pg_catalog.to_regclass('public.' || register.source_name);
    if register_relation is null then continue; end if;

    -- Skip an old compatibility relation if it lacks a required identity
    -- field. Optional lifecycle and designation fields are handled below.
    if exists (
      select 1
      from unnest(array['id','company_id','full_name','mobile','is_active']::text[]) required_column
      where not exists (
        select 1
        from pg_catalog.pg_attribute attribute
        where attribute.attrelid = register_relation
          and attribute.attname = required_column
          and attribute.attnum > 0
          and not attribute.attisdropped
      )
    ) then
      continue;
    end if;

    select exists (
      select 1 from pg_catalog.pg_attribute attribute
      where attribute.attrelid = register_relation
        and attribute.attname = 'designation_id'
        and attribute.attnum > 0 and not attribute.attisdropped
    ) into has_designation_id;
    select exists (
      select 1 from pg_catalog.pg_attribute attribute
      where attribute.attrelid = register_relation
        and attribute.attname = 'designation'
        and attribute.attnum > 0 and not attribute.attisdropped
    ) into has_designation_text;
    select exists (
      select 1 from pg_catalog.pg_attribute attribute
      where attribute.attrelid = register_relation
        and attribute.attname = 'deleted_at'
        and attribute.attnum > 0 and not attribute.attisdropped
    ) into has_deleted_at;
    select exists (
      select 1 from pg_catalog.pg_attribute attribute
      where attribute.attrelid = register_relation
        and attribute.attname = 'onboarding_status'
        and attribute.attnum > 0 and not attribute.attisdropped
    ) into has_onboarding_status;

    if has_designation_id then
      designation_join := 'left join public.designations designation on designation.company_id = profile.company_id and designation.id = profile.designation_id';
      designation_name_expression := case when has_designation_text
        then 'coalesce(designation.name, profile.designation)'
        else 'designation.name'
      end;
    elsif has_designation_text then
      designation_join := 'left join public.designations designation on designation.company_id = profile.company_id and (lower(designation.name) = lower(profile.designation) or lower(designation.code) = lower(profile.designation))';
      designation_name_expression := 'coalesce(designation.name, profile.designation)';
    else
      designation_join := 'left join public.designations designation on false';
      designation_name_expression := 'null::text';
    end if;

    status_expression := case when has_onboarding_status
      then 'coalesce(profile.onboarding_status, case when profile.is_active then ''active'' else ''inactive'' end)'
      else 'case when profile.is_active then ''active'' else ''inactive'' end'
    end;
    deleted_filter := case when has_deleted_at
      then 'and profile.deleted_at is null'
      else ''
    end;

    execute format($query$
      select coalesce(jsonb_agg(jsonb_build_object(
        'source_type', %1$L,
        'source_id', profile.id,
        'display_name', profile.full_name,
        'designation_id', designation.id,
        'designation_code', designation.code,
        'designation_name', %2$s,
        'profile_status', %3$s
      ) order by profile.full_name), '[]'::jsonb)
      from public.%4$I profile
      %5$s
      where profile.company_id = $1
        %6$s
        and public.normalize_onboarding_mobile(profile.mobile) = $2
        and not (%1$L = coalesce($3, '') and $4 is not null and profile.id = $4)
    $query$,
      register.source_name,
      designation_name_expression,
      status_expression,
      register.source_name,
      designation_join,
      deleted_filter
    ) into register_matches using p_company_id, normalized_mobile_value, p_exclude_source, p_exclude_id;

    result := result || coalesce(register_matches, '[]'::jsonb);
  end loop;

  return result;
end
$$;

revoke all on function public.onboarding_identity_conflicts(uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.onboarding_identity_conflicts(uuid, text, text, uuid)
  to service_role;

comment on function public.onboarding_identity_conflicts(uuid, text, text, uuid) is
  'Checks one mobile across every available canonical register while tolerating optional lifecycle columns and absent compatibility tables.';

notify pgrst, 'reload schema';

commit;
