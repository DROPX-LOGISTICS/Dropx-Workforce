begin;

create table if not exists public.cod_station_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  location_id uuid not null references public.stations(id) on delete cascade,
  station_code text,
  state text,
  cms_agency text not null,
  agent_name text not null,
  agent_mobile text not null,
  cod_deposit_day text not null default 'Same Day'
    check (cod_deposit_day in ('Same Day', 'Next Day')),
  pickup_time text,
  pickup_window_start time,
  pickup_window_end time,
  cod_submission_due_time time,
  eod_submission_due_time time,
  escalation_contact text,
  escalation_email text,
  cod_sheet_link text,
  portal_station_code text,
  portal_login_url text,
  portal_username text,
  portal_secret_name text,
  amazon_driver_recon_url text,
  amazon_bank_deposit_url text,
  driver_recon_due_time time,
  prepared_deposit_due_time time,
  portal_check_interval_minutes integer not null default 30,
  portal_checks_enabled boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cod_station_settings_location_unique unique (company_id, location_id)
);

alter table public.cod_station_settings
  add column if not exists portal_station_code text,
  add column if not exists portal_login_url text,
  add column if not exists portal_username text,
  add column if not exists portal_secret_name text,
  add column if not exists amazon_driver_recon_url text,
  add column if not exists amazon_bank_deposit_url text,
  add column if not exists driver_recon_due_time time,
  add column if not exists prepared_deposit_due_time time,
  add column if not exists portal_check_interval_minutes integer not null default 30,
  add column if not exists portal_checks_enabled boolean not null default false;

create index if not exists cod_station_settings_company_station_idx
  on public.cod_station_settings(company_id, station_code);

create table if not exists public.cod_submissions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  submission_no text not null,
  form_type text check (form_type in ('amazon', 'flipkart')),
  client text check (client in ('Amazon', 'Flipkart')),
  channel text,
  location_id uuid references public.stations(id) on delete set null,
  station_code text,
  cod_period_from date,
  cod_period_to date,
  cod_date date,
  deposit_date date,
  remittance_creation_date date,
  remittance_creation_time time,
  remittance_submission_date date,
  remittance_amount numeric(14,2),
  cod_as_per_erp numeric(14,2),
  cod_amount numeric(14,2),
  deposited_amount numeric(14,2),
  remittance_code text,
  deposit_window text,
  cod_master_id uuid references public.cod_station_settings(id) on delete set null,
  payment_mode text,
  reference_no text,
  proof_url text,
  submitter_name text,
  remarks text,
  status text not null default 'Submitted',
  validation_status text not null default 'Pending'
    check (validation_status in ('Pending', 'Matched', 'Short', 'Excess', 'Rejected')),
  validated_amount numeric(14,2),
  validated_at timestamptz,
  validated_by uuid references auth.users(id) on delete set null,
  validation_remarks text,
  validation_payload jsonb not null default '{}'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  deposit_slip_attachments jsonb not null default '[]'::jsonb,
  ai_status text,
  ai_confidence numeric(5,2),
  ai_summary text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cod_submissions_company_no_unique unique (company_id, submission_no)
);

create index if not exists cod_submissions_company_period_idx
  on public.cod_submissions(company_id, cod_period_from desc, cod_period_to desc);

create index if not exists cod_submissions_company_location_idx
  on public.cod_submissions(company_id, location_id, validation_status);

create table if not exists public.ops_daily_submissions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  submission_no text not null,
  location_id uuid references public.stations(id) on delete set null,
  station_code text,
  business_date date not null,
  submitter_name text,
  remittance_codes text[] not null default '{}'::text[],
  attachments jsonb not null default '[]'::jsonb,
  checklist_payload jsonb not null default '{}'::jsonb,
  status text not null default 'Submitted',
  manager_status text not null default 'Pending',
  manager_remarks text,
  manager_reviewed_by uuid references auth.users(id) on delete set null,
  manager_reviewed_at timestamptz,
  ai_status text,
  ai_confidence numeric(5,2),
  ai_summary text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_daily_submissions_company_no_unique unique (company_id, submission_no)
);

create index if not exists ops_daily_submissions_company_date_idx
  on public.ops_daily_submissions(company_id, business_date desc);

create index if not exists ops_daily_submissions_company_location_idx
  on public.ops_daily_submissions(company_id, location_id, manager_status);

insert into public.app_pages (company_id, code, name, sort_order, is_active)
select companies.id, page.code, page.name, page.sort_order, true
from public.companies companies
cross join (
  values
    ('ops_pulse', 'Ops Pulse', 84),
    ('daily_submission', 'Daily Submission', 85),
    ('cod_submission', 'COD Submission', 86),
    ('cod_validation', 'COD Validation', 87),
    ('cod_reports', 'COD Reports', 88),
    ('cod_master', 'COD Master', 124),
    ('ai_connector', 'AI Connector', 133)
) as page(code, name, sort_order)
where companies.is_active = true
  and not exists (
    select 1
    from public.app_pages existing
    where existing.company_id = companies.id
      and existing.code = page.code
  );

update public.app_pages
set is_active = true,
    updated_at = now()
where code in ('ops_pulse', 'daily_submission', 'cod_submission', 'cod_validation', 'cod_reports', 'cod_master', 'ai_connector');

insert into public.role_page_permissions (
  company_id,
  role_id,
  page_id,
  can_view,
  can_add,
  can_edit
)
select roles.company_id, roles.id, pages.id, true, true, true
from public.user_roles roles
join public.app_pages pages on pages.company_id = roles.company_id
where lower(roles.code) in ('owner', 'admin')
  and pages.code in ('ops_pulse', 'daily_submission', 'cod_submission', 'cod_validation', 'cod_reports', 'cod_master', 'ai_connector')
  and not exists (
    select 1
    from public.role_page_permissions existing
    where existing.company_id = roles.company_id
      and existing.role_id = roles.id
      and existing.page_id = pages.id
  );

update public.role_page_permissions permissions
set can_view = true,
    can_add = true,
    can_edit = true
from public.user_roles roles
join public.app_pages pages on pages.company_id = roles.company_id
where permissions.company_id = roles.company_id
  and permissions.role_id = roles.id
  and permissions.page_id = pages.id
  and lower(roles.code) in ('owner', 'admin')
  and pages.code in ('ops_pulse', 'daily_submission', 'cod_submission', 'cod_validation', 'cod_reports', 'cod_master', 'ai_connector');

commit;
