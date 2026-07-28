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
  created_at timestamptz not null default now()
);

create index if not exists verification_api_audit_logs_company_created_idx
  on public.verification_api_audit_logs (company_id, created_at desc);

create index if not exists verification_api_audit_logs_company_kind_idx
  on public.verification_api_audit_logs (company_id, verification_kind, created_at desc);

create index if not exists verification_api_audit_logs_company_account_idx
  on public.verification_api_audit_logs (company_id, profile_type, account_id, created_at desc);

alter table public.verification_api_audit_logs enable row level security;

drop policy if exists service_role_verification_api_audit_logs_all
  on public.verification_api_audit_logs;

create policy service_role_verification_api_audit_logs_all
on public.verification_api_audit_logs
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

