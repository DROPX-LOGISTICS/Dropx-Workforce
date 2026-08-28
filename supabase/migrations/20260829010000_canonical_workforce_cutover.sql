begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';
select pg_advisory_xact_lock(hashtext('dropx_canonical_workforce_cutover'));

-- Canonical records created by the Workforce product no longer need a legacy
-- contractor or field-executive source. Historical source values remain valid
-- so existing identity links and audits are preserved.
alter table public.workforce
  drop constraint if exists workforce_source_profile_type_check;

alter table public.workforce
  add constraint workforce_source_profile_type_check
  check (source_profile_type in ('canonical', 'employee', 'field_executive', 'contractor', 'vendor', 'worker'));

create or replace function public.workforce_profile_should_be_available(p_record jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    nullif(p_record ->> 'deleted_at', '') is null
    and nullif(p_record ->> 'deactivated_at', '') is null
    and lower(coalesce(nullif(p_record ->> 'migration_state', ''), 'canonical')) not in (
      'reclassified', 'moved_to_vendor'
    )
    and lower(coalesce(nullif(p_record ->> 'onboarding_status', ''), 'pending')) not in (
      'rejected', 'cancelled', 'terminated', 'settled', 'exited', 'offboarded', 'deactivated'
    )
    and lower(coalesce(nullif(p_record ->> 'lifecycle_status', ''), 'onboarding')) not in (
      'rejected', 'cancelled', 'terminated', 'settled', 'exited', 'offboarded', 'deactivated'
    );
$$;

-- All writes to the canonical register pass through this helper. Normalizing
-- availability here prevents an inactive legacy alias from overwriting a
-- resumable pending/under-review Workforce profile.
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
  column_list text;
  assignment_list text;
  target_id uuid;
  normalized_record jsonb := p_record;
begin
  if p_target_table not in (
    'public.employees'::regclass,
    'public.contractors'::regclass,
    'public.workforce'::regclass,
    'public.vendors'::regclass,
    'public.workers'::regclass,
    'public.workforce_helpers'::regclass,
    'public.field_executives'::regclass
  ) then
    raise exception 'Unsupported profile table: %', p_target_table;
  end if;

  if p_target_table = 'public.workforce'::regclass then
    normalized_record := normalized_record || jsonb_build_object(
      'is_active', public.workforce_profile_should_be_available(normalized_record),
      'synced_at', now()
    );
  end if;

  select
    string_agg(format('%I', attribute.attname), ', ' order by attribute.attnum),
    string_agg(
      format('%1$I = excluded.%1$I', attribute.attname),
      ', ' order by attribute.attnum
    ) filter (where attribute.attname <> 'id')
  into column_list, assignment_list
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = p_target_table
    and attribute.attnum > 0
    and not attribute.attisdropped
    and attribute.attgenerated = ''
    and normalized_record ? attribute.attname;

  if column_list is null or not (normalized_record ? 'id') then
    raise exception 'Profile payload must contain an id for %', p_target_table;
  end if;

  execute format(
    'insert into %1$s (%2$s) select %2$s from jsonb_populate_record(null::%1$s, $1) '
      'on conflict (id) do update set %3$s returning id',
    p_target_table,
    column_list,
    assignment_list
  )
  into target_id
  using normalized_record;

  return target_id;
end;
$$;

-- route_profile_record intentionally deactivates its legacy alias. Respecting
-- this transaction-local flag stops that maintenance update from immediately
-- mirroring the inactive flag back into the canonical Workforce row.
create or replace function public.sync_workforce_legacy_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_record jsonb;
begin
  if current_setting('dropx.routing_skip_sync', true) = 'on' then
    return new;
  end if;

  normalized_record := to_jsonb(new);
  normalized_record := normalized_record || jsonb_build_object(
    'is_active', public.workforce_profile_should_be_available(normalized_record)
  );

  perform public.sync_workforce_legacy_payload(
    case tg_table_name
      when 'field_executives' then 'field_executive'
      when 'contractors' then 'contractor'
      else null
    end,
    normalized_record
  );
  return new;
end;
$$;

-- Old DropX One sessions can remain open while GitHub deploys the new build.
-- These guards rewrite late legacy writes to the canonical identity before
-- constraints and upserts run, eliminating a split-draft deployment window.
create or replace function public.canonicalize_workforce_account_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  canonical_id uuid;
  payload jsonb;
begin
  if new.profile_type in ('field_executive', 'contractor') and new.account_id is not null then
    select link.target_profile_id
    into canonical_id
    from public.workforce_identity_links link
    where link.company_id = new.company_id
      and link.legacy_profile_type = new.profile_type
      and link.legacy_profile_id = new.account_id
      and link.target_profile_type = 'workforce'
      and link.compatibility_active
    limit 1;
    if canonical_id is not null then
      payload := to_jsonb(new) || jsonb_build_object(
        'profile_type', 'workforce',
        'account_id', canonical_id
      );
      if payload ? 'field_executive_id' then
        payload := payload || jsonb_build_object('field_executive_id', null);
      end if;
      if payload ? 'contractor_id' then
        payload := payload || jsonb_build_object('contractor_id', null);
      end if;
      return jsonb_populate_record(new, payload);
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.canonicalize_workforce_profile_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  canonical_id uuid;
begin
  if new.profile_type in ('field_executive', 'contractor') and new.profile_id is not null then
    select link.target_profile_id
    into canonical_id
    from public.workforce_identity_links link
    where link.company_id = new.company_id
      and link.legacy_profile_type = new.profile_type
      and link.legacy_profile_id = new.profile_id
      and link.target_profile_type = 'workforce'
      and link.compatibility_active
    limit 1;
    if canonical_id is not null then
      new.profile_type := 'workforce';
      new.profile_id := canonical_id;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.canonicalize_workforce_recipient_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  canonical_id uuid;
begin
  if new.recipient_profile_type in ('field_executive', 'contractor') and new.recipient_account_id is not null then
    select link.target_profile_id
    into canonical_id
    from public.workforce_identity_links link
    where link.company_id = new.company_id
      and link.legacy_profile_type = new.recipient_profile_type
      and link.legacy_profile_id = new.recipient_account_id
      and link.target_profile_type = 'workforce'
      and link.compatibility_active
    limit 1;
    if canonical_id is not null then
      new.recipient_profile_type := 'workforce';
      new.recipient_account_id := canonical_id;
    end if;
  end if;
  return new;
end;
$$;

-- Some legacy tables identify a worker through dedicated foreign-key columns
-- instead of profile_type/account_id. This guard gives late writes a canonical
-- workforce_id too. TG_ARGV[0] controls whether the compatibility source keys
-- can be cleared immediately or must remain temporarily for an old reader.
create or replace function public.canonicalize_workforce_legacy_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload jsonb := to_jsonb(new);
  legacy_type text;
  legacy_id uuid;
  canonical_id uuid;
  canonical_company_id uuid;
begin
  if nullif(payload ->> 'workforce_id', '') is not null then
    return new;
  end if;

  if nullif(payload ->> 'field_executive_id', '') is not null then
    legacy_type := 'field_executive';
    legacy_id := (payload ->> 'field_executive_id')::uuid;
  elsif nullif(payload ->> 'contractor_id', '') is not null then
    legacy_type := 'contractor';
    legacy_id := (payload ->> 'contractor_id')::uuid;
  else
    return new;
  end if;

  select link.target_profile_id, link.company_id
  into canonical_id, canonical_company_id
  from public.workforce_identity_links link
  where link.legacy_profile_type = legacy_type
    and link.legacy_profile_id = legacy_id
    and link.target_profile_type = 'workforce'
    and link.compatibility_active
    and (
      nullif(payload ->> 'company_id', '') is null
      or link.company_id = (payload ->> 'company_id')::uuid
    )
  limit 1;

  if canonical_id is null then
    return new;
  end if;

  payload := payload || jsonb_build_object('workforce_id', canonical_id);
  if payload ? 'company_id' and nullif(payload ->> 'company_id', '') is null then
    payload := payload || jsonb_build_object('company_id', canonical_company_id);
  end if;
  if coalesce(tg_argv[0], 'clear') = 'clear' then
    if payload ? 'field_executive_id' then
      payload := payload || jsonb_build_object('field_executive_id', null);
    end if;
    if payload ? 'contractor_id' then
      payload := payload || jsonb_build_object('contractor_id', null);
    end if;
  end if;

  return jsonb_populate_record(new, payload);
end;
$$;

-- Drafts and verification evidence are registration-critical. Keep a
-- compatibility copy under both identities while older DropX One sessions are
-- still open, and mirror every change in either direction. Trigger depth stops
-- the counterpart upsert/delete from recursing.
create or replace function public.mirror_workforce_registration_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_record public.mob_app_registration_drafts%rowtype;
  counterpart_type text;
  counterpart_id uuid;
begin
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    source_record := old;
  else
    source_record := new;
  end if;

  if source_record.profile_type = 'workforce' then
    select link.legacy_profile_type, link.legacy_profile_id
    into counterpart_type, counterpart_id
    from public.workforce_identity_links link
    where link.company_id = source_record.company_id
      and link.target_profile_type = 'workforce'
      and link.target_profile_id = source_record.account_id
      and link.compatibility_active
    limit 1;
  elsif source_record.profile_type in ('field_executive', 'contractor') then
    select 'workforce', link.target_profile_id
    into counterpart_type, counterpart_id
    from public.workforce_identity_links link
    where link.company_id = source_record.company_id
      and link.legacy_profile_type = source_record.profile_type
      and link.legacy_profile_id = source_record.account_id
      and link.target_profile_type = 'workforce'
      and link.compatibility_active
    limit 1;
  end if;

  if counterpart_id is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    delete from public.mob_app_registration_drafts item
    where item.company_id = source_record.company_id
      and item.profile_type = counterpart_type
      and item.account_id = counterpart_id;
    return old;
  end if;

  insert into public.mob_app_registration_drafts (
    id, company_id, profile_type, account_id, draft_data,
    verification_results, file_paths, created_at, updated_at
  ) values (
    gen_random_uuid(), source_record.company_id, counterpart_type, counterpart_id,
    source_record.draft_data, source_record.verification_results,
    source_record.file_paths, source_record.created_at, source_record.updated_at
  )
  on conflict (company_id, profile_type, account_id) do update
  set draft_data = excluded.draft_data,
      verification_results = excluded.verification_results,
      file_paths = excluded.file_paths,
      created_at = least(public.mob_app_registration_drafts.created_at, excluded.created_at),
      updated_at = excluded.updated_at
  where excluded.updated_at >= public.mob_app_registration_drafts.updated_at;
  return new;
end;
$$;

create or replace function public.mirror_workforce_profile_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_record public.connect_profile_verifications%rowtype;
  counterpart_type text;
  counterpart_id uuid;
begin
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    source_record := old;
  else
    source_record := new;
  end if;

  if source_record.profile_type = 'workforce' then
    select link.legacy_profile_type, link.legacy_profile_id
    into counterpart_type, counterpart_id
    from public.workforce_identity_links link
    where link.company_id = source_record.company_id
      and link.target_profile_type = 'workforce'
      and link.target_profile_id = source_record.account_id
      and link.compatibility_active
    limit 1;
  elsif source_record.profile_type in ('field_executive', 'contractor') then
    select 'workforce', link.target_profile_id
    into counterpart_type, counterpart_id
    from public.workforce_identity_links link
    where link.company_id = source_record.company_id
      and link.legacy_profile_type = source_record.profile_type
      and link.legacy_profile_id = source_record.account_id
      and link.target_profile_type = 'workforce'
      and link.compatibility_active
    limit 1;
  end if;

  if counterpart_id is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    delete from public.connect_profile_verifications item
    where item.company_id = source_record.company_id
      and item.profile_type = counterpart_type
      and item.account_id = counterpart_id
      and item.kind = source_record.kind;
    return old;
  end if;

  insert into public.connect_profile_verifications (
    id, company_id, profile_type, account_id, kind, input_key,
    verified, manual_review, block_submit, display_name, message,
    details, verified_at, created_at, updated_at
  ) values (
    gen_random_uuid(), source_record.company_id, counterpart_type,
    counterpart_id, source_record.kind, source_record.input_key,
    source_record.verified, source_record.manual_review,
    source_record.block_submit, source_record.display_name,
    source_record.message, source_record.details, source_record.verified_at,
    source_record.created_at, source_record.updated_at
  )
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
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'mob_app_device_tokens', 'attendance_punches',
    'attendance_reminder_dispatches', 'biometric_enrolments',
    'payment_advance_requests', 'verification_api_audit_logs'
  ] loop
    execute format('drop trigger if exists canonicalize_workforce_account_reference on public.%I', table_name);
    execute format(
      'create trigger canonicalize_workforce_account_reference before insert or update on public.%I for each row execute function public.canonicalize_workforce_account_reference()',
      table_name
    );
  end loop;

  foreach table_name in array array[
    'attendance_regularization_requests', 'attendance_integrity_flags',
    'attendance_location_reviews', 'attendance_location_samples',
    'people_exception_resolutions', 'workforce_agreement_acceptances',
    'workforce_lifecycle_cases', 'workforce_lifecycle_events',
    'workforce_payout_accounts', 'workforce_tracking_trips'
  ] loop
    execute format('drop trigger if exists canonicalize_workforce_profile_reference on public.%I', table_name);
    execute format(
      'create trigger canonicalize_workforce_profile_reference before insert or update on public.%I for each row execute function public.canonicalize_workforce_profile_reference()',
      table_name
    );
  end loop;

  foreach table_name in array array[
    'mob_app_notifications', 'communication_announcement_recipients'
  ] loop
    execute format('drop trigger if exists canonicalize_workforce_recipient_reference on public.%I', table_name);
    execute format(
      'create trigger canonicalize_workforce_recipient_reference before insert or update on public.%I for each row execute function public.canonicalize_workforce_recipient_reference()',
      table_name
    );
  end loop;
end;
$$;

revoke all on function public.canonicalize_workforce_account_reference() from public, anon, authenticated;
revoke all on function public.canonicalize_workforce_profile_reference() from public, anon, authenticated;
revoke all on function public.canonicalize_workforce_recipient_reference() from public, anon, authenticated;
revoke all on function public.canonicalize_workforce_legacy_columns() from public, anon, authenticated;
revoke all on function public.mirror_workforce_registration_draft() from public, anon, authenticated;
revoke all on function public.mirror_workforce_profile_verification() from public, anon, authenticated;

grant execute on function public.canonicalize_workforce_account_reference() to service_role;
grant execute on function public.canonicalize_workforce_profile_reference() to service_role;
grant execute on function public.canonicalize_workforce_recipient_reference() to service_role;
grant execute on function public.canonicalize_workforce_legacy_columns() to service_role;
grant execute on function public.mirror_workforce_registration_draft() to service_role;
grant execute on function public.mirror_workforce_profile_verification() to service_role;

-- Restore the canonical availability flag without changing registration or
-- lifecycle status. Pending profiles must be available so candidates can
-- resume and submit their registration in DropX One.
update public.workforce profile
set is_active = public.workforce_profile_should_be_available(to_jsonb(profile)),
    migration_state = case
      when profile.migration_state = 'reclassified' then profile.migration_state
      when profile.source_profile_type = 'canonical' then 'canonical'
      else 'cutover_ready'
    end,
    synced_at = now(),
    updated_at = now()
where profile.is_active is distinct from public.workforce_profile_should_be_available(to_jsonb(profile))
   or (
     profile.migration_state not in ('reclassified', 'canonical', 'cutover_ready')
     and public.workforce_profile_should_be_available(to_jsonb(profile))
   );

-- Every migrated record keeps the same UUID. This makes the cutover lossless:
-- files, tokens, drafts, verification responses, attendance and payout history
-- are re-keyed by profile type only, with the identity link resolving the UUID.
create temporary table workforce_cutover_links on commit drop as
select
  link.company_id,
  link.legacy_profile_type,
  link.legacy_profile_id,
  link.target_profile_id
from public.workforce_identity_links link
where link.compatibility_active
  and link.target_profile_type = 'workforce';

create unique index workforce_cutover_links_source_idx
  on workforce_cutover_links(company_id, legacy_profile_type, legacy_profile_id);

-- Provider IDs and rate cards must follow the canonical Workforce identity as
-- well. Keeping this relationship on contractor_id would make new canonical
-- registrations invisible and would keep payments coupled to the old table.
alter table public.field_executive_provider_mappings
  add column if not exists workforce_id uuid
  references public.workforce(id) on delete restrict;

alter table public.field_executive_provider_mappings
  drop constraint if exists field_executive_provider_mappings_worker_check;

alter table public.field_executive_provider_mappings
  add constraint field_executive_provider_mappings_worker_check
  check (num_nonnulls(workforce_id, field_executive_id, employee_id, contractor_id) = 1);

create index if not exists field_executive_provider_mappings_workforce_idx
  on public.field_executive_provider_mappings(workforce_id, effective_from desc)
  where workforce_id is not null;

update public.field_executive_provider_mappings item
set workforce_id = link.target_profile_id,
    field_executive_id = null,
    contractor_id = null,
    updated_at = now()
from workforce_cutover_links link
where item.company_id = link.company_id
  and (
    (link.legacy_profile_type = 'field_executive' and item.field_executive_id = link.legacy_profile_id)
    or (link.legacy_profile_type = 'contractor' and item.contractor_id = link.legacy_profile_id)
  );

-- Onboarding audit and checklist rows become canonical too. Legacy columns are
-- retained only for old, unclassified profiles that have no Workforce link.
alter table public.workforce_onboarding_events
  add column if not exists workforce_id uuid
  references public.workforce(id) on delete set null;

create index if not exists workforce_onboarding_events_workforce_idx
  on public.workforce_onboarding_events(workforce_id, created_at desc)
  where workforce_id is not null;

update public.workforce_onboarding_events item
set workforce_id = link.target_profile_id,
    field_executive_id = null,
    contractor_id = null
from workforce_cutover_links link
where item.company_id = link.company_id
  and (
    (link.legacy_profile_type = 'field_executive' and item.field_executive_id = link.legacy_profile_id)
    or (link.legacy_profile_type = 'contractor' and item.contractor_id = link.legacy_profile_id)
  );

alter table public.workforce_onboarding_checklist_results
  add column if not exists workforce_id uuid
  references public.workforce(id) on delete cascade;

alter table public.workforce_onboarding_checklist_results
  alter column field_executive_id drop not null;

create unique index if not exists workforce_onboarding_checklist_results_workforce_unique
  on public.workforce_onboarding_checklist_results(workforce_id, checklist_item_id);

update public.workforce_onboarding_checklist_results item
set workforce_id = link.target_profile_id,
    updated_at = now()
from workforce_cutover_links link
where item.company_id = link.company_id
  and link.legacy_profile_type = 'field_executive'
  and item.field_executive_id = link.legacy_profile_id;

alter table public.attendance_daily
  add column if not exists workforce_id uuid
  references public.workforce(id) on delete set null;

create index if not exists attendance_daily_workforce_idx
  on public.attendance_daily(workforce_id, punch_date desc)
  where workforce_id is not null;

update public.attendance_daily item
set workforce_id = link.target_profile_id,
    field_executive_id = null,
    contractor_id = null,
    updated_at = now()
from workforce_cutover_links link
where item.company_id = link.company_id
  and (
    (link.legacy_profile_type = 'field_executive' and item.field_executive_id = link.legacy_profile_id)
    or (link.legacy_profile_type = 'contractor' and item.contractor_id = link.legacy_profile_id)
  );

alter table public.biometric_alerts
  add column if not exists workforce_id uuid
  references public.workforce(id) on delete set null;

create index if not exists biometric_alerts_workforce_idx
  on public.biometric_alerts(workforce_id, created_at desc)
  where workforce_id is not null;

update public.biometric_alerts item
set workforce_id = link.target_profile_id,
    field_executive_id = null,
    contractor_id = null
from workforce_cutover_links link
where item.company_id = link.company_id
  and (
    (link.legacy_profile_type = 'field_executive' and item.field_executive_id = link.legacy_profile_id)
    or (link.legacy_profile_type = 'contractor' and item.contractor_id = link.legacy_profile_id)
  );

alter table public.whatsapp_message_logs
  add column if not exists workforce_id uuid
  references public.workforce(id) on delete set null;

create index if not exists whatsapp_message_logs_workforce_idx
  on public.whatsapp_message_logs(workforce_id, created_at desc)
  where workforce_id is not null;

update public.whatsapp_message_logs item
set workforce_id = link.target_profile_id,
    company_id = coalesce(item.company_id, link.company_id),
    field_executive_id = null,
    contractor_id = null
from workforce_cutover_links link
where (item.company_id = link.company_id or item.company_id is null)
  and (
    (link.legacy_profile_type = 'field_executive' and item.field_executive_id = link.legacy_profile_id)
    or (link.legacy_profile_type = 'contractor' and item.contractor_id = link.legacy_profile_id)
  );

alter table public.workforce_profile_change_requests
  add column if not exists workforce_id uuid
  references public.workforce(id) on delete cascade;

create index if not exists workforce_profile_change_requests_workforce_idx
  on public.workforce_profile_change_requests(workforce_id, created_at desc)
  where workforce_id is not null;

update public.workforce_profile_change_requests item
set workforce_id = link.target_profile_id,
    updated_at = now()
from workforce_cutover_links link
where item.company_id = link.company_id
  and (
    (link.legacy_profile_type = 'field_executive' and item.field_executive_id = link.legacy_profile_id)
    or (link.legacy_profile_type = 'contractor' and item.contractor_id = link.legacy_profile_id)
  );

alter table public.hr_engagements
  add column if not exists workforce_id uuid
  references public.workforce(id) on delete set null;

create index if not exists hr_engagements_workforce_idx
  on public.hr_engagements(workforce_id, status)
  where workforce_id is not null;

update public.hr_engagements item
set workforce_id = link.target_profile_id,
    updated_at = now()
from workforce_cutover_links link
where item.company_id = link.company_id
  and link.legacy_profile_type = 'contractor'
  and item.contractor_id = link.legacy_profile_id;

-- Attach direct-FK write-through only after every table has its workforce_id
-- column. Most operational history can clear legacy keys. Registration
-- checklists retain the old key so an already-open DropX One build can keep its
-- ON CONFLICT contract; profile-correction and People approval bridges retain
-- theirs until those older readers are retired. All still expose workforce_id.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'field_executive_provider_mappings',
    'workforce_onboarding_events',
    'attendance_daily',
    'biometric_alerts',
    'whatsapp_message_logs'
  ] loop
    execute format('drop trigger if exists canonicalize_workforce_legacy_columns on public.%I', table_name);
    execute format(
      'create trigger canonicalize_workforce_legacy_columns before insert or update on public.%I for each row execute function public.canonicalize_workforce_legacy_columns(''clear'')',
      table_name
    );
  end loop;

  foreach table_name in array array[
    'workforce_onboarding_checklist_results',
    'workforce_profile_change_requests',
    'hr_engagements'
  ] loop
    execute format('drop trigger if exists canonicalize_workforce_legacy_columns on public.%I', table_name);
    execute format(
      'create trigger canonicalize_workforce_legacy_columns before insert or update on public.%I for each row execute function public.canonicalize_workforce_legacy_columns(''retain'')',
      table_name
    );
  end loop;
end;
$$;

insert into public.mob_app_registration_drafts (
  id, company_id, profile_type, account_id, draft_data,
  verification_results, file_paths, created_at, updated_at
)
select
  gen_random_uuid(), item.company_id, 'workforce', link.target_profile_id,
  item.draft_data, item.verification_results, item.file_paths,
  item.created_at, item.updated_at
from public.mob_app_registration_drafts item
join workforce_cutover_links link
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
join workforce_cutover_links link
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

drop trigger if exists mirror_workforce_registration_draft
  on public.mob_app_registration_drafts;
create trigger mirror_workforce_registration_draft
after insert or update or delete on public.mob_app_registration_drafts
for each row execute function public.mirror_workforce_registration_draft();

drop trigger if exists mirror_workforce_profile_verification
  on public.connect_profile_verifications;
create trigger mirror_workforce_profile_verification
after insert or update or delete on public.connect_profile_verifications
for each row execute function public.mirror_workforce_profile_verification();

update public.mob_app_user_preferences item
set default_profile_type = 'workforce',
    default_account_id = link.target_profile_id,
    updated_at = now()
from workforce_cutover_links link
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
join workforce_cutover_links link
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
using workforce_cutover_links link
where item.company_id = link.company_id
  and item.profile_type = link.legacy_profile_type
  and item.account_id = link.legacy_profile_id;

update public.mob_app_notifications item
set recipient_profile_type = 'workforce',
    recipient_account_id = link.target_profile_id
from workforce_cutover_links link
where item.company_id = link.company_id
  and item.recipient_profile_type = link.legacy_profile_type
  and item.recipient_account_id = link.legacy_profile_id;

update public.communication_announcement_recipients item
set recipient_profile_type = 'workforce',
    recipient_account_id = link.target_profile_id
from workforce_cutover_links link
where item.company_id = link.company_id
  and item.recipient_profile_type = link.legacy_profile_type
  and item.recipient_account_id = link.legacy_profile_id;

update public.attendance_punches item
set profile_type = 'workforce',
    account_id = link.target_profile_id,
    field_executive_id = null,
    contractor_id = null
from workforce_cutover_links link
where item.company_id = link.company_id
  and item.profile_type = link.legacy_profile_type
  and item.account_id = link.legacy_profile_id;

update public.attendance_reminder_dispatches item
set profile_type = 'workforce',
    account_id = link.target_profile_id
from workforce_cutover_links link
where item.company_id = link.company_id
  and item.profile_type = link.legacy_profile_type
  and item.account_id = link.legacy_profile_id;

update public.biometric_enrolments item
set profile_type = 'workforce',
    account_id = link.target_profile_id,
    field_executive_id = null,
    contractor_id = null,
    updated_at = now()
from workforce_cutover_links link
where item.company_id = link.company_id
  and item.profile_type = link.legacy_profile_type
  and item.account_id = link.legacy_profile_id;

update public.payment_advance_requests item
set profile_type = 'workforce',
    account_id = link.target_profile_id,
    updated_at = now()
from workforce_cutover_links link
where item.company_id = link.company_id
  and item.profile_type = link.legacy_profile_type
  and item.account_id = link.legacy_profile_id;

update public.verification_api_audit_logs item
set profile_type = 'workforce',
    account_id = link.target_profile_id
from workforce_cutover_links link
where item.company_id = link.company_id
  and item.profile_type = link.legacy_profile_type
  and item.account_id = link.legacy_profile_id;

update public.attendance_regularization_requests item
set profile_type = 'workforce',
    profile_id = link.target_profile_id,
    updated_at = now()
from workforce_cutover_links link
where item.company_id = link.company_id
  and item.profile_type = link.legacy_profile_type
  and item.profile_id = link.legacy_profile_id;

update public.attendance_integrity_flags item
set profile_type = 'workforce',
    profile_id = link.target_profile_id,
    updated_at = now()
from workforce_cutover_links link
where item.company_id = link.company_id
  and item.profile_type = link.legacy_profile_type
  and item.profile_id = link.legacy_profile_id;

update public.attendance_location_reviews item
set profile_type = 'workforce',
    profile_id = link.target_profile_id,
    updated_at = now()
from workforce_cutover_links link
where item.company_id = link.company_id
  and item.profile_type = link.legacy_profile_type
  and item.profile_id = link.legacy_profile_id;

update public.attendance_location_samples item
set profile_type = 'workforce',
    profile_id = link.target_profile_id
from workforce_cutover_links link
where item.company_id = link.company_id
  and item.profile_type = link.legacy_profile_type
  and item.profile_id = link.legacy_profile_id;

update public.people_exception_resolutions item
set profile_type = 'workforce',
    profile_id = link.target_profile_id
from workforce_cutover_links link
where item.company_id = link.company_id
  and item.profile_type = link.legacy_profile_type
  and item.profile_id = link.legacy_profile_id;

alter table public.workforce_agreement_acceptances
  alter column field_executive_id drop not null;

update public.workforce_agreement_acceptances item
set profile_type = 'workforce',
    profile_id = link.target_profile_id,
    field_executive_id = null
from workforce_cutover_links link
where item.company_id = link.company_id
  and item.profile_type = link.legacy_profile_type
  and item.profile_id = link.legacy_profile_id;

update public.workforce_lifecycle_cases item
set profile_type = 'workforce',
    profile_id = link.target_profile_id,
    field_executive_id = null,
    updated_at = now()
from workforce_cutover_links link
where item.company_id = link.company_id
  and item.profile_type = link.legacy_profile_type
  and item.profile_id = link.legacy_profile_id;

update public.workforce_lifecycle_events item
set profile_type = 'workforce',
    profile_id = link.target_profile_id,
    field_executive_id = null
from workforce_cutover_links link
where item.company_id = link.company_id
  and item.profile_type = link.legacy_profile_type
  and item.profile_id = link.legacy_profile_id;

update public.workforce_payout_accounts item
set profile_type = 'workforce',
    profile_id = link.target_profile_id,
    updated_at = now()
from workforce_cutover_links link
where item.company_id = link.company_id
  and item.profile_type = link.legacy_profile_type
  and item.profile_id = link.legacy_profile_id;

update public.workforce_tracking_trips item
set profile_type = 'workforce',
    profile_id = link.target_profile_id,
    updated_at = now()
from workforce_cutover_links link
where item.company_id = link.company_id
  and item.profile_type = link.legacy_profile_type
  and item.profile_id = link.legacy_profile_id;

-- Fail atomically if registration-critical records did not move. A failure here
-- rolls the entire migration back; it never leaves a partial cutover.
do $$
begin
  if exists (
    select 1
    from public.mob_app_registration_drafts item
    join workforce_cutover_links link
      on link.company_id = item.company_id
     and link.legacy_profile_type = item.profile_type
     and link.legacy_profile_id = item.account_id
    left join public.mob_app_registration_drafts canonical
      on canonical.company_id = link.company_id
     and canonical.profile_type = 'workforce'
     and canonical.account_id = link.target_profile_id
    where canonical.id is null
  ) then
    raise exception 'Canonical Workforce cutover left registration drafts without a canonical compatibility copy.';
  end if;

  if exists (
    select 1
    from public.field_executive_provider_mappings item
    join workforce_cutover_links link
      on link.company_id = item.company_id
     and (
       (link.legacy_profile_type = 'field_executive' and item.field_executive_id = link.legacy_profile_id)
       or (link.legacy_profile_type = 'contractor' and item.contractor_id = link.legacy_profile_id)
     )
  ) then
    raise exception 'Canonical Workforce cutover left provider/rate mappings on a legacy identity.';
  end if;

  if exists (
    select 1
    from public.connect_profile_verifications item
    join workforce_cutover_links link
      on link.company_id = item.company_id
     and link.legacy_profile_type = item.profile_type
     and link.legacy_profile_id = item.account_id
    left join public.connect_profile_verifications canonical
      on canonical.company_id = link.company_id
     and canonical.profile_type = 'workforce'
     and canonical.account_id = link.target_profile_id
     and canonical.kind = item.kind
    where canonical.id is null
  ) then
    raise exception 'Canonical Workforce cutover left verification results without a canonical compatibility copy.';
  end if;

  if exists (
    select 1
    from public.workforce_onboarding_events item
    join workforce_cutover_links link
      on link.company_id = item.company_id
     and (
       (link.legacy_profile_type = 'field_executive' and item.field_executive_id = link.legacy_profile_id)
       or (link.legacy_profile_type = 'contractor' and item.contractor_id = link.legacy_profile_id)
     )
  ) then
    raise exception 'Canonical Workforce cutover left onboarding events on a legacy identity.';
  end if;

  if exists (
    select 1
    from public.workforce_onboarding_checklist_results item
    join workforce_cutover_links link
     on link.company_id = item.company_id
     and link.legacy_profile_type = 'field_executive'
     and item.field_executive_id = link.legacy_profile_id
    where item.workforce_id is null
  ) then
    raise exception 'Canonical Workforce cutover left onboarding checklist results without a Workforce identity.';
  end if;

  if exists (
    select 1
    from public.attendance_daily item
    join workforce_cutover_links link
      on link.company_id = item.company_id
     and (
       (link.legacy_profile_type = 'field_executive' and item.field_executive_id = link.legacy_profile_id)
       or (link.legacy_profile_type = 'contractor' and item.contractor_id = link.legacy_profile_id)
     )
  ) then
    raise exception 'Canonical Workforce cutover left attendance summaries on a legacy identity.';
  end if;

  if exists (
    select 1
    from public.biometric_alerts item
    join workforce_cutover_links link
      on link.company_id = item.company_id
     and (
       (link.legacy_profile_type = 'field_executive' and item.field_executive_id = link.legacy_profile_id)
       or (link.legacy_profile_type = 'contractor' and item.contractor_id = link.legacy_profile_id)
     )
  ) then
    raise exception 'Canonical Workforce cutover left biometric alerts on a legacy identity.';
  end if;

  if exists (
    select 1
    from public.whatsapp_message_logs item
    join workforce_cutover_links link
      on (item.company_id = link.company_id or item.company_id is null)
     and (
       (link.legacy_profile_type = 'field_executive' and item.field_executive_id = link.legacy_profile_id)
       or (link.legacy_profile_type = 'contractor' and item.contractor_id = link.legacy_profile_id)
     )
  ) then
    raise exception 'Canonical Workforce cutover left WhatsApp history on a legacy identity.';
  end if;

  if exists (
    select 1
    from public.workforce_profile_change_requests item
    join workforce_cutover_links link
      on link.company_id = item.company_id
     and (
       (link.legacy_profile_type = 'field_executive' and item.field_executive_id = link.legacy_profile_id)
       or (link.legacy_profile_type = 'contractor' and item.contractor_id = link.legacy_profile_id)
     )
    where item.workforce_id is null
  ) then
    raise exception 'Canonical Workforce cutover left profile change requests without a Workforce identity.';
  end if;

  if exists (
    select 1
    from public.hr_engagements item
    join workforce_cutover_links link
      on link.company_id = item.company_id
     and link.legacy_profile_type = 'contractor'
     and item.contractor_id = link.legacy_profile_id
    where item.workforce_id is null
  ) then
    raise exception 'Canonical Workforce cutover left engagement history without a Workforce identity.';
  end if;

  if exists (
    select 1
    from public.workforce profile
    join workforce_cutover_links link
      on link.company_id = profile.company_id
     and link.target_profile_id = profile.id
    where public.workforce_profile_should_be_available(to_jsonb(profile))
      and not profile.is_active
  ) then
    raise exception 'Canonical Workforce cutover left resumable profiles inactive.';
  end if;
end;
$$;

comment on function public.sync_workforce_legacy_trigger() is
  'Compatibility sync for pre-cutover sources. Respects routing_skip_sync and cannot deactivate a resumable canonical Workforce profile.';

comment on function public.canonicalize_workforce_account_reference() is
  'Rewrites late legacy account references to canonical Workforce identities during the GitHub deployment transition.';

comment on function public.canonicalize_workforce_profile_reference() is
  'Rewrites late legacy profile references to canonical Workforce identities during the GitHub deployment transition.';

comment on function public.canonicalize_workforce_recipient_reference() is
  'Rewrites late legacy notification recipients to canonical Workforce identities during the GitHub deployment transition.';

comment on function public.canonicalize_workforce_legacy_columns() is
  'Adds canonical Workforce identities to late writes made through legacy field-executive or contractor foreign-key columns.';

comment on function public.mirror_workforce_registration_draft() is
  'Mirrors pending registration drafts between canonical Workforce and legacy compatibility identities until registration completes.';

comment on function public.mirror_workforce_profile_verification() is
  'Mirrors registration verification evidence between canonical Workforce and legacy compatibility identities during cutover.';

comment on table public.workforce is
  'Canonical register for designation-master classified Workforce profiles. Legacy source rows are retained only as compatibility aliases.';

notify pgrst, 'reload schema';

commit;
