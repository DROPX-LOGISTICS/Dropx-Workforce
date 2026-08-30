begin;

-- This migration installs a guarded cleanup operation but deliberately does
-- not change profile data. Production cleanup is invoked separately through
-- the Super Admin master after its preview has been reviewed.

create or replace function public.preview_legacy_workforce_alias_cleanup()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with legacy_candidates as (
    select contractor.company_id, 'contractor'::text as legacy_profile_type, contractor.id as legacy_profile_id
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
    select executive.company_id, 'field_executive'::text, executive.id
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
  ), linked as (
    select candidate.*, link.target_profile_id, workforce.id as canonical_id,
      workforce.is_active as canonical_active, workforce.deleted_at as canonical_deleted_at
    from legacy_candidates candidate
    left join public.workforce_identity_links link
      on link.company_id = candidate.company_id
     and link.legacy_profile_type = candidate.legacy_profile_type
     and link.legacy_profile_id = candidate.legacy_profile_id
     and link.target_profile_type = 'workforce'
    left join public.workforce workforce
      on workforce.id = link.target_profile_id
     and workforce.company_id = candidate.company_id
     and workforce.source_profile_type = candidate.legacy_profile_type
     and workforce.source_profile_id = candidate.legacy_profile_id
  )
  select jsonb_build_object(
    'legacy_workforce_rows', count(*),
    'contractor_rows', count(*) filter (where legacy_profile_type = 'contractor'),
    'field_executive_rows', count(*) filter (where legacy_profile_type = 'field_executive'),
    'canonical_rows', count(*) filter (where canonical_id is not null),
    'unmatched_rows', count(*) filter (where canonical_id is null),
    'active_canonical_rows', count(*) filter (where canonical_active and canonical_deleted_at is null)
  )
  from linked;
$$;

create or replace function public.purge_verified_legacy_workforce_aliases()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate_count integer;
  contractor_count integer;
  executive_count integer;
  deleted_contractors integer;
  deleted_executives integer;
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
  select contractor.company_id, 'contractor', contractor.id, link.target_profile_id
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
  select executive.company_id, 'field_executive', executive.id, link.target_profile_id
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
  );

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

  -- Refuse deletion when any real foreign key still points at a candidate.
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

  -- Polymorphic references are not protected by a database foreign key.
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

  return jsonb_build_object(
    'verified_candidates', candidate_count,
    'deleted_contractors', deleted_contractors,
    'deleted_field_executives', deleted_executives,
    'canonical_rows_preserved', candidate_count
  );
end;
$$;

create or replace function public.reconcile_product_role_permission_boundaries()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_count integer;
  granted_count integer;
begin
  with ownership(product_code, page_codes) as (
    values
      ('operations', array[
        'ops_pulse','performance','capacity','capacity_overview','capacity_associates','capacity_delivery','capacity_hiring',
        'ops_reports','ops_attendance_reports','daily_submission','cod','cod_executive_reconciliation','cod_submission',
        'cod_validation','cod_reports','cod_portal_checks','cod_cash_in_associate','edd_dashboard','cps','cps_overview',
        'cps_daily','cps_monthly','cps_cost_breakup','cps_stations','cps_shipments','cps_associates','cps_reports',
        'cps_inputs','cps_unmapped','service_network','service_network_master','master_locations','master_providers',
        'master_models','cod_master','business_documents','master_documents','performance_master','capacity_master','imports',
        'fleet','fleet_action_center','fleet_vehicle_view','fleet_date_view','fleet_station_view','fleet_tracking','fleet_fuel_log',
        'fleet_live_gps','fleet_maintenance','fleet_reports','users'
      ]::text[]),
      ('people', array[
        'people_all','people_review','people_exceptions','employees','attendance_reports','attendance_integrity','inbox',
        'biometric_devices','designations','users'
      ]::text[]),
      ('workforce', array[
        'delivery_associates','executive_id_onboarding','provider_mapping','people_review','workforce_activity',
        'workforce_rate_cards','workforce_earnings','workforce_incentives','workforce_adjustments','workforce_payroll',
        'workforce_communications','workforce_communications_app','workforce_communications_whatsapp',
        'workforce_communications_history','workforce_categories','workforce_whatsapp','designations','vendors','workers','users'
      ]::text[]),
      ('recruit', array['users']::text[]),
      ('finance', array[
        'payments','advance_requests','expense_requests','payment_requests','payment_approvals','payment_process',
        'workforce_payouts','payment_reports','payment_methods','master_payment_banks','master_payment_heads','master_contacts',
        'payment_settings','users'
      ]::text[]),
      ('tech', array[
        'company_master','app_settings','ai_connector','amazon_connector','developer_mode','raw_punch_reports',
        'verification_api_reports','event_log_reports','biometric_devices','users'
      ]::text[])
  )
  delete from public.role_page_permissions permission
  using public.user_roles role, public.app_pages page, ownership
  where permission.role_id = role.id
    and permission.company_id = role.company_id
    and page.id = permission.page_id
    and role.product_code = ownership.product_code
    and not (page.code = any(ownership.page_codes));
  get diagnostics removed_count = row_count;

  with ownership(product_code, page_codes) as (
    values
      ('operations', array[
        'ops_pulse','performance','capacity','capacity_overview','capacity_associates','capacity_delivery','capacity_hiring',
        'ops_reports','ops_attendance_reports','daily_submission','cod','cod_executive_reconciliation','cod_submission',
        'cod_validation','cod_reports','cod_portal_checks','cod_cash_in_associate','edd_dashboard','cps','cps_overview',
        'cps_daily','cps_monthly','cps_cost_breakup','cps_stations','cps_shipments','cps_associates','cps_reports',
        'cps_inputs','cps_unmapped','service_network','service_network_master','master_locations','master_providers',
        'master_models','cod_master','business_documents','master_documents','performance_master','capacity_master','imports',
        'fleet','fleet_action_center','fleet_vehicle_view','fleet_date_view','fleet_station_view','fleet_tracking','fleet_fuel_log',
        'fleet_live_gps','fleet_maintenance','fleet_reports','users'
      ]::text[]),
      ('people', array['people_all','people_review','people_exceptions','employees','attendance_reports','attendance_integrity','inbox','biometric_devices','designations','users']::text[]),
      ('workforce', array['delivery_associates','executive_id_onboarding','provider_mapping','people_review','workforce_activity','workforce_rate_cards','workforce_earnings','workforce_incentives','workforce_adjustments','workforce_payroll','workforce_communications','workforce_communications_app','workforce_communications_whatsapp','workforce_communications_history','workforce_categories','workforce_whatsapp','designations','vendors','workers','users']::text[]),
      ('recruit', array['users']::text[]),
      ('finance', array['payments','advance_requests','expense_requests','payment_requests','payment_approvals','payment_process','workforce_payouts','payment_reports','payment_methods','master_payment_banks','master_payment_heads','master_contacts','payment_settings','users']::text[]),
      ('tech', array['company_master','app_settings','ai_connector','amazon_connector','developer_mode','raw_punch_reports','verification_api_reports','event_log_reports','biometric_devices','users']::text[])
  )
  insert into public.role_page_permissions (company_id, role_id, page_id, can_view, can_add, can_edit)
  select role.company_id, role.id, page.id, true, true, true
  from public.user_roles role
  join ownership on ownership.product_code = role.product_code
  join public.app_pages page
    on page.code = any(ownership.page_codes)
   and (page.company_id = role.company_id or page.company_id is null)
   and page.is_active
  where role.is_active
  on conflict (company_id, role_id, page_id) do update
  set can_view = true,
      can_add = true,
      can_edit = true;
  get diagnostics granted_count = row_count;

  return jsonb_build_object('removed_out_of_product_permissions', removed_count, 'upserted_product_permissions', granted_count);
end;
$$;

revoke all on function public.preview_legacy_workforce_alias_cleanup() from public, anon, authenticated;
revoke all on function public.purge_verified_legacy_workforce_aliases() from public, anon, authenticated;
revoke all on function public.reconcile_product_role_permission_boundaries() from public, anon, authenticated;
grant execute on function public.preview_legacy_workforce_alias_cleanup() to service_role;
grant execute on function public.purge_verified_legacy_workforce_aliases() to service_role;
grant execute on function public.reconcile_product_role_permission_boundaries() to service_role;

comment on function public.preview_legacy_workforce_alias_cleanup() is
  'Read-only reconciliation summary for Workforce records still present in legacy contractor or field-executive tables.';
comment on function public.purge_verified_legacy_workforce_aliases() is
  'Deletes only legacy Workforce aliases after canonical identity, registration-copy, foreign-key and polymorphic-reference checks pass atomically.';
comment on function public.reconcile_product_role_permission_boundaries() is
  'Synchronizes product-classified role permissions with the current isolated portal ownership matrix.';

notify pgrst, 'reload schema';

commit;
