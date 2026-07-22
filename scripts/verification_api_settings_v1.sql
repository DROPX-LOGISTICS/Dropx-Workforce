create table if not exists public.verification_api_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  provider_code text not null check (provider_code in ('idspay')),
  is_enabled boolean not null default false,
  api_id text,
  api_key_secret_id uuid,
  token_id_secret_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  unique (company_id, provider_code)
);

alter table public.verification_api_settings
  add column if not exists is_enabled boolean not null default false;

alter table public.verification_api_settings enable row level security;

drop policy if exists verification_api_settings_company_select on public.verification_api_settings;
create policy verification_api_settings_company_select
on public.verification_api_settings
for select
using (auth.role() = 'service_role');

drop policy if exists verification_api_settings_company_write on public.verification_api_settings;
create policy verification_api_settings_company_write
on public.verification_api_settings
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create or replace function public.set_verification_api_secret(
  company_uuid uuid,
  provider text,
  secret_kind text,
  secret_value text
)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  secret_id uuid;
  normalized_provider text := lower(trim(provider));
  normalized_kind text := lower(trim(secret_kind));
begin
  if normalized_provider not in ('idspay') then
    raise exception 'Unsupported verification API provider: %', provider;
  end if;

  if normalized_kind not in ('api_key', 'token_id') then
    raise exception 'Unsupported verification API secret kind: %', secret_kind;
  end if;

  select vault.create_secret(
    secret_value,
    'dropx_verification_' || normalized_provider || '_' || normalized_kind || '_' || replace(company_uuid::text, '-', '') || '_' || replace(gen_random_uuid()::text, '-', ''),
    'DropX verification API ' || normalized_provider || ' ' || normalized_kind
  ) into secret_id;

  insert into public.verification_api_settings (company_id, provider_code)
  values (company_uuid, normalized_provider)
  on conflict (company_id, provider_code) do nothing;

  if normalized_kind = 'api_key' then
    update public.verification_api_settings
      set api_key_secret_id = secret_id,
          updated_at = now()
      where company_id = company_uuid and provider_code = normalized_provider;
  else
    update public.verification_api_settings
      set token_id_secret_id = secret_id,
          updated_at = now()
      where company_id = company_uuid and provider_code = normalized_provider;
  end if;

  return secret_id;
end;
$$;

create or replace function public.get_verification_api_secret(
  company_uuid uuid,
  provider text,
  secret_kind text
)
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where id = (
    select case
      when lower(trim(secret_kind)) = 'api_key' then api_key_secret_id
      when lower(trim(secret_kind)) = 'token_id' then token_id_secret_id
      else null
    end
    from public.verification_api_settings
    where company_id = company_uuid
      and provider_code = lower(trim(provider))
  )
  limit 1;
$$;

revoke all on function public.set_verification_api_secret(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.get_verification_api_secret(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_verification_api_secret(uuid, text, text, text) to service_role;
grant execute on function public.get_verification_api_secret(uuid, text, text) to service_role;
