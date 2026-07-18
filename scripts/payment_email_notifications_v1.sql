create table if not exists public.payment_notification_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  event_type text not null check (event_type in ('payment_request', 'payment_approve', 'payment_return', 'payment_reject')),
  is_enabled boolean not null default false,
  to_recipients text[] not null default '{}',
  cc_recipients text[] not null default '{}',
  custom_to_emails text[] not null default '{}',
  custom_cc_emails text[] not null default '{}',
  subject_template text not null,
  body_template text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, event_type)
);

alter table public.payment_notification_templates
  add column if not exists is_enabled boolean not null default false;

alter table public.payment_notification_templates
  add column if not exists to_recipients text[] not null default '{}';

alter table public.payment_notification_templates
  add column if not exists cc_recipients text[] not null default '{}';

alter table public.payment_notification_templates
  add column if not exists custom_to_emails text[] not null default '{}';

alter table public.payment_notification_templates
  add column if not exists custom_cc_emails text[] not null default '{}';

alter table public.payment_notification_templates
  add column if not exists subject_template text;

alter table public.payment_notification_templates
  add column if not exists body_template text;

alter table public.payment_notification_templates
  add column if not exists initial_is_enabled boolean not null default false;

alter table public.payment_notification_templates
  add column if not exists initial_subject_template text;

alter table public.payment_notification_templates
  add column if not exists initial_body_template text;

alter table public.payment_notification_templates
  add column if not exists final_is_enabled boolean not null default false;

alter table public.payment_notification_templates
  add column if not exists final_subject_template text;

alter table public.payment_notification_templates
  add column if not exists final_body_template text;

create unique index if not exists payment_notification_templates_company_event_key
  on public.payment_notification_templates (company_id, event_type);

alter table public.payment_notification_templates enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'payment_notification_templates'
      and policyname = 'service_role_payment_notification_templates_all'
  ) then
    create policy "service_role_payment_notification_templates_all"
      on public.payment_notification_templates
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;
