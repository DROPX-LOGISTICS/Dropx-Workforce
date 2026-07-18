create table if not exists public.business_document_notification_templates (
  id boolean not null default true,
  company_id uuid not null references public.companies(id) on delete cascade,
  is_enabled boolean not null default false,
  to_recipients text[] not null default array['compliance_manager', 'location_email', 'location_manager']::text[],
  cc_recipients text[] not null default '{}'::text[],
  custom_to_emails text[] not null default '{}'::text[],
  custom_cc_emails text[] not null default '{}'::text[],
  subject_template text not null default '{{reminder_stage}}: {{document_name}} for {{scope_code}}',
  body_template text not null default 'Dear Team,

The following business document requires attention.

Document: {{document_name}}
Scope: {{scope_code}}
Reference No: {{reference_no}}
Expiry Date: {{expiry_date}}
{{reminder_line}}

Regards,
DropX Compliance System',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, id),
  constraint business_document_notification_templates_singleton check (id = true)
);

alter table public.business_document_notification_templates
  add column if not exists to_recipients text[] not null default array['compliance_manager', 'location_email', 'location_manager']::text[];

alter table public.business_document_notification_templates
  add column if not exists cc_recipients text[] not null default '{}'::text[];

alter table public.business_document_notification_templates
  add column if not exists custom_to_emails text[] not null default '{}'::text[];

alter table public.business_document_notification_templates
  add column if not exists custom_cc_emails text[] not null default '{}'::text[];

create table if not exists public.business_document_notification_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  business_document_record_id uuid not null references public.business_document_records(id) on delete cascade,
  reminder_key text not null,
  sent_on date not null,
  recipients text[] not null default '{}',
  cc_recipients text[] not null default '{}',
  subject text,
  status text not null default 'pending' check (status in ('sent', 'failed', 'skipped')),
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.business_document_notification_logs
  add column if not exists cc_recipients text[] not null default '{}';

create unique index if not exists business_document_notification_logs_unique
  on public.business_document_notification_logs (company_id, business_document_record_id, reminder_key, sent_on);

create index if not exists business_document_notification_logs_company_idx
  on public.business_document_notification_logs (company_id, sent_on desc);

alter table public.business_document_notification_templates enable row level security;
alter table public.business_document_notification_logs enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'business_document_notification_templates'
      and policyname = 'service_role_business_document_notification_templates_all'
  ) then
    create policy "service_role_business_document_notification_templates_all"
      on public.business_document_notification_templates
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
      and tablename = 'business_document_notification_logs'
      and policyname = 'service_role_business_document_notification_logs_all'
  ) then
    create policy "service_role_business_document_notification_logs_all"
      on public.business_document_notification_logs
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;
