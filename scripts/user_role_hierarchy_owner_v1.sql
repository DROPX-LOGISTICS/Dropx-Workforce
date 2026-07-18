alter table if exists public.user_roles
  add column if not exists parent_role_id uuid references public.user_roles(id),
  add column if not exists is_system boolean not null default false;

alter table if exists public.profiles
  add column if not exists reports_to_user_id uuid references public.profiles(id);

create index if not exists user_roles_parent_role_id_idx
  on public.user_roles (parent_role_id);

create index if not exists profiles_reports_to_user_id_idx
  on public.profiles (reports_to_user_id);

insert into public.user_roles (code, name, is_active, is_system)
values ('OWNER', 'Owner', true, true)
on conflict (code) do update set
  name = excluded.name,
  is_active = true,
  is_system = true,
  updated_at = now();

insert into public.role_page_permissions (role_id, page_id, can_view, can_add, can_edit)
select owner_role.id, app_pages.id, true, true, true
from public.user_roles owner_role
cross join public.app_pages
where owner_role.code = 'OWNER'
on conflict (role_id, page_id) do update set
  can_view = true,
  can_add = true,
  can_edit = true,
  updated_at = now();

update public.profiles
set
  role_id = (select id from public.user_roles where code = 'OWNER'),
  is_active = true
where lower(email) = 'nisar@dropxlogistics.com';
