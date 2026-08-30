begin;

-- Keep every guard from the verified cleanup, but bound each explicit Super
-- Admin invocation so profile delete triggers cannot exceed the API timeout.
-- This migration installs the operation only; it does not mutate live data.
create or replace function public.purge_verified_legacy_workforce_aliases()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_limit constant integer := 100;
  candidate_count integer;
  contractor_count integer;
  executive_count integer;
  deleted_contractors integer;
  deleted_executives integer;
  remaining_aliases integer;
  reference_record record;
  has_reference boolean;
begin
  perform pg_advisory_xact_lock(hashtext('dropx-verified-legacy-workforce-cleanup'));

  create temporary table pg_temp.legacy_workforce_cleanup_candidates (
    company_id uuid not null,
    legacy_profile_type text not null,
    legacy_profile_id uuid not null,
    target_profile_id uuid,
    primary key (company_id, legacy_profile_type, legacy_profile_id)
  ) on commit drop;

  insert into pg_temp.legacy_workforce_cleanup_candidates (
    company_id,
    legacy_profile_type,
    legacy_profile_id,
    target_profile_id
  )
  select candidate.company_id,
    candidate.legacy_profile_type,
    candidate.legacy_profile_id,
    candidate.target_profile_id
  from (
    select contractor.company_id,
      'contractor'::text as legacy_profile_type,
      contractor.id as legacy_profile_id,
      link.target_profile_id
    from public.contractors contractor
    left join public.workforce_identity_links link
      on link.company_id = contractor.company_id
     and link.legacy_profile_type = 'contractor'
     and link.legacy_profile_id = contractor.id
     and link.target_profile_type = 'workforce'
    where exists (
      select 1
      from public.designations designation
      join public.designation_categories category
        on category.id = designation.designation_category_id
       and category.company_id = designation.company_id
      where designation.company_id = contractor.company_id
        and category.people_module = 'delivery_network'
        and (
          upper(btrim(designation.code)) = upper(btrim(contractor.designation))
          or lower(btrim(designation.name)) = lower(btrim(contractor.designation))
        )
    )
    union all
    select executive.company_id,
      'field_executive'::text,
      executive.id,
      link.target_profile_id
    from public.field_executives executive
    left join public.workforce_identity_links link
      on link.company_id = executive.company_id
     and link.legacy_profile_type = 'field_executive'
     and link.legacy_profile_id = executive.id
     and link.target_profile_type = 'workforce'
    where exists (
      select 1
      from public.designations designation
      join public.designation_categories category
        on category.id = designation.designation_category_id
       and category.company_id = designation.company_id
      where designation.company_id = executive.company_id
        and category.people_module = 'delivery_network'
        and (
          upper(btrim(designation.code)) = upper(btrim(executive.designation))
          or lower(btrim(designation.name)) = lower(btrim(executive.designation))
        )
    )
  ) candidate
  order by candidate.company_id, candidate.legacy_profile_type, candidate.legacy_profile_id
  limit batch_limit;

  select count(*),
    count(*) filter (where legacy_profile_type = 'contractor'),
    count(*) filter (where legacy_profile_type = 'field_executive')
  into candidate_count, contractor_count, executive_count
  from pg_temp.legacy_workforce_cleanup_candidates;

  if exists (
    select 1
    from pg_temp.legacy_workforce_cleanup_candidates candidate
    where candidate.target_profile_id is null
       or not exists (
         select 1
         from public.workforce workforce
         join public.designations designation
           on designation.id = workforce.designation_id
          and designation.company_id = workforce.company_id
         join public.designation_categories category
           on category.id = designation.designation_category_id
          and category.company_id = designation.company_id
         where workforce.id = candidate.target_profile_id
           and workforce.company_id = candidate.company_id
           and workforce.source_profile_type = candidate.legacy_profile_type
           and workforce.source_profile_id = candidate.legacy_profile_id
           and category.people_module = 'delivery_network'
       )
  ) then
    raise exception 'Legacy Workforce cleanup blocked: at least one source row has no exact canonical Workforce identity.';
  end if;

  if exists (
    select 1
    from public.mob_app_registration_drafts draft
    join pg_temp.legacy_workforce_cleanup_candidates candidate
      on candidate.company_id = draft.company_id
     and candidate.legacy_profile_type = draft.profile_type
     and candidate.legacy_profile_id = draft.account_id
    left join public.mob_app_registration_drafts canonical
      on canonical.company_id = candidate.company_id
     and canonical.profile_type = 'workforce'
     and canonical.account_id = candidate.target_profile_id
    where canonical.id is null
  ) then
    raise exception 'Legacy Workforce cleanup blocked: a registration draft has no canonical Workforce copy.';
  end if;

  for reference_record in
    select referencing_table.oid::regclass as table_name,
      referencing_column.attname as column_name,
      case referenced_table.relname
        when 'contractors' then 'contractor'
        when 'field_executives' then 'field_executive'
      end as legacy_profile_type
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class referenced_table on referenced_table.oid = constraint_row.confrelid
    join pg_catalog.pg_class referencing_table on referencing_table.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace referencing_namespace on referencing_namespace.oid = referencing_table.relnamespace
    join pg_catalog.pg_attribute referencing_column
      on referencing_column.attrelid = constraint_row.conrelid
     and referencing_column.attnum = constraint_row.conkey[1]
    where constraint_row.contype = 'f'
      and cardinality(constraint_row.conkey) = 1
      and cardinality(constraint_row.confkey) = 1
      and referenced_table.relname in ('contractors', 'field_executives')
      and referencing_namespace.nspname = 'public'
  loop
    execute format(
      'select exists (select 1 from %s item join pg_temp.legacy_workforce_cleanup_candidates candidate on candidate.legacy_profile_type = $1 and candidate.legacy_profile_id = item.%I)',
      reference_record.table_name,
      reference_record.column_name
    ) into has_reference using reference_record.legacy_profile_type;
    if has_reference then
      raise exception 'Legacy Workforce cleanup blocked: %.% still references a legacy % row.',
        reference_record.table_name,
        reference_record.column_name,
        reference_record.legacy_profile_type;
    end if;
  end loop;

  for reference_record in
    select * from (values
      ('mob_app_device_tokens', 'profile_type', 'account_id'),
      ('mob_app_notifications', 'recipient_profile_type', 'recipient_account_id'),
      ('communication_announcement_recipients', 'recipient_profile_type', 'recipient_account_id'),
      ('attendance_punches', 'profile_type', 'account_id'),
      ('attendance_reminder_dispatches', 'profile_type', 'account_id'),
      ('biometric_enrolments', 'profile_type', 'account_id'),
      ('payment_advance_requests', 'profile_type', 'account_id'),
      ('verification_api_audit_logs', 'profile_type', 'account_id'),
      ('attendance_regularization_requests', 'profile_type', 'profile_id'),
      ('attendance_integrity_flags', 'profile_type', 'profile_id'),
      ('attendance_location_reviews', 'profile_type', 'profile_id'),
      ('attendance_location_samples', 'profile_type', 'profile_id'),
      ('people_exception_resolutions', 'profile_type', 'profile_id'),
      ('workforce_agreement_acceptances', 'profile_type', 'profile_id'),
      ('workforce_lifecycle_cases', 'profile_type', 'profile_id'),
      ('workforce_lifecycle_events', 'profile_type', 'profile_id'),
      ('workforce_payout_accounts', 'profile_type', 'profile_id'),
      ('workforce_tracking_trips', 'profile_type', 'profile_id')
    ) as references_to_check(table_name, type_column, id_column)
  loop
    if to_regclass(format('public.%I', reference_record.table_name)) is null then
      continue;
    end if;
    execute format(
      'select exists (select 1 from public.%I item join pg_temp.legacy_workforce_cleanup_candidates candidate on candidate.company_id = item.company_id and candidate.legacy_profile_type = item.%I and candidate.legacy_profile_id = item.%I)',
      reference_record.table_name,
      reference_record.type_column,
      reference_record.id_column
    ) into has_reference;
    if has_reference then
      raise exception 'Legacy Workforce cleanup blocked: %.%/% still contains a legacy identity.',
        reference_record.table_name,
        reference_record.type_column,
        reference_record.id_column;
    end if;
  end loop;

  perform set_config('dropx.routing_skip_sync', 'on', true);

  delete from public.field_executives executive
  using pg_temp.legacy_workforce_cleanup_candidates candidate
  where candidate.legacy_profile_type = 'field_executive'
    and executive.company_id = candidate.company_id
    and executive.id = candidate.legacy_profile_id;
  get diagnostics deleted_executives = row_count;

  delete from public.contractors contractor
  using pg_temp.legacy_workforce_cleanup_candidates candidate
  where candidate.legacy_profile_type = 'contractor'
    and contractor.company_id = candidate.company_id
    and contractor.id = candidate.legacy_profile_id;
  get diagnostics deleted_contractors = row_count;

  if deleted_contractors <> contractor_count or deleted_executives <> executive_count then
    raise exception 'Legacy Workforce cleanup deleted an unexpected row count.';
  end if;

  select count(*) into remaining_aliases
  from (
    select contractor.id
    from public.contractors contractor
    where exists (
      select 1
      from public.designations designation
      join public.designation_categories category
        on category.id = designation.designation_category_id
       and category.company_id = designation.company_id
      where designation.company_id = contractor.company_id
        and category.people_module = 'delivery_network'
        and (
          upper(btrim(designation.code)) = upper(btrim(contractor.designation))
          or lower(btrim(designation.name)) = lower(btrim(contractor.designation))
        )
    )
    union all
    select executive.id
    from public.field_executives executive
    where exists (
      select 1
      from public.designations designation
      join public.designation_categories category
        on category.id = designation.designation_category_id
       and category.company_id = designation.company_id
      where designation.company_id = executive.company_id
        and category.people_module = 'delivery_network'
        and (
          upper(btrim(designation.code)) = upper(btrim(executive.designation))
          or lower(btrim(designation.name)) = lower(btrim(executive.designation))
        )
    )
  ) remaining;

  return jsonb_build_object(
    'verified_candidates', candidate_count,
    'deleted_contractors', deleted_contractors,
    'deleted_field_executives', deleted_executives,
    'canonical_rows_preserved', candidate_count,
    'remaining_aliases', remaining_aliases,
    'batch_limit', batch_limit
  );
end;
$$;

revoke all on function public.purge_verified_legacy_workforce_aliases() from public, anon, authenticated;
grant execute on function public.purge_verified_legacy_workforce_aliases() to service_role;

comment on function public.purge_verified_legacy_workforce_aliases() is
  'Deletes at most 100 verified legacy Workforce aliases per explicit Super Admin invocation after all identity, registration, foreign-key and workflow checks pass.';

notify pgrst, 'reload schema';

commit;
