create table if not exists public.connect_profile_verifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_type text not null check (profile_type in ('employee', 'field_executive')),
  account_id uuid not null,
  kind text not null check (kind in ('pan', 'pan_aadhaar', 'dl', 'vehicle', 'bank', 'pf_uan')),
  input_key text not null,
  verified boolean not null default false,
  manual_review boolean not null default false,
  block_submit boolean not null default false,
  display_name text,
  message text,
  details jsonb not null default '{}'::jsonb,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, profile_type, account_id, kind)
);

alter table public.connect_profile_verifications
  drop constraint if exists connect_profile_verifications_kind_check;

alter table public.connect_profile_verifications
  add constraint connect_profile_verifications_kind_check
  check (kind in ('pan', 'pan_aadhaar', 'dl', 'vehicle', 'bank', 'pf_uan'));

create index if not exists connect_profile_verifications_account_idx
  on public.connect_profile_verifications (company_id, profile_type, account_id);

alter table public.connect_profile_verifications enable row level security;

drop policy if exists service_role_connect_profile_verifications_all on public.connect_profile_verifications;
create policy service_role_connect_profile_verifications_all
on public.connect_profile_verifications
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
