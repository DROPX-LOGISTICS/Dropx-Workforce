create table if not exists public.document_type_role_access (
  company_id uuid not null references public.companies(id) on delete cascade,
  document_type_id uuid not null references public.document_types(id) on delete cascade,
  role_id uuid not null references public.user_roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (company_id, document_type_id, role_id)
);

create index if not exists document_type_role_access_role_idx
  on public.document_type_role_access (company_id, role_id);

alter table public.document_type_role_access enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'document_type_role_access'
      and policyname = 'service_role_document_type_role_access_all'
  ) then
    create policy "service_role_document_type_role_access_all"
      on public.document_type_role_access
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;
