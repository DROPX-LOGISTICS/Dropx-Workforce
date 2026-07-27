create extension if not exists pgcrypto;

create table if not exists public.mob_app_user_preferences (
  id uuid primary key default gen_random_uuid(),
  country_code text not null default '91',
  mobile_number text not null,
  default_company_id uuid,
  default_profile_type text,
  default_account_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mob_app_user_preferences_default_account_check
    check (
      (default_company_id is null and default_profile_type is null and default_account_id is null)
      or
      (default_company_id is not null and default_profile_type is not null and default_account_id is not null)
    )
);

create unique index if not exists mob_app_user_preferences_mobile_unique
  on public.mob_app_user_preferences (country_code, mobile_number);

create index if not exists mob_app_user_preferences_default_account_idx
  on public.mob_app_user_preferences (default_profile_type, default_account_id);

alter table public.mob_app_user_preferences enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'mob_app_user_preferences'
      and policyname = 'service_role_mob_app_user_preferences_all'
  ) then
    create policy "service_role_mob_app_user_preferences_all"
      on public.mob_app_user_preferences
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;

notify pgrst, 'reload schema';
