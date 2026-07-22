create extension if not exists pgcrypto;

create table if not exists public.app_pages (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.role_page_permissions (
  role_id uuid not null references public.user_roles(id) on delete cascade,
  page_id uuid not null references public.app_pages(id) on delete cascade,
  can_view boolean not null default false,
  can_add boolean not null default false,
  can_edit boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (role_id, page_id)
);

insert into public.app_pages (code, name, sort_order)
values
  ('dashboard', 'Command Center', 10),
  ('delivery_associates', 'Field Executive', 20),
  ('employees', 'Employees', 21),
  ('contractors', 'Independent Contractor', 22),
  ('vendors', 'Vendors', 23),
  ('workers', 'Workers', 24),
  ('provider_mapping', 'ID Mapping', 40),
  ('mapping', 'Mapping', 50),
  ('rate_cards', 'Rate Cards', 60),
  ('imports', 'Report Imports', 70),
  ('report_upload', 'Report Upload', 80),
  ('earnings', 'Earnings Review', 90),
  ('exceptions', 'Exceptions', 100),
  ('inbox', 'Inbox', 102),
  ('business_documents', 'Business Documents', 103),
  ('notifications_whatsapp', 'WhatsApp Notifications', 105),
  ('notifications_email', 'Email Notifications', 106),
  ('notifications_app', 'App Notifications', 107),
  ('users', 'Users & Access', 110),
  ('master_locations', 'Locations', 120),
  ('master_providers', 'Providers', 121),
  ('master_models', 'Models', 122),
  ('payment_methods', 'Payment Methods', 123),
  ('designations', 'Designations', 124),
  ('master_documents', 'Documents', 125),
  ('app_settings', 'Settings', 130)
on conflict (code) do update set
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();

update public.app_pages
set is_active = false, updated_at = now()
where code = 'onboarding';

update public.app_pages
set is_active = false, updated_at = now()
where code = 'settings';

update public.app_pages
set is_active = false, updated_at = now()
where code = 'company_master';
