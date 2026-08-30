begin;

-- This release installs an explicit reconciliation operation. It deliberately
-- performs no profile updates during schema deployment; Super Admin invokes it
-- after reviewing the live preview.

create or replace function public.reconcile_legacy_workforce_aliases()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_record record;
  reference_record record;
  changed_rows integer;
  reconciled_sources integer := 0;
  direct_reference_count integer := 0;
  polymorphic_reference_count integer := 0;
  unmatched_count integer := 0;
  candidate_count integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('dropx-reconcile-legacy-workforce-aliases'));

  -- First create or repair the exact canonical identity. Only designations
  -- explicitly routed to Workforce are eligible; People and vendor records are
  -- never pulled across a product boundary.
  for source_record in
    select 'contractor'::text as profile_type, to_jsonb(contractor) as payload
    from public.contractors contractor
    where exists (
      select 1
      from public.designations designation
      join public.designation_categories category
        on category.id = designation.designation_category_id
       and category.company_id = designation.company_id
      where designation.company_id = contractor.company_id
        and designation.is_active
        and category.people_module = 'delivery_network'
        and designation.profile_destination = 'workforce'
        and (
          upper(btrim(designation.code)) = upper(btrim(contractor.designation))
          or lower(btrim(designation.name)) = lower(btrim(contractor.designation))
        )
    )
    union all
    select 'field_executive'::text, to_jsonb(executive)
    from public.field_executives executive
    where exists (
      select 1
      from public.designations designation
      join public.designation_categories category
        on category.id = designation.designation_category_id
       and category.company_id = designation.company_id
      where designation.company_id = executive.company_id
        and designation.is_active
        and category.people_module = 'delivery_network'
        and designation.profile_destination = 'workforce'
        and (
          upper(btrim(designation.code)) = upper(btrim(executive.designation))
          or lower(btrim(designation.name)) = lower(btrim(executive.designation))
        )
    )
  loop
    perform public.sync_workforce_legacy_payload(source_record.profile_type, source_record.payload);
    reconciled_sources := reconciled_sources + 1;
  end loop;

  create temporary table pg_temp.reconciled_workforce_links (
    company_id uuid not null,
    legacy_profile_type text not null,
    legacy_profile_id uuid not null,
    target_profile_id uuid not null,
    primary key (company_id, legacy_profile_type, legacy_profile_id)
  ) on commit drop;

  insert into pg_temp.reconciled_workforce_links
    (company_id, legacy_profile_type, legacy_profile_id, target_profile_id)
  select link.company_id, link.legacy_profile_type, link.legacy_profile_id, link.target_profile_id
  from public.workforce_identity_links link
  join public.workforce workforce
    on workforce.id = link.target_profile_id
   and workforce.company_id = link.company_id
   and workforce.source_profile_type = link.legacy_profile_type
   and workforce.source_profile_id = link.legacy_profile_id
  where link.compatibility_active
    and link.target_profile_type = 'workforce'
    and (
      (link.legacy_profile_type = 'contractor' and exists (
        select 1 from public.contractors source_profile
        where source_profile.company_id = link.company_id
          and source_profile.id = link.legacy_profile_id
      ))
      or (link.legacy_profile_type = 'field_executive' and exists (
        select 1 from public.field_executives source_profile
        where source_profile.company_id = link.company_id
          and source_profile.id = link.legacy_profile_id
      ))
    )
    and exists (
      select 1
      from public.designations designation
      join public.designation_categories category
        on category.id = designation.designation_category_id
       and category.company_id = designation.company_id
      where designation.id = workforce.designation_id
        and designation.company_id = workforce.company_id
        and category.people_module = 'delivery_network'
        and designation.profile_destination = 'workforce'
    );

  -- Preserve resumable registrations before changing any legacy identity key.
  insert into public.mob_app_registration_drafts (
    id, company_id, profile_type, account_id, draft_data,
    verification_results, file_paths, created_at, updated_at
  )
  select
    gen_random_uuid(), item.company_id, 'workforce', link.target_profile_id,
    item.draft_data, item.verification_results, item.file_paths,
    item.created_at, item.updated_at
  from public.mob_app_registration_drafts item
  join pg_temp.reconciled_workforce_links link
    on item.company_id = link.company_id
   and item.profile_type = link.legacy_profile_type
   and item.account_id = link.legacy_profile_id
  on conflict (company_id, profile_type, account_id) do update
  set draft_data = case
        when excluded.updated_at >= public.mob_app_registration_drafts.updated_at
          then public.mob_app_registration_drafts.draft_data || excluded.draft_data
        else excluded.draft_data || public.mob_app_registration_drafts.draft_data
      end,
      verification_results = case
        when excluded.updated_at >= public.mob_app_registration_drafts.updated_at
          then excluded.verification_results
        else public.mob_app_registration_drafts.verification_results
      end,
      file_paths = case
        when excluded.updated_at >= public.mob_app_registration_drafts.updated_at
          then public.mob_app_registration_drafts.file_paths || excluded.file_paths
        else excluded.file_paths || public.mob_app_registration_drafts.file_paths
      end,
      created_at = least(public.mob_app_registration_drafts.created_at, excluded.created_at),
      updated_at = greatest(public.mob_app_registration_drafts.updated_at, excluded.updated_at);

  insert into public.connect_profile_verifications (
    id, company_id, profile_type, account_id, kind, input_key,
    verified, manual_review, block_submit, display_name, message,
    details, verified_at, created_at, updated_at
  )
  select
    gen_random_uuid(), item.company_id, 'workforce', link.target_profile_id,
    item.kind, item.input_key, item.verified, item.manual_review,
    item.block_submit, item.display_name, item.message, item.details,
    item.verified_at, item.created_at, item.updated_at
  from public.connect_profile_verifications item
  join pg_temp.reconciled_workforce_links link
    on item.company_id = link.company_id
   and item.profile_type = link.legacy_profile_type
   and item.account_id = link.legacy_profile_id
  on conflict (company_id, profile_type, account_id, kind) do update
  set input_key = excluded.input_key,
      verified = excluded.verified,
      manual_review = excluded.manual_review,
      block_submit = excluded.block_submit,
      display_name = excluded.display_name,
      message = excluded.message,
      details = excluded.details,
      verified_at = excluded.verified_at,
      created_at = least(public.connect_profile_verifications.created_at, excluded.created_at),
      updated_at = excluded.updated_at
  where excluded.updated_at >= public.connect_profile_verifications.updated_at;

  -- Move every real foreign key that already has a canonical workforce_id
  -- column. A non-nullable or unmapped reference is deliberately left in place
  -- and reported below, so the final purge remains fail-closed.
  for reference_record in
    select referencing_table.oid::regclass as table_name,
      referencing_column.attname as column_name,
      case referenced_table.relname
        when 'contractors' then 'contractor'
        when 'field_executives' then 'field_executive'
      end as legacy_profile_type,
      referencing_column.attnotnull as is_not_null,
      exists (
        select 1
        from pg_catalog.pg_attribute workforce_column
        where workforce_column.attrelid = referencing_table.oid
          and workforce_column.attname = 'workforce_id'
          and not workforce_column.attisdropped
      ) as has_workforce_id
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
    if reference_record.has_workforce_id and not reference_record.is_not_null then
      execute format(
        'update %s item set workforce_id = link.target_profile_id, %I = null from pg_temp.reconciled_workforce_links link where link.legacy_profile_type = $1 and item.%I = link.legacy_profile_id',
        reference_record.table_name,
        reference_record.column_name,
        reference_record.column_name
      ) using reference_record.legacy_profile_type;
    end if;
  end loop;

  update public.mob_app_user_preferences item
  set default_profile_type = 'workforce',
      default_account_id = link.target_profile_id,
      updated_at = now()
  from pg_temp.reconciled_workforce_links link
  where item.default_company_id = link.company_id
    and item.default_profile_type = link.legacy_profile_type
    and item.default_account_id = link.legacy_profile_id;

  insert into public.mob_app_device_tokens (
    id, company_id, profile_type, account_id, platform, device_id,
    push_token, app_version, is_active, last_seen_at, created_at, updated_at
  )
  select
    gen_random_uuid(), item.company_id, 'workforce', link.target_profile_id,
    item.platform, item.device_id, item.push_token, item.app_version,
    item.is_active, item.last_seen_at, item.created_at, item.updated_at
  from public.mob_app_device_tokens item
  join pg_temp.reconciled_workforce_links link
    on item.company_id = link.company_id
   and item.profile_type = link.legacy_profile_type
   and item.account_id = link.legacy_profile_id
  on conflict (company_id, profile_type, account_id, device_id) do update
  set push_token = excluded.push_token,
      app_version = excluded.app_version,
      is_active = excluded.is_active,
      last_seen_at = greatest(public.mob_app_device_tokens.last_seen_at, excluded.last_seen_at),
      updated_at = greatest(public.mob_app_device_tokens.updated_at, excluded.updated_at);

  delete from public.mob_app_device_tokens item
  using pg_temp.reconciled_workforce_links link
  where item.company_id = link.company_id
    and item.profile_type = link.legacy_profile_type
    and item.account_id = link.legacy_profile_id;

  -- Re-key the remaining polymorphic history. These statements are idempotent
  -- and preserve the original business rows, timestamps and approval state.
  update public.mob_app_notifications item set recipient_profile_type = 'workforce', recipient_account_id = link.target_profile_id
  from pg_temp.reconciled_workforce_links link where item.company_id = link.company_id and item.recipient_profile_type = link.legacy_profile_type and item.recipient_account_id = link.legacy_profile_id;
  update public.communication_announcement_recipients item set recipient_profile_type = 'workforce', recipient_account_id = link.target_profile_id
  from pg_temp.reconciled_workforce_links link where item.company_id = link.company_id and item.recipient_profile_type = link.legacy_profile_type and item.recipient_account_id = link.legacy_profile_id;
  update public.attendance_punches item set profile_type = 'workforce', account_id = link.target_profile_id, field_executive_id = null, contractor_id = null
  from pg_temp.reconciled_workforce_links link where item.company_id = link.company_id and item.profile_type = link.legacy_profile_type and item.account_id = link.legacy_profile_id;
  update public.attendance_reminder_dispatches item set profile_type = 'workforce', account_id = link.target_profile_id
  from pg_temp.reconciled_workforce_links link where item.company_id = link.company_id and item.profile_type = link.legacy_profile_type and item.account_id = link.legacy_profile_id;
  update public.biometric_enrolments item set profile_type = 'workforce', account_id = link.target_profile_id, field_executive_id = null, contractor_id = null, updated_at = now()
  from pg_temp.reconciled_workforce_links link where item.company_id = link.company_id and item.profile_type = link.legacy_profile_type and item.account_id = link.legacy_profile_id;
  update public.payment_advance_requests item set profile_type = 'workforce', account_id = link.target_profile_id, updated_at = now()
  from pg_temp.reconciled_workforce_links link where item.company_id = link.company_id and item.profile_type = link.legacy_profile_type and item.account_id = link.legacy_profile_id;
  update public.verification_api_audit_logs item set profile_type = 'workforce', account_id = link.target_profile_id
  from pg_temp.reconciled_workforce_links link where item.company_id = link.company_id and item.profile_type = link.legacy_profile_type and item.account_id = link.legacy_profile_id;
  update public.attendance_regularization_requests item set profile_type = 'workforce', profile_id = link.target_profile_id, updated_at = now()
  from pg_temp.reconciled_workforce_links link where item.company_id = link.company_id and item.profile_type = link.legacy_profile_type and item.profile_id = link.legacy_profile_id;
  update public.attendance_integrity_flags item set profile_type = 'workforce', profile_id = link.target_profile_id, updated_at = now()
  from pg_temp.reconciled_workforce_links link where item.company_id = link.company_id and item.profile_type = link.legacy_profile_type and item.profile_id = link.legacy_profile_id;
  update public.attendance_location_reviews item set profile_type = 'workforce', profile_id = link.target_profile_id, updated_at = now()
  from pg_temp.reconciled_workforce_links link where item.company_id = link.company_id and item.profile_type = link.legacy_profile_type and item.profile_id = link.legacy_profile_id;
  update public.attendance_location_samples item set profile_type = 'workforce', profile_id = link.target_profile_id
  from pg_temp.reconciled_workforce_links link where item.company_id = link.company_id and item.profile_type = link.legacy_profile_type and item.profile_id = link.legacy_profile_id;
  update public.people_exception_resolutions item set profile_type = 'workforce', profile_id = link.target_profile_id
  from pg_temp.reconciled_workforce_links link where item.company_id = link.company_id and item.profile_type = link.legacy_profile_type and item.profile_id = link.legacy_profile_id;
  update public.workforce_agreement_acceptances item set profile_type = 'workforce', profile_id = link.target_profile_id, field_executive_id = null
  from pg_temp.reconciled_workforce_links link where item.company_id = link.company_id and item.profile_type = link.legacy_profile_type and item.profile_id = link.legacy_profile_id;
  update public.workforce_lifecycle_cases item set profile_type = 'workforce', profile_id = link.target_profile_id, field_executive_id = null, updated_at = now()
  from pg_temp.reconciled_workforce_links link where item.company_id = link.company_id and item.profile_type = link.legacy_profile_type and item.profile_id = link.legacy_profile_id;
  update public.workforce_lifecycle_events item set profile_type = 'workforce', profile_id = link.target_profile_id, field_executive_id = null
  from pg_temp.reconciled_workforce_links link where item.company_id = link.company_id and item.profile_type = link.legacy_profile_type and item.profile_id = link.legacy_profile_id;
  update public.workforce_payout_accounts item set profile_type = 'workforce', profile_id = link.target_profile_id, updated_at = now()
  from pg_temp.reconciled_workforce_links link where item.company_id = link.company_id and item.profile_type = link.legacy_profile_type and item.profile_id = link.legacy_profile_id;
  update public.workforce_tracking_trips item set profile_type = 'workforce', profile_id = link.target_profile_id, updated_at = now()
  from pg_temp.reconciled_workforce_links link where item.company_id = link.company_id and item.profile_type = link.legacy_profile_type and item.profile_id = link.legacy_profile_id;

  -- Return a complete fail-closed readiness summary for the UI.
  select count(*) into candidate_count
  from (
    select contractor.company_id, contractor.id
    from public.contractors contractor
    where exists (
      select 1 from public.designations designation
      join public.designation_categories category on category.id = designation.designation_category_id and category.company_id = designation.company_id
      where designation.company_id = contractor.company_id and category.people_module = 'delivery_network'
        and designation.profile_destination = 'workforce'
        and (upper(btrim(designation.code)) = upper(btrim(contractor.designation)) or lower(btrim(designation.name)) = lower(btrim(contractor.designation)))
    )
    union all
    select executive.company_id, executive.id
    from public.field_executives executive
    where exists (
      select 1 from public.designations designation
      join public.designation_categories category on category.id = designation.designation_category_id and category.company_id = designation.company_id
      where designation.company_id = executive.company_id and category.people_module = 'delivery_network'
        and designation.profile_destination = 'workforce'
        and (upper(btrim(designation.code)) = upper(btrim(executive.designation)) or lower(btrim(designation.name)) = lower(btrim(executive.designation)))
    )
  ) candidates;

  unmatched_count := candidate_count - (select count(*) from pg_temp.reconciled_workforce_links);

  for reference_record in
    select referencing_table.oid::regclass as table_name,
      referencing_column.attname as column_name,
      case referenced_table.relname when 'contractors' then 'contractor' when 'field_executives' then 'field_executive' end as legacy_profile_type
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class referenced_table on referenced_table.oid = constraint_row.confrelid
    join pg_catalog.pg_class referencing_table on referencing_table.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace referencing_namespace on referencing_namespace.oid = referencing_table.relnamespace
    join pg_catalog.pg_attribute referencing_column on referencing_column.attrelid = constraint_row.conrelid and referencing_column.attnum = constraint_row.conkey[1]
    where constraint_row.contype = 'f' and cardinality(constraint_row.conkey) = 1 and cardinality(constraint_row.confkey) = 1
      and referenced_table.relname in ('contractors', 'field_executives') and referencing_namespace.nspname = 'public'
  loop
    execute format(
      'select count(*) from %s item join pg_temp.reconciled_workforce_links link on link.legacy_profile_type = $1 and item.%I = link.legacy_profile_id',
      reference_record.table_name,
      reference_record.column_name
    ) into changed_rows using reference_record.legacy_profile_type;
    direct_reference_count := direct_reference_count + changed_rows;
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
    if to_regclass(format('public.%I', reference_record.table_name)) is null then continue; end if;
    execute format(
      'select count(*) from public.%I item join pg_temp.reconciled_workforce_links link on item.company_id = link.company_id and item.%I = link.legacy_profile_type and item.%I = link.legacy_profile_id',
      reference_record.table_name, reference_record.type_column, reference_record.id_column
    ) into changed_rows;
    polymorphic_reference_count := polymorphic_reference_count + changed_rows;
  end loop;

  return jsonb_build_object(
    'reconciled_sources', reconciled_sources,
    'eligible_legacy_rows', candidate_count,
    'exact_canonical_links', candidate_count - unmatched_count,
    'unmatched_rows', unmatched_count,
    'remaining_direct_foreign_keys', direct_reference_count,
    'remaining_polymorphic_references', polymorphic_reference_count,
    'ready_for_verified_purge', unmatched_count = 0 and direct_reference_count = 0 and polymorphic_reference_count = 0
  );
end;
$$;

revoke all on function public.reconcile_legacy_workforce_aliases() from public, anon, authenticated;
grant execute on function public.reconcile_legacy_workforce_aliases() to service_role;

comment on function public.reconcile_legacy_workforce_aliases() is
  'Explicit SuperAdmin operation that preserves drafts/history, re-keys exact Workforce identities, and reports fail-closed purge readiness.';

notify pgrst, 'reload schema';

commit;
