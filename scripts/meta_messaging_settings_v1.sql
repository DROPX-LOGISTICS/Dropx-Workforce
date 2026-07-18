create extension if not exists pgcrypto;
create extension if not exists supabase_vault with schema vault;

create table if not exists public.meta_messaging_settings (
  id boolean primary key default true check (id),
  is_facebook_enabled boolean not null default false,
  is_instagram_enabled boolean not null default false,
  meta_app_id text,
  graph_api_version text not null default 'v25.0',
  webhook_verify_token text,
  facebook_page_id text,
  facebook_page_name text,
  instagram_business_account_id text,
  instagram_connected_page_id text,
  app_secret_secret_id uuid,
  page_access_token_secret_id uuid,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_meta_app_secret(secret_value text)
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
    'dropx_meta_app_secret_' || replace(gen_random_uuid()::text, '-', ''),
    'DropX Meta app secret'
  ) into secret_id;

  update public.meta_messaging_settings
    set app_secret_secret_id = secret_id, updated_at = now()
    where id = true;

  return secret_id;
end;
$$;

create or replace function public.set_meta_page_access_token(secret_value text)
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
    'dropx_meta_page_access_token_' || replace(gen_random_uuid()::text, '-', ''),
    'DropX Meta Page access token'
  ) into secret_id;

  update public.meta_messaging_settings
    set page_access_token_secret_id = secret_id, updated_at = now()
    where id = true;

  return secret_id;
end;
$$;

create or replace function public.get_meta_app_secret()
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where id = (select app_secret_secret_id from public.meta_messaging_settings where id = true)
  limit 1;
$$;

create or replace function public.get_meta_page_access_token()
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where id = (select page_access_token_secret_id from public.meta_messaging_settings where id = true)
  limit 1;
$$;

revoke all on function public.set_meta_app_secret(text) from public, anon, authenticated;
revoke all on function public.set_meta_page_access_token(text) from public, anon, authenticated;
revoke all on function public.get_meta_app_secret() from public, anon, authenticated;
revoke all on function public.get_meta_page_access_token() from public, anon, authenticated;
grant execute on function public.set_meta_app_secret(text) to service_role;
grant execute on function public.set_meta_page_access_token(text) to service_role;
grant execute on function public.get_meta_app_secret() to service_role;
grant execute on function public.get_meta_page_access_token() to service_role;

alter table public.meta_messaging_settings enable row level security;

insert into public.meta_messaging_settings (id) values (true) on conflict (id) do nothing;
