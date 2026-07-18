create table if not exists public.fleet_document_notification_templates (
  id boolean not null default true,
  company_id uuid not null references public.companies(id) on delete cascade,
  is_enabled boolean not null default false,
  to_recipients text[] not null default array['fleet_manager', 'location_email', 'location_manager']::text[],
  cc_recipients text[] not null default '{}'::text[],
  custom_to_emails text[] not null default '{}'::text[],
  custom_cc_emails text[] not null default '{}'::text[],
  subject_template text not null default 'Action needed: {{document_name}} for {{vehicle_no}} - {{reminder_stage}}',
  body_template text not null default 'Dear Team,

The following fleet document requires attention.

Vehicle: {{vehicle_no}}
Location: {{location_code}}
Document: {{document_name}}
Expiry Date: {{expiry_date}}
Current Status: {{reminder_stage}}

Regards,
DropX Fleet System',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, id),
  constraint fleet_document_notification_templates_singleton check (id = true)
);

alter table public.fleet_document_notification_templates
  add column if not exists custom_to_emails text[] not null default '{}'::text[];

alter table public.fleet_document_notification_templates
  add column if not exists custom_cc_emails text[] not null default '{}'::text[];

create table if not exists public.fleet_document_notification_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  fleet_vehicle_document_id uuid not null references public.fleet_vehicle_documents(id) on delete cascade,
  reminder_key text not null,
  sent_on date not null,
  recipients text[] not null default '{}',
  cc_recipients text[] not null default '{}',
  subject text,
  status text not null default 'pending' check (status in ('sent', 'failed', 'skipped')),
  error_message text,
  created_at timestamptz not null default now()
);

create unique index if not exists fleet_document_notification_logs_unique
  on public.fleet_document_notification_logs (company_id, fleet_vehicle_document_id, reminder_key, sent_on);

create index if not exists fleet_document_notification_logs_company_idx
  on public.fleet_document_notification_logs (company_id, sent_on desc);

alter table public.fleet_document_notification_templates enable row level security;
alter table public.fleet_document_notification_logs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'fleet_document_notification_templates'
      and policyname = 'service_role_fleet_document_notification_templates_all'
  ) then
    create policy "service_role_fleet_document_notification_templates_all"
      on public.fleet_document_notification_templates
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'fleet_document_notification_logs'
      and policyname = 'service_role_fleet_document_notification_logs_all'
  ) then
    create policy "service_role_fleet_document_notification_logs_all"
      on public.fleet_document_notification_logs
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;
