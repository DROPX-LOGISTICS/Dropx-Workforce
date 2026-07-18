create extension if not exists pgcrypto;
create extension if not exists supabase_vault with schema vault;

create table if not exists public.meta_channel_profiles (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('facebook', 'instagram')),
  profile_name text not null,
  page_id text,
  page_name text,
  instagram_business_account_id text,
  connected_page_id text,
  graph_api_version text not null default 'v25.0',
  access_token_secret_id uuid,
  chat_enabled boolean not null default true,
  is_active boolean not null default true,
  is_default boolean not null default false,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists meta_channel_profiles_name_idx
  on public.meta_channel_profiles (channel, lower(profile_name));

create unique index if not exists meta_channel_profiles_page_idx
  on public.meta_channel_profiles (channel, page_id)
  where page_id is not null and page_id <> '';

create unique index if not exists meta_channel_profiles_instagram_idx
  on public.meta_channel_profiles (instagram_business_account_id)
  where channel = 'instagram' and instagram_business_account_id is not null and instagram_business_account_id <> '';

create or replace function public.set_meta_channel_profile_access_token(profile_id uuid, secret_value text)
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
    'dropx_meta_channel_profile_token_' || replace(gen_random_uuid()::text, '-', ''),
    'DropX Meta channel profile token'
  ) into secret_id;

  update public.meta_channel_profiles
    set access_token_secret_id = secret_id, updated_at = now()
    where id = profile_id;

  return secret_id;
end;
$$;

create or replace function public.get_meta_channel_profile_access_token(profile_id uuid)
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where id = (select access_token_secret_id from public.meta_channel_profiles where id = profile_id)
  limit 1;
$$;

revoke all on function public.set_meta_channel_profile_access_token(uuid, text) from public, anon, authenticated;
revoke all on function public.get_meta_channel_profile_access_token(uuid) from public, anon, authenticated;
grant execute on function public.set_meta_channel_profile_access_token(uuid, text) to service_role;
grant execute on function public.get_meta_channel_profile_access_token(uuid) to service_role;

alter table public.meta_channel_profiles enable row level security;

insert into public.meta_channel_profiles (
  channel,
  profile_name,
  page_id,
  page_name,
  graph_api_version,
  access_token_secret_id,
  is_active,
  is_default
)
select
  'facebook',
  coalesce(nullif(facebook_page_name, ''), 'Facebook Page'),
  facebook_page_id,
  facebook_page_name,
  coalesce(graph_api_version, 'v25.0'),
  page_access_token_secret_id,
  coalesce(is_facebook_enabled, false),
  true
from public.meta_messaging_settings
where facebook_page_id is not null
  and facebook_page_id <> ''
  and not exists (
    select 1 from public.meta_channel_profiles
    where channel = 'facebook'
      and page_id = public.meta_messaging_settings.facebook_page_id
  );
