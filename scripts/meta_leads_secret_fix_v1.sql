drop function if exists public.set_meta_leads_app_secret(text);
drop function if exists public.set_meta_leads_access_token(text);

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
  limit 1;
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
  limit 1;
$$;

revoke all on function public.set_meta_leads_app_secret(text) from public, anon, authenticated;
revoke all on function public.get_meta_leads_app_secret() from public, anon, authenticated;
revoke all on function public.set_meta_leads_access_token(text) from public, anon, authenticated;
revoke all on function public.get_meta_leads_access_token() from public, anon, authenticated;
grant execute on function public.set_meta_leads_app_secret(text) to service_role;
grant execute on function public.get_meta_leads_app_secret() to service_role;
grant execute on function public.set_meta_leads_access_token(text) to service_role;
grant execute on function public.get_meta_leads_access_token() to service_role;
