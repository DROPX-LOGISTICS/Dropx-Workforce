create table if not exists public.email_notification_settings (
  id boolean primary key default true,
  company_id uuid not null references public.companies(id) on delete cascade,
  is_enabled boolean not null default false,
  smtp_host text,
  smtp_port integer not null default 587 check (smtp_port between 1 and 65535),
  smtp_secure boolean not null default false,
  smtp_user text,
  smtp_pass text,
  smtp_from text,
  from_name text,
  updated_at timestamptz not null default now(),
  constraint email_notification_settings_singleton check (id = true)
);

create unique index if not exists email_notification_settings_company_id_key
  on public.email_notification_settings (company_id);

alter table public.email_notification_settings enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'email_notification_settings'
      and policyname = 'service_role_email_notification_settings_all'
  ) then
    create policy "service_role_email_notification_settings_all"
      on public.email_notification_settings
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;
