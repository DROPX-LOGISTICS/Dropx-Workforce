create table if not exists public.mob_app_device_tokens (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  profile_type text not null,
  account_id uuid not null,
  platform text not null,
  device_id text not null,
  push_token text,
  app_version text,
  is_active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop index if exists public.mob_app_device_tokens_push_token_unique;

create index if not exists mob_app_device_tokens_push_token_idx
  on public.mob_app_device_tokens (push_token)
  where push_token is not null;

create unique index if not exists mob_app_device_tokens_account_device_unique
  on public.mob_app_device_tokens (company_id, profile_type, account_id, device_id);

create index if not exists mob_app_device_tokens_recipient_idx
  on public.mob_app_device_tokens (company_id, profile_type, account_id)
  where is_active = true and push_token is not null;

alter table public.mob_app_device_tokens enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'mob_app_device_tokens'
      and policyname = 'service_role_mob_app_device_tokens_all'
  ) then
    create policy "service_role_mob_app_device_tokens_all"
      on public.mob_app_device_tokens
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;

notify pgrst, 'reload schema';
