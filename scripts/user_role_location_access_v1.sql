alter table if exists public.user_roles
  add column if not exists location_access_mode text not null default 'role_based';

update public.user_roles
set location_access_mode = 'all_locations'
where code = 'OWNER';
