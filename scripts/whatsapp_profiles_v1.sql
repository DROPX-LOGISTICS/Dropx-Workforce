create extension if not exists pgcrypto;
create extension if not exists supabase_vault with schema vault;

create table if not exists public.whatsapp_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_name text not null,
  business_account_id text,
  phone_number_id text not null,
  graph_api_version text not null default 'v25.0',
  default_country_code text not null default '91',
  token_secret_id uuid,
  is_active boolean not null default true,
  is_default boolean not null default false,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists whatsapp_profiles_name_idx
  on public.whatsapp_profiles (lower(profile_name));

create unique index if not exists whatsapp_profiles_one_default_idx
  on public.whatsapp_profiles (is_default)
  where is_default = true;

alter table public.whatsapp_profiles
  add column if not exists business_account_id text;

alter table public.whatsapp_profiles
  add column if not exists greeting_enabled boolean not null default false,
  add column if not exists greeting_message text,
  add column if not exists chat_enabled boolean not null default true;

alter table public.whatsapp_profiles enable row level security;

alter table public.whatsapp_template_cache
  add column if not exists whatsapp_profile_id uuid references public.whatsapp_profiles(id) on delete set null;

alter table public.whatsapp_notification_configs
  add column if not exists whatsapp_profile_id uuid references public.whatsapp_profiles(id) on delete set null;

alter table public.whatsapp_campaigns
  add column if not exists whatsapp_profile_id uuid references public.whatsapp_profiles(id) on delete set null,
  add column if not exists whatsapp_profile_name text;

alter table public.whatsapp_message_logs
  add column if not exists whatsapp_profile_id uuid references public.whatsapp_profiles(id) on delete set null,
  add column if not exists whatsapp_profile_name text;

insert into public.whatsapp_profiles (
  profile_name,
  business_account_id,
  phone_number_id,
  graph_api_version,
  default_country_code,
  token_secret_id,
  is_active,
  is_default
)
select
  'Default',
  business_account_id,
  coalesce(nullif(phone_number_id, ''), 'not-configured'),
  coalesce(nullif(graph_api_version, ''), 'v25.0'),
  coalesce(nullif(default_country_code, ''), '91'),
  token_secret_id,
  is_enabled,
  true
from public.whatsapp_settings
where not exists (select 1 from public.whatsapp_profiles)
  and (phone_number_id is not null or token_secret_id is not null);

update public.whatsapp_profiles
set business_account_id = public.whatsapp_settings.business_account_id
from public.whatsapp_settings
where public.whatsapp_profiles.business_account_id is null
  and public.whatsapp_profiles.is_default = true
  and public.whatsapp_settings.business_account_id is not null;

update public.whatsapp_notification_configs
set whatsapp_profile_id = (select id from public.whatsapp_profiles where is_default = true limit 1)
where whatsapp_profile_id is null;

update public.whatsapp_campaigns
set
  whatsapp_profile_id = (select id from public.whatsapp_profiles where is_default = true limit 1),
  whatsapp_profile_name = (select profile_name from public.whatsapp_profiles where is_default = true limit 1)
where whatsapp_profile_id is null;

update public.whatsapp_template_cache
set whatsapp_profile_id = (select id from public.whatsapp_profiles where is_default = true limit 1)
where whatsapp_profile_id is null;

create or replace function public.set_whatsapp_profile_access_token(profile_id uuid, secret_value text)
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
    'dropx_whatsapp_profile_token_' || replace(gen_random_uuid()::text, '-', ''),
    'DropX WhatsApp profile token'
  ) into secret_id;

  update public.whatsapp_profiles
    set token_secret_id = secret_id, updated_at = now()
    where id = profile_id;

  return secret_id;
end;
$$;

create or replace function public.get_whatsapp_profile_access_token(profile_id uuid)
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where id = (select token_secret_id from public.whatsapp_profiles where id = profile_id)
  limit 1;
$$;

revoke all on function public.set_whatsapp_profile_access_token(uuid, text) from public, anon, authenticated;
revoke all on function public.get_whatsapp_profile_access_token(uuid) from public, anon, authenticated;
grant execute on function public.set_whatsapp_profile_access_token(uuid, text) to service_role;
grant execute on function public.get_whatsapp_profile_access_token(uuid) to service_role;
