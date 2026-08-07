begin;

create extension if not exists pgcrypto;

alter table public.employees
  add column if not exists biometric_id text;

create index if not exists employees_company_biometric_id_idx
  on public.employees(company_id, biometric_id)
  where biometric_id is not null;

alter table public.field_executives
  add column if not exists biometric_id text;

create index if not exists field_executives_company_biometric_id_idx
  on public.field_executives(company_id, biometric_id)
  where biometric_id is not null;

create table if not exists public.biometric_devices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  device_serial text not null,
  created_at timestamptz not null default now()
);

alter table public.biometric_devices
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists device_serial text,
  add column if not exists terminal_id text,
  add column if not exists device_no text,
  add column if not exists location_id uuid references public.stations(id) on delete set null,
  add column if not exists device_name text,
  add column if not exists model text,
  add column if not exists local_ip_address text,
  add column if not exists local_port integer,
  add column if not exists p2p_type text,
  add column if not exists p2p_device_id text,
  add column if not exists connection_mode text not null default 'TCP_PUSH',
  add column if not exists middleware_host text not null default 'bio.dropxlogistics.com',
  add column if not exists middleware_port integer not null default 6010,
  add column if not exists communication_password_enabled boolean not null default false,
  add column if not exists network_password text,
  add column if not exists status text not null default 'Disconnected',
  add column if not exists last_seen_at timestamptz,
  add column if not exists last_source_ip text,
  add column if not exists is_active boolean not null default true,
  add column if not exists remarks text,
  add column if not exists created_by uuid,
  add column if not exists updated_at timestamptz not null default now();

update public.biometric_devices
set company_id = (select id from public.companies limit 1)
where company_id is null;

create unique index if not exists biometric_devices_company_serial_uidx
  on public.biometric_devices(company_id, device_serial);

create index if not exists biometric_devices_company_location_idx
  on public.biometric_devices(company_id, location_id);

create table if not exists public.biometric_middleware_settings (
  id boolean not null default true,
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (company_id, id)
);

alter table public.biometric_middleware_settings
  add column if not exists id boolean not null default true,
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists is_enabled boolean not null default true,
  add column if not exists host_pc_address text not null default 'bio.dropxlogistics.com',
  add column if not exists host_pc_port integer not null default 6010,
  add column if not exists enrolment_start_number integer not null default 1,
  add column if not exists event_transfer_mode text not null default 'TCP/IP',
  add column if not exists communication_password_enabled boolean not null default false,
  add column if not exists communication_password text,
  add column if not exists middleware_server_ip text,
  add column if not exists webhook_url text not null default 'https://dashboard.dropxlogistics.com/api/biometric/punch',
  add column if not exists notes text,
  add column if not exists updated_by uuid,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists biometric_middleware_settings_company_id_uidx
  on public.biometric_middleware_settings(company_id, id);

insert into public.biometric_middleware_settings (
  id,
  company_id,
  host_pc_address,
  host_pc_port,
  enrolment_start_number,
  event_transfer_mode,
  communication_password_enabled,
  webhook_url,
  is_enabled,
  updated_at
)
select
  true,
  companies.id,
  'bio.dropxlogistics.com',
  6010,
  1,
  'TCP/IP',
  false,
  'https://dashboard.dropxlogistics.com/api/biometric/punch',
  true,
  now()
from public.companies
on conflict (company_id, id) do nothing;

create table if not exists public.biometric_enrolments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  enrolment_id text not null,
  worker_type text not null,
  status text not null default 'Active',
  effective_from date not null default current_date,
  created_at timestamptz not null default now()
);

alter table public.biometric_enrolments
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists enrolment_id text,
  add column if not exists worker_type text,
  add column if not exists status text not null default 'Active',
  add column if not exists effective_from date not null default current_date,
  add column if not exists employee_id uuid references public.employees(id) on delete set null,
  add column if not exists field_executive_id uuid references public.field_executives(id) on delete set null,
  add column if not exists location_id uuid references public.stations(id) on delete set null,
  add column if not exists effective_to date,
  add column if not exists notes text,
  add column if not exists created_by uuid,
  add column if not exists updated_at timestamptz not null default now();

update public.biometric_enrolments
set company_id = (select id from public.companies limit 1)
where company_id is null;

create unique index if not exists biometric_enrolments_company_enrolment_active_uidx
  on public.biometric_enrolments(company_id, enrolment_id)
  where effective_to is null and status = 'Active';

create index if not exists biometric_enrolments_employee_idx
  on public.biometric_enrolments(company_id, employee_id);

create index if not exists biometric_enrolments_field_executive_idx
  on public.biometric_enrolments(company_id, field_executive_id);

insert into public.biometric_enrolments (
  company_id,
  enrolment_id,
  worker_type,
  employee_id,
  location_id,
  status,
  effective_from,
  created_at,
  updated_at
)
select
  employees.company_id,
  btrim(employees.biometric_id),
  'employee',
  employees.id,
  employees.location_id,
  case when coalesce(employees.is_active, true) then 'Active' else 'Inactive' end,
  coalesce(employees.date_of_join, current_date),
  now(),
  now()
from public.employees
where employees.biometric_id is not null
  and btrim(employees.biometric_id) <> ''
on conflict do nothing;

insert into public.biometric_enrolments (
  company_id,
  enrolment_id,
  worker_type,
  field_executive_id,
  location_id,
  status,
  effective_from,
  created_at,
  updated_at
)
select
  field_executives.company_id,
  btrim(field_executives.biometric_id),
  'individual_contract',
  field_executives.id,
  field_executives.location_id,
  case when coalesce(field_executives.is_active, true) then 'Active' else 'Inactive' end,
  coalesce(field_executives.date_of_join, current_date),
  now(),
  now()
from public.field_executives
where field_executives.biometric_id is not null
  and btrim(field_executives.biometric_id) <> ''
on conflict do nothing;

create table if not exists public.biometric_raw_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  device_serial text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.biometric_raw_events
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists device_serial text,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists device_id uuid references public.biometric_devices(id) on delete set null,
  add column if not exists middleware_raw_event_id bigint,
  add column if not exists received_at timestamptz,
  add column if not exists event_type text,
  add column if not exists terminal_id text,
  add column if not exists trans_id text,
  add column if not exists enrolment_id text,
  add column if not exists punch_time timestamptz,
  add column if not exists source_ip text;

update public.biometric_raw_events
set company_id = (select id from public.companies limit 1)
where company_id is null;

create unique index if not exists biometric_raw_events_company_device_trans_uidx
  on public.biometric_raw_events(company_id, device_serial, trans_id);

create index if not exists biometric_raw_events_company_punch_time_idx
  on public.biometric_raw_events(company_id, punch_time desc);

create index if not exists biometric_raw_events_company_enrolment_idx
  on public.biometric_raw_events(company_id, enrolment_id, punch_time desc);

create table if not exists public.attendance_punches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  enrolment_id text not null,
  punch_time timestamptz not null,
  punch_date date not null,
  punch_order integer not null default 1,
  punch_label text not null default 'In1',
  worker_status text not null default 'Unknown',
  calculated boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.attendance_punches
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists enrolment_id text,
  add column if not exists punch_time timestamptz,
  add column if not exists punch_date date,
  add column if not exists punch_order integer not null default 1,
  add column if not exists punch_label text not null default 'In1',
  add column if not exists worker_status text not null default 'Unknown',
  add column if not exists calculated boolean not null default true,
  add column if not exists raw_event_id uuid references public.biometric_raw_events(id) on delete set null,
  add column if not exists device_id uuid references public.biometric_devices(id) on delete set null,
  add column if not exists worker_type text,
  add column if not exists employee_id uuid references public.employees(id) on delete set null,
  add column if not exists field_executive_id uuid references public.field_executives(id) on delete set null,
  add column if not exists location_id uuid references public.stations(id) on delete set null,
  add column if not exists device_serial text;

update public.attendance_punches
set company_id = (select id from public.companies limit 1)
where company_id is null;

create unique index if not exists attendance_punches_company_device_enrol_time_uidx
  on public.attendance_punches(company_id, device_serial, enrolment_id, punch_time);

create index if not exists attendance_punches_company_date_idx
  on public.attendance_punches(company_id, punch_date desc, location_id, enrolment_id);

create table if not exists public.attendance_daily (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  enrolment_id text not null,
  punch_date date not null,
  punch_count integer not null default 0,
  work_minutes integer not null default 0,
  status text not null default 'P',
  updated_at timestamptz not null default now()
);

alter table public.attendance_daily
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists enrolment_id text,
  add column if not exists punch_date date,
  add column if not exists punch_count integer not null default 0,
  add column if not exists work_minutes integer not null default 0,
  add column if not exists status text not null default 'P',
  add column if not exists worker_type text,
  add column if not exists employee_id uuid references public.employees(id) on delete set null,
  add column if not exists field_executive_id uuid references public.field_executives(id) on delete set null,
  add column if not exists location_id uuid references public.stations(id) on delete set null,
  add column if not exists in_time timestamptz,
  add column if not exists out_time timestamptz,
  add column if not exists employee_code text,
  add column if not exists station_code text,
  add column if not exists worker_name text,
  add column if not exists remark text;

update public.attendance_daily
set company_id = (select id from public.companies limit 1)
where company_id is null;

create unique index if not exists attendance_daily_company_enrolment_date_uidx
  on public.attendance_daily(company_id, enrolment_id, punch_date);

create index if not exists attendance_daily_company_date_idx
  on public.attendance_daily(company_id, punch_date desc, location_id);

create table if not exists public.biometric_alerts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  alert_type text not null,
  severity text not null default 'medium',
  message text not null
);

alter table public.biometric_alerts
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists alert_type text,
  add column if not exists severity text not null default 'medium',
  add column if not exists message text,
  add column if not exists enrolment_id text,
  add column if not exists employee_id uuid references public.employees(id) on delete set null,
  add column if not exists field_executive_id uuid references public.field_executives(id) on delete set null,
  add column if not exists device_id uuid references public.biometric_devices(id) on delete set null,
  add column if not exists device_serial text,
  add column if not exists punch_time timestamptz,
  add column if not exists raw_event_id uuid references public.biometric_raw_events(id) on delete set null,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid;

update public.biometric_alerts
set company_id = (select id from public.companies limit 1)
where company_id is null;

create index if not exists biometric_alerts_company_open_idx
  on public.biometric_alerts(company_id, created_at desc)
  where resolved_at is null;

update public.app_pages
set name = 'Device Master'
where code = 'biometric_devices'
  and name <> 'Device Master';

insert into public.app_pages (company_id, code, name, sort_order, is_active, created_at)
select companies.id, 'biometric_devices', 'Device Master', 126, true, now()
from public.companies
where not exists (
  select 1 from public.app_pages pages
  where pages.company_id = companies.id and pages.code = 'biometric_devices'
);

insert into public.app_pages (company_id, code, name, sort_order, is_active, created_at)
select companies.id, 'attendance_reports', 'Attendance Reports', 129, true, now()
from public.companies
where not exists (
  select 1 from public.app_pages pages
  where pages.company_id = companies.id and pages.code = 'attendance_reports'
);

alter table public.biometric_devices enable row level security;
alter table public.biometric_middleware_settings enable row level security;
alter table public.biometric_enrolments enable row level security;
alter table public.biometric_raw_events enable row level security;
alter table public.attendance_punches enable row level security;
alter table public.attendance_daily enable row level security;
alter table public.biometric_alerts enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'biometric_devices' and policyname = 'service_role_biometric_devices_all') then
    create policy "service_role_biometric_devices_all" on public.biometric_devices for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'biometric_middleware_settings' and policyname = 'service_role_biometric_middleware_settings_all') then
    create policy "service_role_biometric_middleware_settings_all" on public.biometric_middleware_settings for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'biometric_enrolments' and policyname = 'service_role_biometric_enrolments_all') then
    create policy "service_role_biometric_enrolments_all" on public.biometric_enrolments for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'biometric_raw_events' and policyname = 'service_role_biometric_raw_events_all') then
    create policy "service_role_biometric_raw_events_all" on public.biometric_raw_events for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'attendance_punches' and policyname = 'service_role_attendance_punches_all') then
    create policy "service_role_attendance_punches_all" on public.attendance_punches for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'attendance_daily' and policyname = 'service_role_attendance_daily_all') then
    create policy "service_role_attendance_daily_all" on public.attendance_daily for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'biometric_alerts' and policyname = 'service_role_biometric_alerts_all') then
    create policy "service_role_biometric_alerts_all" on public.biometric_alerts for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
end $$;

commit;
