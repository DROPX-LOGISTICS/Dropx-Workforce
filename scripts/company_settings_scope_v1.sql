create extension if not exists pgcrypto;
create extension if not exists supabase_vault with schema vault;

do $$
declare
  master_company uuid;
  table_name text;
begin
  select id into master_company
  from public.companies
  where code = 'DROPX_LOGISTICS'
  limit 1;

  if master_company is null then
    raise exception 'Master company DROPX_LOGISTICS was not found.';
  end if;

  foreach table_name in array array[
    'meta_leads_settings',
    'meta_messaging_settings',
    'whatsapp_settings',
    'wheelseye_settings'
  ]
  loop
    execute format('alter table public.%I add column if not exists company_id uuid references public.companies(id) on delete cascade', table_name);
    execute format('update public.%I set company_id = $1 where company_id is null', table_name) using master_company;
    execute format('alter table public.%I drop constraint if exists %I', table_name, table_name || '_pkey');
    execute format('create unique index if not exists %I on public.%I(company_id, id)', left(table_name || '_company_id_id_uidx', 63), table_name);
    execute format('create index if not exists %I on public.%I(company_id)', left(table_name || '_company_id_idx', 63), table_name);
  end loop;

  alter table public.whatsapp_notification_configs
    add column if not exists company_id uuid references public.companies(id) on delete cascade;

  update public.whatsapp_notification_configs
  set company_id = master_company
  where company_id is null;

  alter table public.whatsapp_notification_configs
    drop constraint if exists whatsapp_notification_configs_event_code_key;

  create unique index if not exists whatsapp_notification_configs_company_event_uidx
    on public.whatsapp_notification_configs(company_id, event_code);
end $$;

create or replace function public.set_meta_app_secret(secret_value text, company_uuid uuid)
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
    'dropx_meta_app_secret_' || replace(company_uuid::text, '-', '') || '_' || replace(gen_random_uuid()::text, '-', ''),
    'DropX Meta app secret'
  ) into secret_id;

  insert into public.meta_messaging_settings (id, company_id, app_secret_secret_id, updated_at)
  values (true, company_uuid, secret_id, now())
  on conflict (company_id, id) do update
    set app_secret_secret_id = excluded.app_secret_secret_id,
        updated_at = now();

  return secret_id;
end;
$$;

create or replace function public.get_meta_app_secret(company_uuid uuid)
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where id = (
    select app_secret_secret_id
    from public.meta_messaging_settings
    where company_id = company_uuid and id = true
  )
  limit 1;
$$;

create or replace function public.set_meta_page_access_token(secret_value text, company_uuid uuid)
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
    'dropx_meta_page_access_token_' || replace(company_uuid::text, '-', '') || '_' || replace(gen_random_uuid()::text, '-', ''),
    'DropX Meta Page access token'
  ) into secret_id;

  insert into public.meta_messaging_settings (id, company_id, page_access_token_secret_id, updated_at)
  values (true, company_uuid, secret_id, now())
  on conflict (company_id, id) do update
    set page_access_token_secret_id = excluded.page_access_token_secret_id,
        updated_at = now();

  return secret_id;
end;
$$;

create or replace function public.get_meta_page_access_token(company_uuid uuid)
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where id = (
    select page_access_token_secret_id
    from public.meta_messaging_settings
    where company_id = company_uuid and id = true
  )
  limit 1;
$$;

create or replace function public.set_whatsapp_access_token(secret_value text, company_uuid uuid)
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
    'dropx_whatsapp_access_token_' || replace(company_uuid::text, '-', '') || '_' || replace(gen_random_uuid()::text, '-', ''),
    'DropX WhatsApp access token'
  ) into secret_id;

  insert into public.whatsapp_settings (id, company_id, token_secret_id, updated_at)
  values (true, company_uuid, secret_id, now())
  on conflict (company_id, id) do update
    set token_secret_id = excluded.token_secret_id,
        updated_at = now();

  return secret_id;
end;
$$;

create or replace function public.get_whatsapp_access_token(company_uuid uuid)
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where id = (
    select token_secret_id
    from public.whatsapp_settings
    where company_id = company_uuid and id = true
  )
  limit 1;
$$;

create or replace function public.set_meta_leads_app_secret(secret_value text, company_uuid uuid)
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
    'dropx_meta_leads_app_secret_' || replace(company_uuid::text, '-', '') || '_' || replace(gen_random_uuid()::text, '-', ''),
    'DropX Meta Leads app secret'
  ) into secret_id;

  insert into public.meta_leads_settings (id, company_id, app_secret_secret_id, updated_at)
  values (true, company_uuid, secret_id, now())
  on conflict (company_id, id) do update
    set app_secret_secret_id = excluded.app_secret_secret_id,
        updated_at = now();

  return secret_id;
end;
$$;

create or replace function public.get_meta_leads_app_secret(company_uuid uuid)
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where id = (
    select app_secret_secret_id
    from public.meta_leads_settings
    where company_id = company_uuid and id = true
  )
  limit 1;
$$;

create or replace function public.set_meta_leads_access_token(secret_value text, company_uuid uuid)
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
    'dropx_meta_leads_access_token_' || replace(company_uuid::text, '-', '') || '_' || replace(gen_random_uuid()::text, '-', ''),
    'DropX Meta Leads access token'
  ) into secret_id;

  insert into public.meta_leads_settings (id, company_id, access_token_secret_id, updated_at)
  values (true, company_uuid, secret_id, now())
  on conflict (company_id, id) do update
    set access_token_secret_id = excluded.access_token_secret_id,
        updated_at = now();

  return secret_id;
end;
$$;

create or replace function public.get_meta_leads_access_token(company_uuid uuid)
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where id = (
    select access_token_secret_id
    from public.meta_leads_settings
    where company_id = company_uuid and id = true
  )
  limit 1;
$$;

create or replace function public.set_wheelseye_access_token(secret_value text, company_uuid uuid)
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
    'dropx_wheelseye_access_token_' || replace(company_uuid::text, '-', '') || '_' || replace(gen_random_uuid()::text, '-', ''),
    'DropX Wheelseye API token'
  ) into secret_id;

  insert into public.wheelseye_settings (id, company_id, token_secret_id, updated_at)
  values (true, company_uuid, secret_id, now())
  on conflict (company_id, id) do update
    set token_secret_id = excluded.token_secret_id,
        updated_at = now();

  return secret_id;
end;
$$;

create or replace function public.get_wheelseye_access_token(company_uuid uuid)
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where id = (
    select token_secret_id
    from public.wheelseye_settings
    where company_id = company_uuid and id = true
  )
  limit 1;
$$;

revoke all on function public.set_meta_app_secret(text, uuid) from public, anon, authenticated;
revoke all on function public.get_meta_app_secret(uuid) from public, anon, authenticated;
revoke all on function public.set_meta_page_access_token(text, uuid) from public, anon, authenticated;
revoke all on function public.get_meta_page_access_token(uuid) from public, anon, authenticated;
revoke all on function public.set_whatsapp_access_token(text, uuid) from public, anon, authenticated;
revoke all on function public.get_whatsapp_access_token(uuid) from public, anon, authenticated;
revoke all on function public.set_meta_leads_app_secret(text, uuid) from public, anon, authenticated;
revoke all on function public.get_meta_leads_app_secret(uuid) from public, anon, authenticated;
revoke all on function public.set_meta_leads_access_token(text, uuid) from public, anon, authenticated;
revoke all on function public.get_meta_leads_access_token(uuid) from public, anon, authenticated;
revoke all on function public.set_wheelseye_access_token(text, uuid) from public, anon, authenticated;
revoke all on function public.get_wheelseye_access_token(uuid) from public, anon, authenticated;

grant execute on function public.set_meta_app_secret(text, uuid) to service_role;
grant execute on function public.get_meta_app_secret(uuid) to service_role;
grant execute on function public.set_meta_page_access_token(text, uuid) to service_role;
grant execute on function public.get_meta_page_access_token(uuid) to service_role;
grant execute on function public.set_whatsapp_access_token(text, uuid) to service_role;
grant execute on function public.get_whatsapp_access_token(uuid) to service_role;
grant execute on function public.set_meta_leads_app_secret(text, uuid) to service_role;
grant execute on function public.get_meta_leads_app_secret(uuid) to service_role;
grant execute on function public.set_meta_leads_access_token(text, uuid) to service_role;
grant execute on function public.get_meta_leads_access_token(uuid) to service_role;
grant execute on function public.set_wheelseye_access_token(text, uuid) to service_role;
grant execute on function public.get_wheelseye_access_token(uuid) to service_role;
