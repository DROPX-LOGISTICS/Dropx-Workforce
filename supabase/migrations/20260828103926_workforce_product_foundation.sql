begin;

-- The Workforce product is introduced by copy + continuous mirroring. Legacy
-- contractor / field-executive rows and mobile registration drafts stay in
-- place until the registration queue has been reconciled and formally cut over.

update public.designations designation
set onboarding_categories = array['vendors']::text[],
    updated_at = now()
from public.designation_categories category
where category.id = designation.designation_category_id
  and category.company_id = designation.company_id
  and category.code = 'workforce'
  and upper(designation.code) in ('HK', 'SRTR', 'VAN', 'VNV')
  and designation.onboarding_categories is distinct from array['vendors']::text[];

update public.designations designation
set portal_permissions = jsonb_set(
      coalesce(designation.portal_permissions, '{}'::jsonb),
      '{workforce}',
      case category.code
        when 'workforce' then '{"add":true,"view":true,"edit":true}'::jsonb
        else '{"add":false,"view":false,"edit":false}'::jsonb
      end,
      true
    ),
    portal_scopes = case
      when category.code = 'workforce' then array['workforce']::text[]
      else designation.portal_scopes
    end,
    updated_at = now()
from public.designation_categories category
where category.id = designation.designation_category_id
  and category.company_id = designation.company_id;

alter table public.designations
  drop constraint if exists designations_portal_permissions_edit_requires_view_check;

alter table public.designations
  add constraint designations_portal_permissions_edit_requires_view_check
  check (
    (((portal_permissions #>> '{dashboard,edit}') is distinct from 'true') or ((portal_permissions #>> '{dashboard,view}') = 'true'))
    and (((portal_permissions #>> '{workforce,edit}') is distinct from 'true') or ((portal_permissions #>> '{workforce,view}') = 'true'))
    and (((portal_permissions #>> '{hrms,edit}') is distinct from 'true') or ((portal_permissions #>> '{hrms,view}') = 'true'))
    and (((portal_permissions #>> '{ops,edit}') is distinct from 'true') or ((portal_permissions #>> '{ops,view}') = 'true'))
    and (((portal_permissions #>> '{recruitment,edit}') is distinct from 'true') or ((portal_permissions #>> '{recruitment,view}') = 'true'))
  );

create table public.workforce (
  like public.contractors
    including defaults
    including constraints
    including storage
    including comments
);

alter table public.workforce
  add column approval_required boolean not null default true,
  add column onboarding_submitted_at timestamptz,
  add column onboarding_reviewed_at timestamptz,
  add column onboarding_reviewed_by uuid,
  add column onboarding_review_remarks text,
  add column onboarding_approved_at timestamptz,
  add column onboarding_approved_by uuid,
  add column onboarding_activated_at timestamptz,
  add column provider_id_status text not null default 'pending',
  add column provider_employee_id text,
  add column source_profile_type text not null,
  add column source_profile_id uuid not null,
  add column designation_id uuid not null,
  add column delivery_associate_id uuid,
  add column compatibility_mode boolean not null default true,
  add column migration_state text not null default 'mirrored',
  add column synced_at timestamptz not null default now();

alter table public.workforce
  alter column company_id set not null,
  add constraint workforce_pkey primary key (id),
  add constraint workforce_company_id_fkey
    foreign key (company_id) references public.companies(id) on delete cascade,
  add constraint workforce_location_id_fkey
    foreign key (location_id) references public.stations(id),
  add constraint workforce_created_by_fkey
    foreign key (created_by) references auth.users(id),
  add constraint workforce_deactivated_by_fkey
    foreign key (deactivated_by) references auth.users(id),
  add constraint workforce_deleted_by_fkey
    foreign key (deleted_by) references public.profiles(id) on delete set null,
  add constraint workforce_department_id_fkey
    foreign key (department_id) references public.hr_departments(id) on delete set null,
  add constraint workforce_recruitment_lead_id_fkey
    foreign key (recruitment_lead_id) references public.recruitment_leads(id) on delete set null,
  add constraint workforce_onboarding_reviewed_by_fkey
    foreign key (onboarding_reviewed_by) references auth.users(id),
  add constraint workforce_onboarding_approved_by_fkey
    foreign key (onboarding_approved_by) references auth.users(id),
  add constraint workforce_designation_id_fkey
    foreign key (designation_id) references public.designations(id) on delete restrict,
  add constraint workforce_delivery_associate_id_fkey
    foreign key (delivery_associate_id) references public.delivery_associates(id) on delete set null,
  add constraint workforce_source_profile_type_check
    check (source_profile_type in ('field_executive', 'contractor')),
  add constraint workforce_provider_id_status_check
    check (provider_id_status in ('not_started', 'pending', 'in_progress', 'created', 'blocked', 'failed', 'not_required')),
  add constraint workforce_migration_state_check
    check (migration_state in ('mirrored', 'reclassified', 'moved_to_vendor', 'cutover_ready', 'canonical')),
  add constraint workforce_company_source_unique
    unique (company_id, source_profile_type, source_profile_id);

create index workforce_company_status_idx
  on public.workforce(company_id, onboarding_status, is_active);
create index workforce_company_designation_idx
  on public.workforce(company_id, designation_id, is_active);
create index workforce_company_location_idx
  on public.workforce(company_id, location_id, is_active);
create index workforce_dropx_id_idx
  on public.workforce(dropx_id) where dropx_id is not null;
create index workforce_mobile_idx
  on public.workforce(company_id, mobile_country_code, mobile);
create index workforce_delivery_associate_idx
  on public.workforce(delivery_associate_id) where delivery_associate_id is not null;

create table public.workforce_identity_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  target_profile_type text not null,
  target_profile_id uuid not null,
  legacy_profile_type text not null,
  legacy_profile_id uuid not null,
  delivery_associate_id uuid references public.delivery_associates(id) on delete set null,
  compatibility_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workforce_identity_links_target_type_check
    check (target_profile_type in ('workforce', 'vendor')),
  constraint workforce_identity_links_legacy_type_check
    check (legacy_profile_type in ('field_executive', 'contractor')),
  constraint workforce_identity_links_legacy_unique
    unique (company_id, legacy_profile_type, legacy_profile_id),
  constraint workforce_identity_links_target_unique
    unique (company_id, target_profile_type, target_profile_id)
);

create index workforce_identity_links_delivery_associate_idx
  on public.workforce_identity_links(delivery_associate_id)
  where delivery_associate_id is not null;

create or replace function public.upsert_record_from_json(
  p_target_table regclass,
  p_record jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  assignment_list text;
  target_id uuid;
begin
  select string_agg(
    format('%1$I = excluded.%1$I', attribute.attname),
    ', ' order by attribute.attnum
  )
  into assignment_list
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = p_target_table
    and attribute.attnum > 0
    and not attribute.attisdropped
    and attribute.attgenerated = ''
    and attribute.attname <> 'id';

  if assignment_list is null then
    raise exception 'No updatable columns found for %', p_target_table;
  end if;

  execute format(
    'insert into %1$s select (jsonb_populate_record(null::%1$s, $1)).* '
      'on conflict (id) do update set %2$s returning id',
    p_target_table,
    assignment_list
  )
  into target_id
  using p_record;

  return target_id;
end;
$$;

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
  onboarding_categories_value text[];
  delivery_associate_id_value uuid;
  target_id_value uuid;
  target_profile_type_value text;
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

  select designation.id, category.code, designation.onboarding_categories
  into designation_id_value, designation_category_code, onboarding_categories_value
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

  select associate.id
  into delivery_associate_id_value
  from public.delivery_associates associate
  where nullif(p_record ->> 'dropx_id', '') is not null
    and upper(associate.dropx_id) = upper(p_record ->> 'dropx_id')
  limit 1;

  if 'vendors' = any(coalesce(onboarding_categories_value, array[]::text[])) then
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

create or replace function public.sync_workforce_legacy_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.sync_workforce_legacy_payload(
    case tg_table_name
      when 'field_executives' then 'field_executive'
      when 'contractors' then 'contractor'
      else null
    end,
    to_jsonb(new)
  );
  return new;
end;
$$;

-- Backfill before enabling continuous mirroring. Existing source rows, tokens,
-- drafts, invitations and foreign-key relationships are intentionally retained.
select public.sync_workforce_legacy_payload('field_executive', to_jsonb(profile))
from public.field_executives profile;

select public.sync_workforce_legacy_payload('contractor', to_jsonb(profile))
from public.contractors profile;

drop trigger if exists field_executives_sync_workforce on public.field_executives;
create trigger field_executives_sync_workforce
after insert or update on public.field_executives
for each row execute function public.sync_workforce_legacy_trigger();

drop trigger if exists contractors_sync_workforce on public.contractors;
create trigger contractors_sync_workforce
after insert or update on public.contractors
for each row execute function public.sync_workforce_legacy_trigger();

-- Enable the future canonical profile type without changing any current draft.
alter table public.mob_app_registration_drafts
  drop constraint if exists mob_app_registration_drafts_profile_type_check;
alter table public.mob_app_registration_drafts
  add constraint mob_app_registration_drafts_profile_type_check
  check (profile_type in ('employee', 'field_executive', 'contractor', 'vendor', 'worker', 'workforce'));

alter table public.connect_profile_verifications
  drop constraint if exists connect_profile_verifications_profile_type_check;
alter table public.connect_profile_verifications
  add constraint connect_profile_verifications_profile_type_check
  check (profile_type in ('employee', 'field_executive', 'contractor', 'vendor', 'worker', 'workforce'));

alter table public.mob_app_device_tokens
  drop constraint if exists mob_app_device_tokens_profile_type_check;
alter table public.mob_app_device_tokens
  add constraint mob_app_device_tokens_profile_type_check
  check (profile_type in ('employee', 'field_executive', 'contractor', 'vendor', 'worker', 'workforce'));

alter table public.mob_app_notifications
  drop constraint if exists mob_app_notifications_profile_type_check;
alter table public.mob_app_notifications
  add constraint mob_app_notifications_profile_type_check
  check (recipient_profile_type in ('employee', 'field_executive', 'contractor', 'vendor', 'worker', 'workforce'));

alter table public.attendance_regularization_requests
  drop constraint if exists attendance_regularization_requests_profile_type_check;
alter table public.attendance_regularization_requests
  add constraint attendance_regularization_requests_profile_type_check
  check (profile_type in ('employee', 'field_executive', 'contractor', 'vendor', 'worker', 'workforce'));

alter table public.attendance_reminder_dispatches
  drop constraint if exists attendance_reminder_dispatches_profile_type_check;
alter table public.attendance_reminder_dispatches
  add constraint attendance_reminder_dispatches_profile_type_check
  check (profile_type in ('employee', 'field_executive', 'contractor', 'vendor', 'worker', 'workforce'));

alter table public.attendance_reminder_settings
  drop constraint if exists attendance_reminder_settings_profile_types_check;
alter table public.attendance_reminder_settings
  add constraint attendance_reminder_settings_profile_types_check
  check (
    cardinality(profile_types) >= 1
    and profile_types <@ array['employee', 'field_executive', 'contractor', 'vendor', 'worker', 'workforce']::text[]
  );

alter table public.biometric_enrolments
  drop constraint if exists biometric_enrolments_profile_type_check;
alter table public.biometric_enrolments
  add constraint biometric_enrolments_profile_type_check
  check (profile_type is null or profile_type in ('employee', 'field_executive', 'contractor', 'vendor', 'worker', 'workforce'));

alter table public.biometric_enrolments
  drop constraint if exists biometric_enrolments_one_person_check;
alter table public.biometric_enrolments
  add constraint biometric_enrolments_one_person_check
  check (
    (worker_type = 'employee' and employee_id is not null and field_executive_id is null)
    or (
      worker_type = 'individual_contract'
      and employee_id is null
      and (
        field_executive_id is not null
        or (profile_type in ('contractor', 'vendor', 'worker', 'workforce') and account_id is not null)
      )
    )
  ) not valid;

alter table public.communication_announcement_recipients
  drop constraint if exists communication_announcement_recipie_recipient_profile_type_check;
alter table public.communication_announcement_recipients
  add constraint communication_announcement_recipie_recipient_profile_type_check
  check (recipient_profile_type in ('employee', 'field_executive', 'contractor', 'vendor', 'worker', 'workforce'));

alter table public.communication_announcements
  drop constraint if exists communication_announcements_profile_types_check;
alter table public.communication_announcements
  add constraint communication_announcements_profile_types_check
  check (audience_profile_types <@ array['employee', 'field_executive', 'contractor', 'vendor', 'worker', 'workforce']::text[]);

alter table public.payment_advance_requests
  drop constraint if exists payment_advance_requests_profile_type_check;
alter table public.payment_advance_requests
  add constraint payment_advance_requests_profile_type_check
  check (profile_type in ('employee', 'field_executive', 'contractor', 'vendor', 'worker', 'workforce'));

alter table public.workforce_agreement_acceptances
  drop constraint if exists workforce_agreement_acceptances_profile_type_check;
alter table public.workforce_agreement_acceptances
  add constraint workforce_agreement_acceptances_profile_type_check
  check (profile_type in ('employee', 'field_executive', 'contractor', 'vendor', 'worker', 'workforce'));

alter table public.workforce_lifecycle_cases
  drop constraint if exists workforce_lifecycle_cases_profile_type_check;
alter table public.workforce_lifecycle_cases
  add constraint workforce_lifecycle_cases_profile_type_check
  check (profile_type in ('field_executive', 'contractor', 'vendor', 'worker', 'workforce'));

alter table public.workforce_lifecycle_events
  drop constraint if exists workforce_lifecycle_events_profile_type_check;
alter table public.workforce_lifecycle_events
  add constraint workforce_lifecycle_events_profile_type_check
  check (profile_type in ('field_executive', 'contractor', 'vendor', 'worker', 'workforce'));

alter table public.workforce_tracking_trips
  drop constraint if exists workforce_tracking_trips_profile_type_check;
alter table public.workforce_tracking_trips
  add constraint workforce_tracking_trips_profile_type_check
  check (profile_type in ('employee', 'field_executive', 'contractor', 'vendor', 'worker', 'workforce'));

create or replace view public.workforce_migration_reconciliation
with (security_invoker = true)
as
select
  link.company_id,
  link.target_profile_type,
  link.legacy_profile_type,
  link.compatibility_active,
  count(*)::bigint as profile_count,
  count(link.delivery_associate_id)::bigint as payment_engine_linked_count,
  max(link.updated_at) as last_synced_at
from public.workforce_identity_links link
group by
  link.company_id,
  link.target_profile_type,
  link.legacy_profile_type,
  link.compatibility_active;

alter table public.workforce enable row level security;
alter table public.workforce_identity_links enable row level security;

revoke all on table public.workforce from anon, authenticated;
revoke all on table public.workforce_identity_links from anon, authenticated;
revoke all on table public.workforce_migration_reconciliation from anon, authenticated;
grant select, insert, update, delete on table public.workforce to service_role;
grant select, insert, update, delete on table public.workforce_identity_links to service_role;
grant select on table public.workforce_migration_reconciliation to service_role;

revoke all on function public.upsert_record_from_json(regclass, jsonb) from public, anon, authenticated;
revoke all on function public.sync_workforce_legacy_payload(text, jsonb) from public, anon, authenticated;
revoke all on function public.sync_workforce_legacy_trigger() from public, anon, authenticated;
grant execute on function public.upsert_record_from_json(regclass, jsonb) to service_role;
grant execute on function public.sync_workforce_legacy_payload(text, jsonb) to service_role;

comment on table public.workforce is
  'Canonical Workforce associate register. Legacy sources remain active in compatibility mode until registration cutover.';
comment on table public.workforce_identity_links is
  'Crosswalk between canonical Workforce/Vendor records, legacy registration sources, and the DA payment engine.';
comment on column public.workforce.compatibility_mode is
  'True while DropX One registration continues through the legacy source row.';
comment on view public.workforce_migration_reconciliation is
  'Non-PII migration counts used to prove parity before disabling compatibility mode.';

notify pgrst, 'reload schema';

commit;
