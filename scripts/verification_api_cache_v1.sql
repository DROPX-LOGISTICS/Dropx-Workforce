alter table public.verification_api_audit_logs
  add column if not exists input_hash text,
  add column if not exists request_status text not null default 'completed',
  add column if not exists cache_expires_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists is_cache_hit boolean not null default false,
  add column if not exists original_log_id uuid references public.verification_api_audit_logs(id) on delete set null;

update public.verification_api_audit_logs
set request_status = 'completed'
where request_status is null;

alter table public.verification_api_audit_logs
  drop constraint if exists verification_api_audit_logs_request_status_check;

alter table public.verification_api_audit_logs
  add constraint verification_api_audit_logs_request_status_check
  check (request_status in ('processing', 'completed', 'failed'));

create index if not exists verification_api_audit_logs_cache_lookup_idx
  on public.verification_api_audit_logs (
    company_id,
    provider_code,
    verification_kind,
    endpoint,
    input_hash,
    cache_expires_at desc
  )
  where request_status = 'completed' and input_hash is not null;

create unique index if not exists verification_api_audit_logs_processing_unique_idx
  on public.verification_api_audit_logs (
    company_id,
    provider_code,
    verification_kind,
    endpoint,
    input_hash
  )
  where request_status = 'processing' and input_hash is not null;

create or replace function public.claim_verification_api_request(
  p_company_id uuid,
  p_provider_code text,
  p_verification_kind text,
  p_endpoint text,
  p_input_hash text,
  p_source text,
  p_profile_type text default null,
  p_account_id uuid default null,
  p_account_code text default null,
  p_profile_name text default null,
  p_actor_user_id uuid default null,
  p_actor_label text default null,
  p_request_data jsonb default '{}'::jsonb
)
returns table (
  action text,
  log_id uuid,
  response_data jsonb,
  http_status integer,
  is_success boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  cached_row public.verification_api_audit_logs%rowtype;
  processing_row public.verification_api_audit_logs%rowtype;
  created_id uuid;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws('|', p_company_id::text, lower(p_provider_code), lower(p_verification_kind), p_endpoint, p_input_hash),
      0
    )
  );

  select *
  into cached_row
  from public.verification_api_audit_logs
  where company_id = p_company_id
    and lower(provider_code) = lower(p_provider_code)
    and lower(verification_kind) = lower(p_verification_kind)
    and endpoint = p_endpoint
    and input_hash = p_input_hash
    and request_status = 'completed'
    and is_cache_hit = false
    and cache_expires_at > now()
  order by created_at desc
  limit 1;

  if cached_row.id is not null then
    insert into public.verification_api_audit_logs (
      company_id,
      provider_code,
      verification_kind,
      endpoint,
      source,
      profile_type,
      account_id,
      account_code,
      profile_name,
      actor_user_id,
      actor_label,
      request_data,
      response_data,
      http_status,
      is_success,
      result_code,
      result_message,
      duration_ms,
      input_hash,
      request_status,
      cache_expires_at,
      completed_at,
      is_cache_hit,
      original_log_id
    )
    values (
      p_company_id,
      p_provider_code,
      p_verification_kind,
      p_endpoint,
      p_source,
      p_profile_type,
      p_account_id,
      p_account_code,
      p_profile_name,
      p_actor_user_id,
      p_actor_label,
      coalesce(p_request_data, '{}'::jsonb),
      cached_row.response_data,
      cached_row.http_status,
      cached_row.is_success,
      cached_row.result_code,
      cached_row.result_message,
      0,
      p_input_hash,
      'completed',
      cached_row.cache_expires_at,
      now(),
      true,
      coalesce(cached_row.original_log_id, cached_row.id)
    )
    returning id into created_id;

    return query
      select 'cached'::text, created_id, cached_row.response_data, cached_row.http_status, cached_row.is_success;
    return;
  end if;

  select *
  into processing_row
  from public.verification_api_audit_logs
  where company_id = p_company_id
    and lower(provider_code) = lower(p_provider_code)
    and lower(verification_kind) = lower(p_verification_kind)
    and endpoint = p_endpoint
    and input_hash = p_input_hash
    and request_status = 'processing'
    and created_at > now() - interval '2 minutes'
  order by created_at desc
  limit 1;

  if processing_row.id is not null then
    return query
      select 'processing'::text, processing_row.id, '{}'::jsonb, null::integer, null::boolean;
    return;
  end if;

  update public.verification_api_audit_logs
  set request_status = 'failed',
      completed_at = now(),
      result_message = coalesce(result_message, 'Verification request timed out.')
  where company_id = p_company_id
    and lower(provider_code) = lower(p_provider_code)
    and lower(verification_kind) = lower(p_verification_kind)
    and endpoint = p_endpoint
    and input_hash = p_input_hash
    and request_status = 'processing';

  insert into public.verification_api_audit_logs (
    company_id,
    provider_code,
    verification_kind,
    endpoint,
    source,
    profile_type,
    account_id,
    account_code,
    profile_name,
    actor_user_id,
    actor_label,
    request_data,
    response_data,
    is_success,
    input_hash,
    request_status,
    is_cache_hit
  )
  values (
    p_company_id,
    p_provider_code,
    p_verification_kind,
    p_endpoint,
    p_source,
    p_profile_type,
    p_account_id,
    p_account_code,
    p_profile_name,
    p_actor_user_id,
    p_actor_label,
    coalesce(p_request_data, '{}'::jsonb),
    '{}'::jsonb,
    false,
    p_input_hash,
    'processing',
    false
  )
  returning id into created_id;

  return query
    select 'claimed'::text, created_id, '{}'::jsonb, null::integer, null::boolean;
end;
$$;

revoke all on function public.claim_verification_api_request(
  uuid, text, text, text, text, text, text, uuid, text, text, uuid, text, jsonb
) from public;

grant execute on function public.claim_verification_api_request(
  uuid, text, text, text, text, text, text, uuid, text, text, uuid, text, jsonb
) to service_role;
