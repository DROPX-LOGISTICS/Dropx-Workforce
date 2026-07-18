create extension if not exists pgcrypto;

insert into public.app_pages (code, name, sort_order, is_active, updated_at)
values ('inbox', 'Inbox', 102, true, now())
on conflict (code) do update
set name = excluded.name,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now();

insert into public.role_page_permissions (role_id, page_id, can_view, can_add, can_edit)
select user_roles.id, app_pages.id, true, true, true
from public.user_roles
cross join public.app_pages
where user_roles.code = 'OWNER'
  and app_pages.code = 'inbox'
on conflict (role_id, page_id) do update
set can_view = true,
    can_add = true,
    can_edit = true;

create table if not exists public.inbox_conversations (
  id uuid primary key default gen_random_uuid(),
  channel text not null default 'whatsapp' check (channel in ('whatsapp', 'instagram', 'facebook')),
  whatsapp_profile_id uuid references public.whatsapp_profiles(id) on delete set null,
  whatsapp_profile_name text,
  contact_external_id text not null,
  contact_name text,
  contact_phone text,
  status text not null default 'open' check (status in ('open', 'pending', 'closed')),
  last_message_preview text,
  last_message_at timestamptz,
  unread_count integer not null default 0,
  assigned_to uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, whatsapp_profile_id, contact_external_id)
);

create table if not exists public.inbox_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.inbox_conversations(id) on delete cascade,
  channel text not null default 'whatsapp' check (channel in ('whatsapp', 'instagram', 'facebook')),
  whatsapp_profile_id uuid references public.whatsapp_profiles(id) on delete set null,
  direction text not null check (direction in ('incoming', 'outgoing')),
  provider_message_id text,
  message_type text not null default 'text',
  message_text text,
  contact_external_id text,
  contact_name text,
  contact_phone text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'received',
  message_timestamp timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists inbox_messages_provider_message_idx
  on public.inbox_messages (provider_message_id)
  where provider_message_id is not null;

create index if not exists inbox_conversations_last_message_idx
  on public.inbox_conversations (last_message_at desc nulls last);

create index if not exists inbox_conversations_profile_idx
  on public.inbox_conversations (whatsapp_profile_id, status);

create index if not exists inbox_messages_conversation_idx
  on public.inbox_messages (conversation_id, message_timestamp);

create index if not exists inbox_messages_created_at_idx
  on public.inbox_messages (created_at desc);

alter table public.inbox_conversations enable row level security;
alter table public.inbox_messages enable row level security;
