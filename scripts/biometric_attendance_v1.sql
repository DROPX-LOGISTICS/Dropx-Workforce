begin;

create extension if not exists pgcrypto;

insert into public.app_pages (company_id, code, name, sort_order, is_active, created_at)
select companies.id, 'biometric_devices', 'Device Master', 126, true, now()
from public.companies
where not exists (
  select 1
  from public.app_pages pages
  where pages.company_id = companies.id
    and pages.code = 'biometric_devices'
);

insert into public.app_pages (company_id, code, name, sort_order, is_active, created_at)
select companies.id, 'reports', 'Reports', 128, true, now()
from public.companies
where not exists (
  select 1
  from public.app_pages pages
  where pages.company_id = companies.id
    and pages.code = 'reports'
);

insert into public.app_pages (company_id, code, name, sort_order, is_active, created_at)
select companies.id, 'attendance_reports', 'Attendance Reports', 129, true, now()
from public.companies
where not exists (
  select 1
  from public.app_pages pages
  where pages.company_id = companies.id
    and pages.code = 'attendance_reports'
);

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
  terminal_id text,
  device_no text,
  location_id uuid references public.stations(id) on delete set null,
  device_name text,
  model text,
  local_ip_address text,
  local_port integer,
  p2p_type text,
  p2p_device_id text,
  connection_mode text not null default 'TCP_PUSH',
  middleware_host text not null default 'bio.dropxlogistics.com',
  middleware_port integer not null default 6010,
  communication_password_enabled boolean not null default false,
  network_password text,
  status text not null default 'Disconnected',
  last_seen_at timestamptz,
  last_source_ip text,
  is_active boolean not null default true,
  remarks text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint biometric_devices_status_check check (status in ('Connected', 'Disconnected', 'Unknown'))
);

create unique index if not exists biometric_devices_company_serial_uidx
  on public.biometric_devices(company_id, device_serial);

create index if not exists biometric_devices_company_location_idx
  on public.biometric_devices(company_id, location_id);

create table if not exists public.biometric_enrolments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  enrolment_id text not null,
  worker_type text not null,
  employee_id uuid references public.employees(id) on delete set null,
  field_executive_id uuid references public.field_executives(id) on delete set null,
  location_id uuid references public.stations(id) on delete set null,
  status text not null default 'Active',
  effective_from date not null default current_date,
  effective_to date,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint biometric_enrolments_worker_type_check check (worker_type in ('employee', 'individual_contract')),
  constraint biometric_enrolments_status_check check (status in ('Active', 'Inactive', 'Resigned', 'Blocked')),
  constraint biometric_enrolments_one_person_check check (
    (worker_type = 'employee' and employee_id is not null and field_executive_id is null)
    or
    (worker_type = 'individual_contract' and field_executive_id is not null and employee_id is null)
  )
);

create unique index if not exists biometric_enrolments_company_enrolment_active_uidx
  on public.biometric_enrolments(company_id, enrolment_id)
  where effective_to is null and status = 'Active';

create index if not exists biometric_enrolments_employee_idx
  on public.biometric_enrolments(company_id, employee_id);

create index if not exists biometric_enrolments_field_executive_idx
  on public.biometric_enrolments(company_id, field_executive_id);

create table if not exists public.biometric_raw_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  device_id uuid references public.biometric_devices(id) on delete set null,
  middleware_raw_event_id bigint,
  received_at timestamptz,
  event_type text,
  device_serial text not null,
  terminal_id text,
  trans_id text,
  enrolment_id text,
  punch_time timestamptz,
  source_ip text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists biometric_raw_events_company_device_trans_uidx
  on public.biometric_raw_events(company_id, device_serial, trans_id);

create index if not exists biometric_raw_events_company_punch_time_idx
  on public.biometric_raw_events(company_id, punch_time desc);

create index if not exists biometric_raw_events_company_enrolment_idx
  on public.biometric_raw_events(company_id, enrolment_id, punch_time desc);

create table if not exists public.attendance_punches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  raw_event_id uuid references public.biometric_raw_events(id) on delete set null,
  device_id uuid references public.biometric_devices(id) on delete set null,
  enrolment_id text not null,
  worker_type text,
  employee_id uuid references public.employees(id) on delete set null,
  field_executive_id uuid references public.field_executives(id) on delete set null,
  location_id uuid references public.stations(id) on delete set null,
  device_serial text,
  punch_time timestamptz not null,
  punch_date date not null,
  punch_order integer not null,
  punch_label text not null,
  worker_status text not null,
  calculated boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists attendance_punches_company_device_enrol_time_uidx
  on public.attendance_punches(company_id, device_serial, enrolment_id, punch_time);

create index if not exists attendance_punches_company_date_idx
  on public.attendance_punches(company_id, punch_date desc, location_id, enrolment_id);

create table if not exists public.attendance_daily (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  enrolment_id text not null,
  worker_type text,
  employee_id uuid references public.employees(id) on delete set null,
  field_executive_id uuid references public.field_executives(id) on delete set null,
  location_id uuid references public.stations(id) on delete set null,
  punch_date date not null,
  in_time timestamptz,
  out_time timestamptz,
  punch_count integer not null default 0,
  work_minutes integer not null default 0,
  status text not null default 'P',
  remark text,
  updated_at timestamptz not null default now()
);

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
  enrolment_id text,
  employee_id uuid references public.employees(id) on delete set null,
  field_executive_id uuid references public.field_executives(id) on delete set null,
  device_id uuid references public.biometric_devices(id) on delete set null,
  device_serial text,
  punch_time timestamptz,
  message text not null,
  raw_event_id uuid references public.biometric_raw_events(id) on delete set null,
  resolved_at timestamptz,
  resolved_by uuid
);

create index if not exists biometric_alerts_company_open_idx
  on public.biometric_alerts(company_id, created_at desc)
  where resolved_at is null;

insert into public.biometric_enrolments (
  company_id,
  enrolment_id,
  worker_type,
  employee_id,
  location_id,
  status,
  effective_from
)
select
  company_id,
  biometric_id,
  'employee',
  id,
  location_id,
  case when is_active then 'Active' else 'Inactive' end,
  coalesce(date_of_join, current_date)
from public.employees
where biometric_id is not null
  and btrim(biometric_id) <> ''
on conflict do nothing;

insert into public.biometric_enrolments (
  company_id,
  enrolment_id,
  worker_type,
  field_executive_id,
  location_id,
  status,
  effective_from
)
select
  company_id,
  biometric_id,
  'individual_contract',
  id,
  location_id,
  case when is_active then 'Active' else 'Inactive' end,
  coalesce(date_of_join, current_date)
from public.field_executives
where biometric_id is not null
  and btrim(biometric_id) <> ''
on conflict do nothing;

alter table public.biometric_devices enable row level security;
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
