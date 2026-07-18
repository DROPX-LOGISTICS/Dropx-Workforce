create extension if not exists pgcrypto;
create extension if not exists supabase_vault with schema vault;

create table if not exists public.wheelseye_settings (
  id boolean primary key default true check (id),
  is_enabled boolean not null default false,
  token_secret_id uuid,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_wheelseye_access_token(secret_value text)
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
    'dropx_wheelseye_access_token_' || replace(gen_random_uuid()::text, '-', ''),
    'DropX Wheelseye API token'
  ) into secret_id;

  update public.wheelseye_settings
    set token_secret_id = secret_id, updated_at = now()
    where id = true;

  return secret_id;
end;
$$;

create or replace function public.get_wheelseye_access_token()
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where id = (select token_secret_id from public.wheelseye_settings where id = true)
  limit 1;
$$;

revoke all on function public.set_wheelseye_access_token(text) from public, anon, authenticated;
revoke all on function public.get_wheelseye_access_token() from public, anon, authenticated;
grant execute on function public.set_wheelseye_access_token(text) to service_role;
grant execute on function public.get_wheelseye_access_token() to service_role;

alter table public.wheelseye_settings enable row level security;

insert into public.wheelseye_settings (id) values (true) on conflict (id) do nothing;

