alter table public.whatsapp_settings
  add column if not exists webhook_verify_token text;

alter table public.whatsapp_campaign_recipients
  add column if not exists submitted_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists read_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists webhook_payload jsonb;

alter table public.whatsapp_campaign_recipients
  drop constraint if exists whatsapp_campaign_recipients_status_check;

alter table public.whatsapp_campaign_recipients
  add constraint whatsapp_campaign_recipients_status_check
  check (status in ('pending', 'processing', 'sent', 'delivered', 'read', 'failed', 'skipped'));

create index if not exists whatsapp_campaign_recipients_provider_message_idx
  on public.whatsapp_campaign_recipients (provider_message_id);
