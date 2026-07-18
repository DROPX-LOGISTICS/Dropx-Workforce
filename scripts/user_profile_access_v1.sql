alter table if exists public.profiles
  add column if not exists employee_id text,
  add column if not exists mobile text,
  add column if not exists role_id uuid references public.user_roles(id),
  add column if not exists location_scope_ids uuid[] not null default '{}',
  add column if not exists invite_method text;

create unique index if not exists profiles_employee_id_unique
  on public.profiles (employee_id)
  where employee_id is not null;

create index if not exists profiles_role_id_idx
  on public.profiles (role_id);
