create table if not exists public.cod_day_closures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  business_date date not null,
  location_id uuid not null references public.stations(id) on delete restrict,
  station_code text not null,
  collected_cod numeric(14,2) not null default 0,
  amazon_open_remittance_expected numeric(14,2) not null default 0,
  amazon_open_remittance_count integer not null default 0,
  difference_amount numeric(14,2) not null default 0,
  driver_reconciliation_pending numeric(14,2) not null default 0,
  no_deposit_liability boolean not null default false,
  validation_status text not null default 'Pending'
    check (validation_status in ('Pending', 'Matched', 'Mismatch', 'Validation required', 'Validation failed')),
  submission_status text not null default 'Submitted'
    check (submission_status in ('Draft', 'Submitted', 'Manager approval required', 'Approved', 'Rejected', 'Reopened')),
  override_reason text,
  validation_snapshot jsonb not null default '{}'::jsonb,
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz not null default now(),
  manager_status text not null default 'Not required'
    check (manager_status in ('Not required', 'Pending', 'Approved', 'Rejected')),
  manager_reviewed_by uuid references auth.users(id) on delete set null,
  manager_reviewed_at timestamptz,
  manager_remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, business_date, location_id)
);

create index if not exists cod_day_closures_company_date_idx
  on public.cod_day_closures(company_id, business_date desc, station_code);

create table if not exists public.cod_manager_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  closure_id uuid not null references public.cod_day_closures(id) on delete cascade,
  location_id uuid references public.stations(id) on delete set null,
  recipient_user_id uuid references auth.users(id) on delete set null,
  recipient_email text,
  notification_type text not null default 'COD mismatch',
  title text not null,
  message text not null,
  status text not null default 'Unread' check (status in ('Unread', 'Read', 'Resolved')),
  email_status text not null default 'Pending' check (email_status in ('Pending', 'Sent', 'Failed', 'Skipped')),
  email_error text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  resolved_at timestamptz
);

create index if not exists cod_manager_notifications_company_status_idx
  on public.cod_manager_notifications(company_id, status, created_at desc);

alter table public.cod_day_closures enable row level security;
alter table public.cod_manager_notifications enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'cod_day_closures' and policyname = 'cod_day_closures_service_role_all'
  ) then
    create policy cod_day_closures_service_role_all on public.cod_day_closures
      for all to service_role using (true) with check (true);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'cod_manager_notifications' and policyname = 'cod_manager_notifications_service_role_all'
  ) then
    create policy cod_manager_notifications_service_role_all on public.cod_manager_notifications
      for all to service_role using (true) with check (true);
  end if;
end $$;
