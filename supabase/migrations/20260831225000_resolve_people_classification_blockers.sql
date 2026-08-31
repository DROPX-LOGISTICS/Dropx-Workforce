begin;

-- People and Workforce previously shared a legacy contractor shape. Keep its
-- Workforce lifecycle compatibility column populated without making it part of
-- the People legal-source decision.
create or replace function public.normalize_people_contractor_lifecycle_compat()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.lifecycle_status := coalesce(nullif(btrim(new.lifecycle_status), ''), 'active');
  return new;
end
$$;

drop trigger if exists contractors_normalize_lifecycle_compat on public.contractors;
create trigger contractors_normalize_lifecycle_compat
before insert on public.contractors
for each row execute function public.normalize_people_contractor_lifecycle_compat();

-- Preserve the complete, already-audited correction routine as the core and
-- put collision-safe mobile-token reconciliation in front of it. A worker can
-- have both an archived target token and a current source token for the same
-- device after the faulty transition. Merge that duplicate instead of dropping
-- either the live push token or the whole profile correction.
alter function public.reclassify_people_worker(uuid,text,text,uuid,text)
  rename to reclassify_people_worker_core;

revoke all on function public.reclassify_people_worker_core(uuid,text,text,uuid,text)
  from public, anon, authenticated, service_role;

create function public.reclassify_people_worker(
  p_company_id uuid,
  p_worker_code text,
  p_target_worker_type text,
  p_actor_user_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_worker_type text;
  source_record_id uuid;
begin
  if p_target_worker_type = 'contractor' then
    source_worker_type := 'employee';
    select employee.id into source_record_id
    from public.employees employee
    where employee.company_id = p_company_id
      and employee.deleted_at is null
      and upper(employee.employee_code) = upper(btrim(p_worker_code));
  elsif p_target_worker_type = 'employee' then
    source_worker_type := 'contractor';
    select contractor.id into source_record_id
    from public.contractors contractor
    where contractor.company_id = p_company_id
      and contractor.deleted_at is null
      and upper(contractor.dropx_id) = upper(btrim(p_worker_code));
  else
    raise exception 'Target type must be Employee or Independent Contractor.';
  end if;

  if source_record_id is null then
    raise exception 'The current People source for % was not found.', upper(btrim(p_worker_code));
  end if;

  if to_regclass('public.mob_app_device_tokens') is not null then
    update public.mob_app_device_tokens target
    set push_token = source.push_token,
        app_version = coalesce(source.app_version, target.app_version),
        platform = coalesce(source.platform, target.platform),
        is_active = source.is_active,
        last_seen_at = greatest(target.last_seen_at, source.last_seen_at),
        updated_at = greatest(target.updated_at, source.updated_at)
    from public.mob_app_device_tokens source
    where target.company_id = p_company_id
      and target.profile_type = p_target_worker_type
      and target.account_id = source_record_id
      and source.company_id = target.company_id
      and source.profile_type = source_worker_type
      and source.account_id = source_record_id
      and source.device_id = target.device_id;

    delete from public.mob_app_device_tokens source
    using public.mob_app_device_tokens target
    where source.company_id = p_company_id
      and source.profile_type = source_worker_type
      and source.account_id = source_record_id
      and target.company_id = source.company_id
      and target.profile_type = p_target_worker_type
      and target.account_id = source_record_id
      and target.device_id = source.device_id;

    update public.mob_app_device_tokens
    set profile_type = p_target_worker_type,
        updated_at = now()
    where company_id = p_company_id
      and profile_type = source_worker_type
      and account_id = source_record_id;
  end if;

  return public.reclassify_people_worker_core(
    p_company_id,
    p_worker_code,
    p_target_worker_type,
    p_actor_user_id,
    p_reason
  );
end
$$;

revoke all on function public.reclassify_people_worker(uuid,text,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.reclassify_people_worker(uuid,text,text,uuid,text)
  to service_role;

-- Retry only the rows that the first pass left visibly in the wrong source.
-- Each retry remains atomic. Any new blocker is recorded without disturbing
-- attendance, pay, reporting or the successful corrections around it.
do $$
declare
  item record;
  failure text;
begin
  for item in
    select audit.company_id, audit.worker_type, audit.worker_id,
           upper(audit.worker_code) as worker_code,
           audit.expected_worker_type,
           audit.statutory_applicability,
           audit.transition_affected,
           audit.recoverable_counterpart
    from public.people_worker_classification_audit audit
    where audit.classification_state = 'wrong_source'
      and nullif(btrim(coalesce(audit.worker_code,'')), '') is not null
    order by audit.company_id, audit.worker_code
  loop
    begin
      perform public.reclassify_people_worker(
        item.company_id,
        item.worker_code,
        item.expected_worker_type,
        null,
        'Retried statutory reconciliation after safely merging a duplicate mobile-device token or normalizing the legacy contractor lifecycle field.'
      );
    exception when others then
      failure := sqlerrm;
      insert into public.hr_worker_classification_reconciliations (
        company_id, worker_code, from_worker_type, to_worker_type,
        source_record_id, status, reason, evidence, error_message, updated_at
      ) values (
        item.company_id, item.worker_code, item.worker_type, item.expected_worker_type,
        item.worker_id, 'blocked',
        'Statutory source reconciliation remains stopped because a dependency could not be preserved safely.',
        jsonb_build_object(
          'statutory_applicability', item.statutory_applicability,
          'transition_affected', item.transition_affected,
          'recoverable_counterpart', item.recoverable_counterpart,
          'automatic_change_applied', false
        ),
        failure, now()
      )
      on conflict (company_id, worker_code, from_worker_type, to_worker_type) do update
      set source_record_id = excluded.source_record_id,
          status = 'blocked',
          reason = excluded.reason,
          evidence = excluded.evidence,
          error_message = excluded.error_message,
          updated_at = now();
    end;
  end loop;
end
$$;

commit;
