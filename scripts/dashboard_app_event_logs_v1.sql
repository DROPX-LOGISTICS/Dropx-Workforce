create table if not exists public.dashboard_app_event_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  platform text not null check (platform in ('dashboard', 'dropx_one_android', 'dropx_one_web')),
  event_code text not null,
  module text not null default 'general',
  action text not null default 'view',
  outcome text not null default 'info' check (outcome in ('info', 'success', 'failed', 'warning')),
  actor_type text not null default 'dashboard_user',
  actor_user_id uuid,
  actor_account_id uuid,
  actor_label text,
  actor_identifier text,
  subject_type text,
  subject_id uuid,
  subject_code text,
  subject_label text,
  route text,
  method text,
  metadata jsonb not null default '{}'::jsonb,
  user_agent text,
  ip_address text,
  created_at timestamptz not null default now()
);

create index if not exists dashboard_app_event_logs_company_created_idx
  on public.dashboard_app_event_logs (company_id, created_at desc);
create index if not exists dashboard_app_event_logs_company_platform_idx
  on public.dashboard_app_event_logs (company_id, platform, created_at desc);
create index if not exists dashboard_app_event_logs_company_event_idx
  on public.dashboard_app_event_logs (company_id, event_code, created_at desc);
create index if not exists dashboard_app_event_logs_company_actor_idx
  on public.dashboard_app_event_logs (company_id, actor_user_id, actor_account_id, created_at desc);

alter table public.dashboard_app_event_logs enable row level security;
drop policy if exists service_role_dashboard_app_event_logs_all on public.dashboard_app_event_logs;
create policy service_role_dashboard_app_event_logs_all
on public.dashboard_app_event_logs for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

insert into public.app_pages (code, name, sort_order, is_active)
values ('event_log_reports', 'Event Log', 133, true)
on conflict (code) do update set name = excluded.name, sort_order = excluded.sort_order, is_active = true;

insert into public.role_permissions (role_id, page_id, can_view, can_add, can_edit)
select r.id, p.id, true, true, true
from public.roles r
join public.app_pages p on p.code = 'event_log_reports'
where upper(r.code) = 'OWNER'
on conflict (role_id, page_id) do update
set can_view = true, can_add = true, can_edit = true;
