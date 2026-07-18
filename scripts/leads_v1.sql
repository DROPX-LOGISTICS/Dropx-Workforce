create extension if not exists pgcrypto;

insert into public.app_pages (code, name, sort_order, is_active, updated_at)
values
  ('leads', 'Leads', 30, true, now()),
  ('leads_dashboard', 'Lead Dashboard', 31, true, now()),
  ('leads_all', 'All Leads', 32, true, now()),
  ('leads_followups', 'Follow-ups', 33, true, now()),
  ('leads_interviews', 'Interviews', 34, true, now()),
  ('leads_reports', 'Lead Reports', 35, true, now()),
  ('leads_ads', 'All Ads', 36, true, now()),
  ('leads_sop', 'Ad SOP', 37, true, now()),
  ('meta_leads_settings', 'Meta Leads Settings', 131, true, now())
on conflict (code) do update set
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();

insert into public.role_page_permissions (role_id, page_id, can_view, can_add, can_edit, updated_at)
select user_roles.id, app_pages.id, true, true, true, now()
from public.user_roles
cross join public.app_pages
where lower(user_roles.code) = 'owner'
  and app_pages.code in (
    'leads',
    'leads_dashboard',
    'leads_all',
    'leads_followups',
    'leads_interviews',
    'leads_reports',
    'leads_ads',
    'leads_sop',
    'meta_leads_settings'
  )
on conflict (role_id, page_id) do update set
  can_view = true,
  can_add = true,
  can_edit = true,
  updated_at = now();

create table if not exists public.meta_leads_settings (
  id boolean primary key default true,
  is_enabled boolean not null default false,
  meta_app_id text,
  graph_api_version text not null default 'v25.0',
  ad_account_id text,
  page_id text,
  page_name text,
  webhook_verify_token text,
  app_secret_secret_id uuid references vault.secrets(id) on delete set null,
  access_token_secret_id uuid references vault.secrets(id) on delete set null,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_leads_settings_singleton check (id = true)
);

insert into public.meta_leads_settings (id)
values (true)
on conflict (id) do nothing;

create or replace function public.set_meta_leads_app_secret(secret_value text)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  secret_id uuid;
begin
  if nullif(secret_value, '') is null or secret_value like '********%' then
    return null;
  end if;

  select vault.create_secret(
    secret_value,
    'dropx_meta_leads_app_secret_' || replace(gen_random_uuid()::text, '-', ''),
    'DropX Meta Leads app secret'
  ) into secret_id;

  update public.meta_leads_settings
  set app_secret_secret_id = secret_id, updated_at = now()
  where id = true;

  return secret_id;
end;
$$;

create or replace function public.get_meta_leads_app_secret()
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where id = (select app_secret_secret_id from public.meta_leads_settings where id = true)
  limit 1
$$;

create or replace function public.set_meta_leads_access_token(secret_value text)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  secret_id uuid;
begin
  if nullif(secret_value, '') is null or secret_value like '********%' then
    return null;
  end if;

  select vault.create_secret(
    secret_value,
    'dropx_meta_leads_access_token_' || replace(gen_random_uuid()::text, '-', ''),
    'DropX Meta Leads access token'
  ) into secret_id;

  update public.meta_leads_settings
  set access_token_secret_id = secret_id, updated_at = now()
  where id = true;

  return secret_id;
end;
$$;

create or replace function public.get_meta_leads_access_token()
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where id = (select access_token_secret_id from public.meta_leads_settings where id = true)
  limit 1
$$;

revoke all on function public.set_meta_leads_app_secret(text) from public, anon, authenticated;
revoke all on function public.get_meta_leads_app_secret() from public, anon, authenticated;
revoke all on function public.set_meta_leads_access_token(text) from public, anon, authenticated;
revoke all on function public.get_meta_leads_access_token() from public, anon, authenticated;
grant execute on function public.set_meta_leads_app_secret(text) to service_role;
grant execute on function public.get_meta_leads_app_secret() to service_role;
grant execute on function public.set_meta_leads_access_token(text) to service_role;
grant execute on function public.get_meta_leads_access_token() to service_role;

create table if not exists public.lead_job_roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  required_fields text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lead_ads (
  id uuid primary key default gen_random_uuid(),
  meta_ad_id text unique,
  ad_name text not null,
  station_code text,
  job_code text,
  role_id uuid references public.lead_job_roles(id) on delete set null,
  daily_budget numeric(12,2),
  total_spend numeric(14,2) not null default 0,
  leads_count integer not null default 0,
  status text not null default 'active' check (status in ('active', 'paused', 'stopped', 'archived', 'unknown')),
  poster_url text,
  created_on date,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  meta_lead_id text unique,
  lead_ad_id uuid references public.lead_ads(id) on delete set null,
  full_name text,
  phone text,
  email text,
  city text,
  postal_code text,
  station_code text,
  job_code text,
  source text not null default 'meta',
  status text not null default 'no_status',
  follow_up_at timestamptz,
  interview_at timestamptz,
  final_status text,
  remarks text,
  final_remarks text,
  work_email text,
  raw_payload jsonb not null default '{}'::jsonb,
  assigned_user_id uuid references public.profiles(id) on delete set null,
  last_updated_by uuid references public.profiles(id) on delete set null,
  lead_created_at timestamptz,
  last_status_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lead_status_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  old_status text,
  new_status text not null,
  remarks text,
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.lead_sync_logs (
  id uuid primary key default gen_random_uuid(),
  sync_type text not null default 'manual',
  status text not null default 'started',
  fetched_count integer not null default 0,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists leads_status_idx on public.leads (status);
create index if not exists leads_station_idx on public.leads (station_code);
create index if not exists leads_follow_up_idx on public.leads (follow_up_at);
create index if not exists leads_interview_idx on public.leads (interview_at);
create index if not exists leads_created_idx on public.leads (lead_created_at desc nulls last);
create index if not exists lead_ads_station_idx on public.lead_ads (station_code);
create index if not exists lead_ads_status_idx on public.lead_ads (status);

alter table public.meta_leads_settings
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

alter table public.lead_job_roles
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

alter table public.lead_ads
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

alter table public.leads
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

alter table public.lead_status_history
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

alter table public.lead_sync_logs
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

alter table public.lead_job_roles
  drop constraint if exists lead_job_roles_code_key;

alter table public.lead_ads
  drop constraint if exists lead_ads_meta_ad_id_key;

alter table public.leads
  drop constraint if exists leads_meta_lead_id_key;

create unique index if not exists meta_leads_settings_company_id_key
  on public.meta_leads_settings(company_id, id);

create unique index if not exists lead_job_roles_company_code_key
  on public.lead_job_roles(company_id, code);

create unique index if not exists lead_ads_company_meta_ad_id_key
  on public.lead_ads(company_id, meta_ad_id)
  where meta_ad_id is not null;

create unique index if not exists leads_company_meta_lead_id_key
  on public.leads(company_id, meta_lead_id)
  where meta_lead_id is not null;

alter table public.meta_leads_settings enable row level security;
alter table public.lead_job_roles enable row level security;
alter table public.lead_ads enable row level security;
alter table public.leads enable row level security;
alter table public.lead_status_history enable row level security;
alter table public.lead_sync_logs enable row level security;

insert into public.lead_job_roles (code, name, required_fields)
values
  ('DA', 'Delivery Associate', array['full_name', 'phone', 'city', 'post_code']),
  ('SSA', 'Station Support Associate', array['full_name', 'phone', 'city', 'post_code', 'Highest_Qualification', 'experience']),
  ('HMT', 'Hub Management Team', array['full_name', 'phone', 'city', 'post_code', 'Highest_Qualification', 'experience']),
  ('PC', 'Picker', array['full_name', 'phone', 'city', 'post_code']),
  ('WM', 'Wish Master', array['full_name', 'phone', 'city', 'post_code']),
  ('TL', 'Team Leader', array['full_name', 'phone', 'city', 'post_code', 'Highest_Qualification', 'experience', 'current_employer', 'Current_Monthly_Inhand_Salary']),
  ('SI', 'Shift Incharge', array['full_name', 'phone', 'city', 'post_code', 'Highest_Qualification', 'experience', 'current_employer', 'Current_Monthly_Inhand_Salary']),
  ('SM', 'Store Manager', array['full_name', 'phone', 'city', 'post_code', 'Highest_Qualification', 'experience', 'current_employer', 'Current_Monthly_Inhand_Salary']),
  ('HI', 'Hub Incharge', array['full_name', 'phone', 'city', 'post_code', 'Highest_Qualification', 'experience', 'current_employer', 'Current_Monthly_Inhand_Salary']),
  ('CLM', 'Cluster Manager', array['full_name', 'phone', 'city', 'post_code', 'Highest_Qualification', 'experience', 'current_employer', 'Current_Monthly_Inhand_Salary']),
  ('STM', 'Station Manager', array['full_name', 'phone', 'city', 'post_code', 'Highest_Qualification', 'experience', 'current_employer', 'Current_Monthly_Inhand_Salary']),
  ('DCD', 'Driver cum DA', array['full_name', 'phone', 'city', 'post_code', '4_Wheeler_License']),
  ('PTSSA', 'Part Time Station Support Associate', array['full_name', 'phone', 'city', 'post_code']),
  ('DR', 'Driver', array['full_name', 'phone', 'city', 'post_code', '4_Wheeler_License']),
  ('ODCD', 'Own Van Driver cum DA', array['full_name', 'phone', 'city', 'post_code', 'Vehicle_Model', 'Fuel_Type']),
  ('PTDA', 'Part Time Delivery Associate', array['full_name', 'phone', 'city', 'post_code']),
  ('PTPC', 'Part Time Pickers', array['full_name', 'phone', 'city', 'post_code_Flexible Day', 'Flexible_Shift']),
  ('VAN', 'Van Rent', array['full_name', 'phone', 'city', 'post_code', 'Vehicle_Model', 'Fuel_Type'])
on conflict (code) do update set
  name = excluded.name,
  required_fields = excluded.required_fields,
  is_active = true,
  updated_at = now();
