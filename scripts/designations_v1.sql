create extension if not exists pgcrypto;

insert into public.app_pages (code, name, sort_order, is_active, updated_at)
values ('designations', 'Designations', 122, true, now())
on conflict (code) do update
set name = excluded.name,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now();

insert into public.role_page_permissions (role_id, page_id, can_view, can_add, can_edit, updated_at)
select roles.id, pages.id, true, true, true, now()
from public.user_roles roles
join public.app_pages pages on pages.code = 'designations'
where roles.code = 'OWNER'
on conflict (role_id, page_id) do update
set can_view = true,
    can_add = true,
    can_edit = true,
    updated_at = now();

create table if not exists public.designations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  provider_ids uuid[] not null default '{}',
  onboarding_categories text[] not null default array['employees']::text[],
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists designations_provider_ids_idx
  on public.designations using gin(provider_ids);

create index if not exists designations_onboarding_categories_idx
  on public.designations using gin(onboarding_categories);

alter table public.designations enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'designations'
      and policyname = 'service_role_designations_all'
  ) then
    create policy "service_role_designations_all"
      on public.designations
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

insert into public.designations (code, name, provider_ids, is_active, updated_at)
select code, name, '{}'::uuid[], true, now()
from public.lead_job_roles
where is_active = true
on conflict (code) do update
set name = excluded.name,
    updated_at = now();
