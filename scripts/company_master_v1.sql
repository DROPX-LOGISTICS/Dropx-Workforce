create extension if not exists pgcrypto;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  admin_name text,
  admin_email text,
  admin_mobile text,
  is_master boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companies_code_key unique (code)
);

alter table public.companies
  add column if not exists admin_name text,
  add column if not exists admin_email text,
  add column if not exists admin_mobile text,
  add column if not exists webhook_key text,
  add column if not exists is_master boolean not null default false,
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

update public.companies
set webhook_key = lower(code) || '_' || encode(gen_random_bytes(8), 'hex')
where webhook_key is null;

create unique index if not exists companies_webhook_key_idx
  on public.companies (webhook_key)
  where webhook_key is not null;

create unique index if not exists companies_single_master_idx
  on public.companies ((is_master))
  where is_master = true;

alter table public.profiles
  add column if not exists company_id uuid references public.companies(id),
  add column if not exists is_master_owner boolean not null default false;

create table if not exists public.company_module_access (
  company_id uuid not null references public.companies(id) on delete cascade,
  module_code text not null,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, module_code)
);

insert into public.companies (code, name, admin_name, admin_email, admin_mobile, is_master, is_active)
values ('DROPX_LOGISTICS', 'DROPX LOGISTICS', 'NISAR AHAMMED', 'nisar@dropxlogistics.com', '8848389380', true, true)
on conflict (code) do update
set
  name = excluded.name,
  admin_name = excluded.admin_name,
  admin_email = excluded.admin_email,
  admin_mobile = excluded.admin_mobile,
  is_master = true,
  is_active = true,
  updated_at = now();

update public.companies
set webhook_key = lower(code) || '_' || encode(gen_random_bytes(8), 'hex')
where webhook_key is null;

update public.profiles
set company_id = (select id from public.companies where code = 'DROPX_LOGISTICS')
where company_id is null;

update public.profiles
set
  company_id = (select id from public.companies where code = 'DROPX_LOGISTICS'),
  is_master_owner = true
where lower(email) = 'nisar@dropxlogistics.com';

do $$
declare
  master_company_id uuid;
  table_name text;
begin
  select id into master_company_id
  from public.companies
  where code = 'DROPX_LOGISTICS';

  foreach table_name in array array[
    'providers',
    'station_models',
    'stations',
    'designations',
    'field_executives',
    'field_executive_provider_mappings',
    'payment_methods',
    'payment_method_components',
    'fleet_vehicles',
    'fleet_vehicle_documents',
    'fleet_fuel_transactions',
    'fleet_daily_km',
    'lead_job_roles',
    'lead_ads',
    'leads',
    'lead_status_history',
    'lead_sync_logs',
    'meta_leads_settings',
    'meta_messaging_settings',
    'meta_channel_profiles',
    'whatsapp_settings',
    'whatsapp_profiles',
    'whatsapp_template_cache',
    'whatsapp_notification_configs',
    'whatsapp_message_logs',
    'whatsapp_campaigns',
    'whatsapp_campaign_recipients',
    'inbox_conversations',
    'inbox_messages',
    'wheelseye_settings'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format(
        'alter table public.%I add column if not exists company_id uuid references public.companies(id)',
        table_name
      );
      execute format(
        'update public.%I set company_id = $1 where company_id is null',
        table_name
      ) using master_company_id;
      execute format(
        'create index if not exists %I on public.%I (company_id)',
        left(table_name || '_company_id_idx', 63),
        table_name
      );
    end if;
  end loop;
end $$;

update public.app_pages
set is_active = false, updated_at = now()
where code = 'company_master';

insert into public.company_module_access (company_id, module_code, is_enabled)
select company.id, module.module_code, true
from public.companies company
cross join (
  values
    ('command_center'),
    ('leads'),
    ('onboard'),
    ('field_executive'),
    ('fleet'),
    ('inbox'),
    ('notifications'),
    ('id_mapping'),
    ('mapping'),
    ('rate_cards'),
    ('report_imports'),
    ('earnings_review'),
    ('users_access'),
    ('master_data'),
    ('settings')
) as module(module_code)
where company.code = 'DROPX_LOGISTICS'
on conflict (company_id, module_code) do update
set is_enabled = true, updated_at = now();
