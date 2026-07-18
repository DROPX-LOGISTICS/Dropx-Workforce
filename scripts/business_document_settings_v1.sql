create table if not exists public.business_document_settings (
  id boolean not null default true,
  company_id uuid not null references public.companies(id) on delete cascade,
  compliance_manager_user_id uuid references public.profiles(id) on delete set null,
  fleet_manager_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, id),
  constraint business_document_settings_singleton check (id = true)
);

alter table public.business_document_settings
  add column if not exists fleet_manager_user_id uuid references public.profiles(id) on delete set null;

create index if not exists business_document_settings_manager_idx
  on public.business_document_settings (company_id, compliance_manager_user_id);

create index if not exists business_document_settings_fleet_manager_idx
  on public.business_document_settings (company_id, fleet_manager_user_id);

alter table public.business_document_settings enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'business_document_settings'
      and policyname = 'service_role_business_document_settings_all'
  ) then
    create policy "service_role_business_document_settings_all"
      on public.business_document_settings
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

alter table public.document_types
  drop column if exists compliance_manager_user_id;
