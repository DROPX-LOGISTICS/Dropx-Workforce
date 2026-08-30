begin;

-- Allow HR assignment history to reference the canonical Workforce register.
-- This migration changes schema and guards only; it does not rewrite live rows.

create or replace function public.normalize_hr_engagement_workforce_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.workforce_id is not null then
    new.worker_type := 'workforce';
    new.employee_id := null;
    new.contractor_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists canonicalize_workforce_legacy_columns on public.hr_engagements;
create trigger canonicalize_workforce_legacy_columns
before insert or update on public.hr_engagements
for each row execute function public.canonicalize_workforce_legacy_columns('clear');

drop trigger if exists normalize_hr_engagement_workforce_source on public.hr_engagements;
create trigger normalize_hr_engagement_workforce_source
before insert or update on public.hr_engagements
for each row execute function public.normalize_hr_engagement_workforce_source();

alter table public.hr_engagements
  drop constraint if exists hr_engagements_source_check;
alter table public.hr_engagements
  add constraint hr_engagements_source_check
  check (
    (worker_type = 'employee' and employee_id is not null and contractor_id is null and workforce_id is null)
    or (worker_type = 'contractor' and employee_id is null and contractor_id is not null and workforce_id is null)
    or (worker_type = 'workforce' and employee_id is null and contractor_id is null and workforce_id is not null)
  ) not valid;

create or replace function public.preview_legacy_workforce_reference_blockers()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  reference_record record;
  reference_count bigint;
  direct_references bigint := 0;
  polymorphic_references bigint := 0;
  breakdown jsonb := '[]'::jsonb;
begin
  create temporary table pg_temp.legacy_workforce_reference_candidates (
    company_id uuid not null,
    legacy_profile_type text not null,
    legacy_profile_id uuid not null,
    target_profile_id uuid not null,
    primary key (company_id, legacy_profile_type, legacy_profile_id)
  ) on commit drop;

  insert into pg_temp.legacy_workforce_reference_candidates
    (company_id, legacy_profile_type, legacy_profile_id, target_profile_id)
  select contractor.company_id, 'contractor', contractor.id, link.target_profile_id
  from public.contractors contractor
  join public.workforce_identity_links link
    on link.company_id = contractor.company_id
   and link.legacy_profile_type = 'contractor'
   and link.legacy_profile_id = contractor.id
   and link.target_profile_type = 'workforce'
  join public.workforce workforce
    on workforce.id = link.target_profile_id
   and workforce.company_id = contractor.company_id
   and workforce.source_profile_type = 'contractor'
   and workforce.source_profile_id = contractor.id
  where exists (
    select 1
    from public.designations designation
    join public.designation_categories category
      on category.id = designation.designation_category_id
     and category.company_id = designation.company_id
    where designation.company_id = contractor.company_id
      and category.people_module = 'delivery_network'
      and designation.profile_destination = 'workforce'
      and (
        upper(btrim(designation.code)) = upper(btrim(contractor.designation))
        or lower(btrim(designation.name)) = lower(btrim(contractor.designation))
      )
  )
  union all
  select executive.company_id, 'field_executive', executive.id, link.target_profile_id
  from public.field_executives executive
  join public.workforce_identity_links link
    on link.company_id = executive.company_id
   and link.legacy_profile_type = 'field_executive'
   and link.legacy_profile_id = executive.id
   and link.target_profile_type = 'workforce'
  join public.workforce workforce
    on workforce.id = link.target_profile_id
   and workforce.company_id = executive.company_id
   and workforce.source_profile_type = 'field_executive'
   and workforce.source_profile_id = executive.id
  where exists (
    select 1
    from public.designations designation
    join public.designation_categories category
      on category.id = designation.designation_category_id
     and category.company_id = designation.company_id
    where designation.company_id = executive.company_id
      and category.people_module = 'delivery_network'
      and designation.profile_destination = 'workforce'
      and (
        upper(btrim(designation.code)) = upper(btrim(executive.designation))
        or lower(btrim(designation.name)) = lower(btrim(executive.designation))
      )
  );

  for reference_record in
    select referencing_table.oid::regclass as table_name,
      referencing_column.attname as column_name,
      case referenced_table.relname when 'contractors' then 'contractor' when 'field_executives' then 'field_executive' end as legacy_profile_type
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
      'select count(*) from %s item join pg_temp.legacy_workforce_reference_candidates candidate on candidate.legacy_profile_type = $1 and candidate.legacy_profile_id = item.%I',
      reference_record.table_name,
      reference_record.column_name
    ) into reference_count using reference_record.legacy_profile_type;
    if reference_count > 0 then
      direct_references := direct_references + reference_count;
      breakdown := breakdown || jsonb_build_array(jsonb_build_object(
        'kind', 'foreign_key',
        'table', reference_record.table_name::text,
        'columns', reference_record.column_name,
        'profile_type', reference_record.legacy_profile_type,
        'rows', reference_count
      ));
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
    if to_regclass(format('public.%I', reference_record.table_name)) is null then continue; end if;
    execute format(
      'select count(*) from public.%I item join pg_temp.legacy_workforce_reference_candidates candidate on item.company_id = candidate.company_id and item.%I = candidate.legacy_profile_type and item.%I = candidate.legacy_profile_id',
      reference_record.table_name,
      reference_record.type_column,
      reference_record.id_column
    ) into reference_count;
    if reference_count > 0 then
      polymorphic_references := polymorphic_references + reference_count;
      breakdown := breakdown || jsonb_build_array(jsonb_build_object(
        'kind', 'polymorphic',
        'table', reference_record.table_name,
        'columns', reference_record.type_column || '/' || reference_record.id_column,
        'profile_type', 'mixed',
        'rows', reference_count
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'candidate_rows', (select count(*) from pg_temp.legacy_workforce_reference_candidates),
    'direct_foreign_keys', direct_references,
    'polymorphic_references', polymorphic_references,
    'breakdown', breakdown
  );
end;
$$;

revoke all on function public.normalize_hr_engagement_workforce_source() from public, anon, authenticated;
revoke all on function public.preview_legacy_workforce_reference_blockers() from public, anon, authenticated;
grant execute on function public.preview_legacy_workforce_reference_blockers() to service_role;

notify pgrst, 'reload schema';

commit;
