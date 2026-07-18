alter table public.whatsapp_profiles
  add column if not exists greeting_enabled boolean not null default false,
  add column if not exists greeting_message text;
