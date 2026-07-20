create extension if not exists pgcrypto;
create extension if not exists supabase_vault with schema vault;

create table if not exists public.whatsapp_settings (
  id boolean primary key default true check (id),
  is_enabled boolean not null default false,
  business_account_id text,
  phone_number_id text,
  graph_api_version text not null default 'v23.0',
  default_country_code text not null default '91',
  registration_url_template text,
  webhook_verify_token text,
  token_secret_id uuid,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.whatsapp_template_cache (
  id uuid primary key default gen_random_uuid(),
  template_id text not null unique,
  name text not null,
  language text not null,
  category text,
  status text not null,
  components jsonb not null default '[]'::jsonb,
  synced_at timestamptz not null default now()
);

create table if not exists public.whatsapp_notification_configs (
  id uuid primary key default gen_random_uuid(),
  event_code text not null unique,
  is_enabled boolean not null default false,
  template_id text references public.whatsapp_template_cache(template_id),
  template_name text,
  template_language text,
  variable_mappings jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.whatsapp_message_logs (
  id uuid primary key default gen_random_uuid(),
  event_code text not null,
  field_executive_id uuid references public.field_executives(id) on delete set null,
  recipient text not null,
  template_name text,
  status text not null check (status in ('sent', 'failed', 'skipped')),
  provider_message_id text,
  error_message text,
  request_payload jsonb,
  response_payload jsonb,
  created_at timestamptz not null default now()
);

alter table public.field_executives
  add column if not exists onboarding_token_hash text,
  add column if not exists onboarding_token_expires_at timestamptz,
  add column if not exists onboarding_status text not null default 'pending';

create or replace function public.set_whatsapp_access_token(secret_value text)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  secret_id uuid;
begin
  select vault.create_secret(
    secret_value,
    'dropx_whatsapp_access_token_' || replace(gen_random_uuid()::text, '-', ''),
    'DropX WhatsApp Cloud API token'
  ) into secret_id;

  update public.whatsapp_settings
    set token_secret_id = secret_id, updated_at = now()
    where id = true;

  return secret_id;
end;
$$;

create or replace function public.get_whatsapp_access_token()
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where id = (select token_secret_id from public.whatsapp_settings where id = true)
  limit 1;
$$;

revoke all on function public.set_whatsapp_access_token(text) from public, anon, authenticated;
revoke all on function public.get_whatsapp_access_token() from public, anon, authenticated;
grant execute on function public.set_whatsapp_access_token(text) to service_role;
grant execute on function public.get_whatsapp_access_token() to service_role;

alter table public.whatsapp_settings enable row level security;
alter table public.whatsapp_template_cache enable row level security;
alter table public.whatsapp_notification_configs enable row level security;
alter table public.whatsapp_message_logs enable row level security;

insert into public.whatsapp_settings (id) values (true) on conflict (id) do nothing;
insert into public.whatsapp_notification_configs (event_code) values ('employee_onboarding') on conflict (event_code) do nothing;
insert into public.whatsapp_notification_configs (event_code) values ('field_executive_onboarding') on conflict (event_code) do nothing;
insert into public.whatsapp_notification_configs (event_code) values ('vendor_onboarding') on conflict (event_code) do nothing;
