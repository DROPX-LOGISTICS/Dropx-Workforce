create extension if not exists pgcrypto;

create table if not exists public.connect_whatsapp_otp_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  purpose text not null default 'connect_login',
  country_code text not null default '91',
  mobile_number text not null,
  otp_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  status text not null default 'pending',
  whatsapp_profile_id uuid references public.whatsapp_profiles(id) on delete set null,
  template_id text,
  template_name text,
  template_language text,
  provider_message_id text,
  error_message text,
  request_ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connect_whatsapp_otp_status_check check (status in ('pending', 'verified', 'expired', 'failed', 'cancelled')),
  constraint connect_whatsapp_otp_attempts_check check (attempt_count >= 0 and max_attempts > 0)
);

create table if not exists public.connect_sms_otp_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  purpose text not null default 'connect_login',
  country_code text not null default '91',
  mobile_number text not null,
  otp_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  status text not null default 'pending',
  provider_name text,
  provider_message_id text,
  error_message text,
  request_ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connect_sms_otp_status_check check (status in ('pending', 'verified', 'expired', 'failed', 'cancelled')),
  constraint connect_sms_otp_attempts_check check (attempt_count >= 0 and max_attempts > 0)
);

create table if not exists public.connect_email_otp_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  purpose text not null default 'connect_login',
  email_address text not null,
  otp_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  status text not null default 'pending',
  provider_name text,
  provider_message_id text,
  error_message text,
  request_ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connect_email_otp_status_check check (status in ('pending', 'verified', 'expired', 'failed', 'cancelled')),
  constraint connect_email_otp_attempts_check check (attempt_count >= 0 and max_attempts > 0)
);

alter table public.connect_whatsapp_otp_requests
  add column if not exists company_id uuid references public.companies(id) on delete set null;

alter table public.connect_sms_otp_requests
  add column if not exists company_id uuid references public.companies(id) on delete set null;

alter table public.connect_email_otp_requests
  add column if not exists company_id uuid references public.companies(id) on delete set null;

create index if not exists connect_whatsapp_otp_lookup_idx
  on public.connect_whatsapp_otp_requests (country_code, mobile_number, purpose, status, created_at desc);

create index if not exists connect_whatsapp_otp_company_idx
  on public.connect_whatsapp_otp_requests (company_id, created_at desc);

create index if not exists connect_whatsapp_otp_expiry_idx
  on public.connect_whatsapp_otp_requests (expires_at)
  where status = 'pending';

create index if not exists connect_sms_otp_lookup_idx
  on public.connect_sms_otp_requests (country_code, mobile_number, purpose, status, created_at desc);

create index if not exists connect_sms_otp_company_idx
  on public.connect_sms_otp_requests (company_id, created_at desc);

create index if not exists connect_sms_otp_expiry_idx
  on public.connect_sms_otp_requests (expires_at)
  where status = 'pending';

create index if not exists connect_email_otp_lookup_idx
  on public.connect_email_otp_requests (lower(email_address), purpose, status, created_at desc);

create index if not exists connect_email_otp_company_idx
  on public.connect_email_otp_requests (company_id, created_at desc);

create index if not exists connect_email_otp_expiry_idx
  on public.connect_email_otp_requests (expires_at)
  where status = 'pending';

alter table public.connect_whatsapp_otp_requests enable row level security;
alter table public.connect_sms_otp_requests enable row level security;
alter table public.connect_email_otp_requests enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'connect_whatsapp_otp_requests'
      and policyname = 'service_role_connect_whatsapp_otp_all'
  ) then
    create policy "service_role_connect_whatsapp_otp_all"
      on public.connect_whatsapp_otp_requests
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'connect_sms_otp_requests'
      and policyname = 'service_role_connect_sms_otp_all'
  ) then
    create policy "service_role_connect_sms_otp_all"
      on public.connect_sms_otp_requests
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'connect_email_otp_requests'
      and policyname = 'service_role_connect_email_otp_all'
  ) then
    create policy "service_role_connect_email_otp_all"
      on public.connect_email_otp_requests
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;
