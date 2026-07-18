create extension if not exists pgcrypto;

alter table public.app_pages
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

alter table public.role_page_permissions
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

update public.app_pages pages
set company_id = companies.id
from public.companies companies
where pages.company_id is null
  and (companies.is_master = true or companies.code = 'DROPX_LOGISTICS');

update public.role_page_permissions permissions
set company_id = roles.company_id
from public.user_roles roles
where permissions.company_id is null
  and permissions.role_id = roles.id
  and roles.company_id is not null;

alter table public.app_pages
  drop constraint if exists app_pages_code_key;

alter table public.user_roles
  drop constraint if exists user_roles_code_key;

alter table public.role_page_permissions
  drop constraint if exists role_page_permissions_pkey;

create unique index if not exists app_pages_company_code_key
  on public.app_pages (company_id, code);

create unique index if not exists user_roles_company_code_key
  on public.user_roles (company_id, code);

create unique index if not exists role_page_permissions_company_role_page_key
  on public.role_page_permissions (company_id, role_id, page_id);

create table if not exists public.document_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  document_module text not null default 'fleet' check (document_module in ('fleet', 'business')),
  business_scope_mode text check (business_scope_mode in ('company', 'state', 'location', 'provider')),
  doc_access_mode text not null default 'all_users' check (doc_access_mode in ('all_users', 'role_based')),
  enable_scope_access boolean not null default false,
  requires_expiry boolean not null default true,
  reminder_days integer not null default 30 check (reminder_days between 0 and 365),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.document_types
  add column if not exists document_module text not null default 'fleet',
  add column if not exists business_scope_mode text,
  add column if not exists doc_access_mode text not null default 'all_users',
  add column if not exists enable_scope_access boolean not null default false;

alter table public.document_types
  alter column business_scope_mode drop not null,
  alter column business_scope_mode drop default;

alter table public.document_types
  drop constraint if exists document_types_document_module_check,
  drop constraint if exists document_types_business_scope_mode_check,
  drop constraint if exists document_types_doc_access_mode_check;

update public.document_types
set document_module = case when code like 'BIZ_%' then 'business' else 'fleet' end,
    business_scope_mode = case
      when code like 'FLEET_%' then null
      when nullif(business_scope_mode, '') in ('company', 'state', 'location', 'provider') then business_scope_mode
      else null
    end,
    doc_access_mode = case
      when nullif(doc_access_mode, '') in ('all_users', 'role_based') then doc_access_mode
      else 'all_users'
    end,
    updated_at = now()
where document_module is null
   or business_scope_mode is null
   or doc_access_mode is null
   or doc_access_mode not in ('all_users', 'role_based')
   or (code like 'FLEET_%' and document_module <> 'fleet')
   or (code like 'FLEET_%' and business_scope_mode is not null)
   or (code like 'BIZ_%' and document_module <> 'business')
   or business_scope_mode = 'custom';

alter table public.document_types
  add constraint document_types_document_module_check check (document_module in ('fleet', 'business')),
  add constraint document_types_business_scope_mode_check check (business_scope_mode is null or business_scope_mode in ('company', 'state', 'location', 'provider')),
  add constraint document_types_doc_access_mode_check check (doc_access_mode in ('all_users', 'role_based'));

create unique index if not exists document_types_company_code_idx
  on public.document_types (company_id, code);

create index if not exists document_types_company_active_idx
  on public.document_types (company_id, is_active, sort_order);

create table if not exists public.document_type_role_access (
  company_id uuid not null references public.companies(id) on delete cascade,
  document_type_id uuid not null references public.document_types(id) on delete cascade,
  role_id uuid not null references public.user_roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (company_id, document_type_id, role_id)
);

create index if not exists document_type_role_access_role_idx
  on public.document_type_role_access (company_id, role_id);

create table if not exists public.business_document_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  document_type_id uuid not null references public.document_types(id) on delete restrict,
  document_type_code text not null,
  scope_type text not null default 'company' check (scope_type in ('company', 'state', 'location', 'provider')),
  scope_id text,
  scope_label text not null default 'Company',
  reference_no text,
  issue_date text,
  expiry_date text,
  track_expiry boolean not null default true,
  additional_scope_ids text[] not null default '{}',
  file_name text,
  content_type text,
  file_size bigint,
  storage_bucket text not null default 'business-documents',
  storage_path text,
  status text not null default 'pending' check (status in ('pending', 'active', 'expired', 'replaced')),
  is_active boolean not null default true,
  uploaded_at timestamptz not null default now(),
  replaced_at timestamptz,
  delete_after timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.business_document_records
  add column if not exists track_expiry boolean not null default true,
  add column if not exists additional_scope_ids text[] not null default '{}';

create index if not exists business_document_records_additional_scope_ids_idx
  on public.business_document_records using gin (additional_scope_ids);

update public.business_document_records
set track_expiry = false,
    updated_at = now()
where expiry_date is null
  and track_expiry = true;

update public.business_document_records
set scope_type = 'company',
    scope_id = null,
    scope_label = 'Company',
    updated_at = now()
where scope_type not in ('company', 'state', 'location', 'provider');

alter table public.business_document_records
  drop constraint if exists business_document_records_scope_type_check;

alter table public.business_document_records
  add constraint business_document_records_scope_type_check check (scope_type in ('company', 'state', 'location', 'provider'));

create index if not exists business_document_records_company_active_idx
  on public.business_document_records (company_id, is_active, document_type_code);

create index if not exists business_document_records_scope_idx
  on public.business_document_records (company_id, scope_type, scope_id);

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

do $$
begin
  if to_regclass('public.fleet_vehicle_documents') is not null then
    alter table public.fleet_vehicle_documents
      drop constraint if exists fleet_vehicle_documents_document_type_check;
  end if;
end $$;

update public.document_types
set code = case code
    when 'registration' then 'FLEET_REGISTRATION'
    when 'insurance' then 'FLEET_INSURANCE'
    when 'puc' then 'FLEET_PUC'
    when 'fitness' then 'FLEET_FITNESS'
    when 'tax' then 'FLEET_TAX'
    when 'fleet_registration' then 'FLEET_REGISTRATION'
    when 'fleet_insurance' then 'FLEET_INSURANCE'
    when 'fleet_puc' then 'FLEET_PUC'
    when 'fleet_fitness' then 'FLEET_FITNESS'
    when 'fleet_tax' then 'FLEET_TAX'
    else code
  end,
  updated_at = now()
where code in ('registration', 'insurance', 'puc', 'fitness', 'tax', 'fleet_registration', 'fleet_insurance', 'fleet_puc', 'fleet_fitness', 'fleet_tax')
  and not exists (
    select 1
    from public.document_types existing
    where existing.company_id = public.document_types.company_id
      and existing.code = case public.document_types.code
        when 'registration' then 'FLEET_REGISTRATION'
        when 'insurance' then 'FLEET_INSURANCE'
        when 'puc' then 'FLEET_PUC'
        when 'fitness' then 'FLEET_FITNESS'
        when 'tax' then 'FLEET_TAX'
        when 'fleet_registration' then 'FLEET_REGISTRATION'
        when 'fleet_insurance' then 'FLEET_INSURANCE'
        when 'fleet_puc' then 'FLEET_PUC'
        when 'fleet_fitness' then 'FLEET_FITNESS'
        when 'fleet_tax' then 'FLEET_TAX'
      end
  );

delete from public.document_types old_rows
where old_rows.code in ('registration', 'insurance', 'puc', 'fitness', 'tax')
  and exists (
    select 1
    from public.document_types new_rows
    where new_rows.company_id = old_rows.company_id
      and new_rows.code = case old_rows.code
        when 'registration' then 'FLEET_REGISTRATION'
        when 'insurance' then 'FLEET_INSURANCE'
        when 'puc' then 'FLEET_PUC'
        when 'fitness' then 'FLEET_FITNESS'
        when 'tax' then 'FLEET_TAX'
      end
  );

delete from public.document_types old_rows
where old_rows.code in ('fleet_registration', 'fleet_insurance', 'fleet_puc', 'fleet_fitness', 'fleet_tax')
  and exists (
    select 1
    from public.document_types new_rows
    where new_rows.company_id = old_rows.company_id
      and new_rows.code = case old_rows.code
        when 'fleet_registration' then 'FLEET_REGISTRATION'
        when 'fleet_insurance' then 'FLEET_INSURANCE'
        when 'fleet_puc' then 'FLEET_PUC'
        when 'fleet_fitness' then 'FLEET_FITNESS'
        when 'fleet_tax' then 'FLEET_TAX'
      end
  );

do $$
begin
  if to_regclass('public.fleet_vehicle_documents') is not null then
    update public.fleet_vehicle_documents
    set document_type = case document_type
        when 'registration' then 'FLEET_REGISTRATION'
        when 'insurance' then 'FLEET_INSURANCE'
        when 'puc' then 'FLEET_PUC'
        when 'fitness' then 'FLEET_FITNESS'
        when 'tax' then 'FLEET_TAX'
        when 'fleet_registration' then 'FLEET_REGISTRATION'
        when 'fleet_insurance' then 'FLEET_INSURANCE'
        when 'fleet_puc' then 'FLEET_PUC'
        when 'fleet_fitness' then 'FLEET_FITNESS'
        when 'fleet_tax' then 'FLEET_TAX'
        else document_type
      end
    where document_type in ('registration', 'insurance', 'puc', 'fitness', 'tax', 'fleet_registration', 'fleet_insurance', 'fleet_puc', 'fleet_fitness', 'fleet_tax');
  end if;
end $$;

alter table public.document_types enable row level security;
alter table public.document_type_role_access enable row level security;
alter table public.business_document_records enable row level security;
alter table public.business_document_settings enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'document_types'
      and policyname = 'service_role_document_types_all'
  ) then
    create policy "service_role_document_types_all"
      on public.document_types
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

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
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'business_document_records'
      and policyname = 'service_role_business_document_records_all'
  ) then
    create policy "service_role_business_document_records_all"
      on public.business_document_records
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

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

insert into public.app_pages (company_id, code, name, sort_order, is_active, updated_at)
select companies.id, pages.code, pages.name, pages.sort_order, true, now()
from public.companies companies
cross join (
  values
    ('business_documents', 'Business Documents', 103),
    ('master_documents', 'Documents', 125)
) as pages(code, name, sort_order)
on conflict (company_id, code) do update
set name = excluded.name,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now();

insert into public.role_page_permissions (company_id, role_id, page_id, can_view, can_add, can_edit, updated_at)
select roles.company_id, roles.id, pages.id, true, true, true, now()
from public.user_roles roles
join public.app_pages pages
  on pages.company_id = roles.company_id
 and pages.code in ('business_documents', 'master_documents')
where roles.code = 'OWNER'
on conflict (company_id, role_id, page_id) do update
set can_view = true,
    can_add = true,
    can_edit = true,
    updated_at = now();

-- Do not seed document master rows into every company here.
-- Document types are tenant-specific and must be created from Master Data > Documents
-- for the company that owns them. Fleet APIs keep a runtime fallback for the five
-- standard fleet document labels when a company has no configured fleet templates.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-documents', 'business-documents', false, 20971520, null)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;
