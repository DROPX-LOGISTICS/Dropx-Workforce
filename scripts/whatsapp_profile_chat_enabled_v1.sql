alter table public.whatsapp_profiles
  add column if not exists chat_enabled boolean not null default true;

update public.whatsapp_profiles
set chat_enabled = true
where chat_enabled is null;
