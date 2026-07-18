create extension if not exists pgcrypto;

create table if not exists public.whatsapp_campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_code text not null unique default (
    'WA-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
  ),
  source_mode text not null default 'database',
  template_id text references public.whatsapp_template_cache(template_id),
  template_name text not null,
  template_language text not null,
  variable_mappings jsonb not null default '{}'::jsonb,
  total_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  pending_count integer not null default 0,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.whatsapp_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.whatsapp_campaigns(id) on delete cascade,
  row_no integer not null,
  recipient_name text,
  recipient_mobile text not null,
  country_code text,
  source text,
  source_id text,
  recipient_payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'delivered', 'read', 'failed', 'skipped')),
  provider_message_id text,
  error_message text,
  request_payload jsonb,
  response_payload jsonb,
  webhook_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  sent_at timestamptz,
  unique (campaign_id, row_no)
);

create index if not exists whatsapp_campaigns_created_at_idx on public.whatsapp_campaigns (created_at desc);
create index if not exists whatsapp_campaigns_status_idx on public.whatsapp_campaigns (status);
create index if not exists whatsapp_campaign_recipients_campaign_idx on public.whatsapp_campaign_recipients (campaign_id, row_no);
create index if not exists whatsapp_campaign_recipients_status_idx on public.whatsapp_campaign_recipients (status);
create index if not exists whatsapp_campaign_recipients_provider_message_idx on public.whatsapp_campaign_recipients (provider_message_id);

alter table public.whatsapp_campaigns enable row level security;
alter table public.whatsapp_campaign_recipients enable row level security;
