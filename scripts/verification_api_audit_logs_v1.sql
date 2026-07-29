create table if not exists public.verification_api_audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  provider_code text not null,
  verification_kind text not null,
  endpoint text not null,
  source text not null,
  profile_type text,
  account_id uuid,
  account_code text,
  profile_name text,
  actor_user_id uuid,
  actor_label text,
  request_data jsonb not null default '{}'::jsonb,
  response_data jsonb not null default '{}'::jsonb,
  http_status integer,
  is_success boolean not null default false,
  result_code text,
  result_message text,
  duration_ms integer,
  input_hash text,
  request_status text not null default 'completed'
    check (request_status in ('processing', 'completed', 'failed')),
  cache_expires_at timestamptz,
  completed_at timestamptz,
  is_cache_hit boolean not null default false,
  original_log_id uuid references public.verification_api_audit_logs(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists verification_api_audit_logs_company_created_idx
  on public.verification_api_audit_logs (company_id, created_at desc);

create index if not exists verification_api_audit_logs_company_kind_idx
  on public.verification_api_audit_logs (company_id, verification_kind, created_at desc);

create index if not exists verification_api_audit_logs_company_account_idx
  on public.verification_api_audit_logs (company_id, profile_type, account_id, created_at desc);

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

alter table public.verification_api_audit_logs enable row level security;

drop policy if exists service_role_verification_api_audit_logs_all
  on public.verification_api_audit_logs;

create policy service_role_verification_api_audit_logs_all
on public.verification_api_audit_logs
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
