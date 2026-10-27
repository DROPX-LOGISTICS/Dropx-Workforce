-- Marsh insurance sessions/jobs + dual GMC/GPA cards + IDfy enroll queue.
-- Service-role only; worker and server actions write these rows.

-- Dual-policy insurance cards (GMC + GPA per person). Create if missing, then alter.
create table if not exists public.connect_insurance_cards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  profile_type text not null check (profile_type in ('employee', 'contractor', 'workforce')),
  profile_id uuid not null,
  drive_file_id text not null,
  file_name text,
  mime_type text,
  policy_number text,
  insurer_name text,
  valid_from date,
  valid_to date,
  policy_type text not null default 'GMC' check (policy_type in ('GMC', 'GPA')),
  membership_no text,
  pan text,
  drive_web_view_link text,
  source_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.connect_insurance_cards add column if not exists policy_type text;
alter table public.connect_insurance_cards add column if not exists membership_no text;
alter table public.connect_insurance_cards add column if not exists pan text;
alter table public.connect_insurance_cards add column if not exists drive_web_view_link text;
update public.connect_insurance_cards set policy_type = 'GMC' where policy_type is null;
alter table public.connect_insurance_cards alter column policy_type set default 'GMC';
alter table public.connect_insurance_cards alter column policy_type set not null;
alter table public.connect_insurance_cards
  drop constraint if exists connect_insurance_cards_company_id_profile_type_profile_id_key;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'connect_insurance_cards_person_policy_uidx') then
    alter table public.connect_insurance_cards
      add constraint connect_insurance_cards_person_policy_uidx
      unique (company_id, profile_type, profile_id, policy_type);
  end if;
end $$;
alter table public.connect_insurance_cards enable row level security;
revoke all on public.connect_insurance_cards from public, anon, authenticated;
grant select, insert, update, delete on public.connect_insurance_cards to service_role;

-- ── Marsh portal session (API login + OTP, cookies reused) ───────────────────
create table if not exists public.marsh_sessions (
  id uuid primary key default gen_random_uuid(),
  account_key text not null default 'default',
  cookie text,
  status text not null default 'idle'
    check (status in ('idle', 'connecting', 'otp_required', 'active', 'expired', 'failed')),
  challenge_id text,
  challenge_jar text,
  challenge_csrf text,
  challenge_expires_at timestamptz,
  last_error text,
  uploaded_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expired_at timestamptz
);
create index if not exists marsh_sessions_active_idx
  on public.marsh_sessions (account_key, status, created_at desc);
alter table public.marsh_sessions enable row level security;
revoke all on public.marsh_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.marsh_sessions to service_role;

-- ── Portal roster mirror ────────────────────────────────────────────────────
create table if not exists public.insurance_memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  pan text not null,
  policy_type text not null check (policy_type in ('GMC', 'GPA')),
  membership_no text,
  policy_number text,
  full_name text,
  relationship_type text,
  transport_id text,
  status text,
  ecard_issued boolean,
  risk_start date,
  risk_end date,
  insurer_name text,
  profile_type text check (profile_type is null or profile_type in ('employee', 'contractor', 'workforce')),
  profile_id uuid,
  source_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, pan, policy_type)
);
create index if not exists insurance_memberships_profile_idx
  on public.insurance_memberships (company_id, profile_type, profile_id);
create index if not exists insurance_memberships_pan_idx
  on public.insurance_memberships (company_id, pan);
alter table public.insurance_memberships enable row level security;
revoke all on public.insurance_memberships from public, anon, authenticated;
grant select, insert, update, delete on public.insurance_memberships to service_role;

-- ── Enroll / terminate job queues ───────────────────────────────────────────
create table if not exists public.insurance_enroll_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  pan text not null,
  policy_type text not null check (policy_type in ('GMC', 'GPA')),
  profile_type text not null check (profile_type in ('employee', 'contractor', 'workforce')),
  profile_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'skipped')),
  attempts int not null default 0,
  last_error text,
  portal_job_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index if not exists insurance_enroll_jobs_open_uidx
  on public.insurance_enroll_jobs (company_id, pan, policy_type)
  where status in ('queued', 'running');
create index if not exists insurance_enroll_jobs_claim_idx
  on public.insurance_enroll_jobs (status, created_at);
alter table public.insurance_enroll_jobs enable row level security;
revoke all on public.insurance_enroll_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.insurance_enroll_jobs to service_role;

create table if not exists public.insurance_terminate_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  pan text not null,
  profile_type text check (profile_type is null or profile_type in ('employee', 'contractor', 'workforce')),
  profile_id uuid,
  date_of_leaving date not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'skipped')),
  attempts int not null default 0,
  last_error text,
  portal_job_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index if not exists insurance_terminate_jobs_open_uidx
  on public.insurance_terminate_jobs (company_id, pan)
  where status in ('queued', 'running');
create index if not exists insurance_terminate_jobs_claim_idx
  on public.insurance_terminate_jobs (status, created_at);
alter table public.insurance_terminate_jobs enable row level security;
revoke all on public.insurance_terminate_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.insurance_terminate_jobs to service_role;

-- ── IDfy enroll queue (People / Ops / Workforce shared) ─────────────────────
create table if not exists public.idfy_enroll_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  account_key text not null default 'edsp',
  profile_type text not null check (profile_type in ('employee', 'contractor', 'workforce')),
  profile_id uuid not null,
  pan text,
  email text,
  full_name text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'skipped')),
  attempts int not null default 0,
  last_error text,
  idfy_profile_id text,
  scheduled_for timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index if not exists idfy_enroll_jobs_open_pan_uidx
  on public.idfy_enroll_jobs (company_id, account_key, pan)
  where status in ('queued', 'running') and pan is not null and pan <> '';
create unique index if not exists idfy_enroll_jobs_open_profile_uidx
  on public.idfy_enroll_jobs (company_id, account_key, profile_type, profile_id)
  where status in ('queued', 'running');
create index if not exists idfy_enroll_jobs_claim_idx
  on public.idfy_enroll_jobs (status, scheduled_for, created_at);
alter table public.idfy_enroll_jobs enable row level security;
revoke all on public.idfy_enroll_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.idfy_enroll_jobs to service_role;

create table if not exists public.idfy_enroll_settings (
  company_id uuid primary key references public.companies(id),
  buffer_days int not null default 0 check (buffer_days >= 0 and buffer_days <= 60),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.idfy_enroll_settings enable row level security;
revoke all on public.idfy_enroll_settings from public, anon, authenticated;
grant select, insert, update on public.idfy_enroll_settings to service_role;
