begin;

create extension if not exists pgcrypto;

create table if not exists public.ops_network_sectors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  station_id uuid not null references public.stations(id) on delete cascade,
  code text not null,
  name text not null,
  color text not null default '#2563eb',
  expected_daily_volume integer not null default 0 check (expected_daily_volume >= 0),
  bike_volume_percent numeric(5,2) not null default 70 check (bike_volume_percent between 0 and 100),
  tl_user_id uuid references public.profiles(id) on delete set null,
  ssa_user_id uuid references public.profiles(id) on delete set null,
  is_active boolean not null default true,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, station_id, code)
);

create table if not exists public.ops_network_sector_pincodes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  station_id uuid not null references public.stations(id) on delete cascade,
  sector_id uuid not null references public.ops_network_sectors(id) on delete cascade,
  pincode text not null check (pincode ~ '^[0-9]{6}$'),
  service_state text not null default 'active' check (service_state in ('active', 'temporary', 'split', 'merged', 'paused')),
  effective_from date not null default current_date,
  effective_to date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  unique (company_id, station_id, sector_id, pincode, effective_from)
);

create table if not exists public.ops_route_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  station_id uuid not null references public.stations(id) on delete cascade,
  sector_id uuid not null references public.ops_network_sectors(id) on delete cascade,
  plan_date date not null,
  route_code text not null,
  route_name text not null,
  pincodes text[] not null default '{}',
  expected_volume integer not null default 0 check (expected_volume >= 0),
  vehicle_type text not null default 'bike' check (vehicle_type in ('bike', 'van', 'mixed')),
  shift_code text not null default 'general',
  planned_start_time time,
  planned_end_time time,
  capacity_override integer check (capacity_override is null or capacity_override > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'in_progress', 'completed', 'cancelled')),
  is_temporary boolean not null default false,
  change_reason text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, station_id, plan_date, route_code)
);

create table if not exists public.ops_route_roster (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  station_id uuid not null references public.stations(id) on delete cascade,
  route_plan_id uuid not null references public.ops_route_plans(id) on delete cascade,
  field_executive_id uuid not null references public.field_executives(id) on delete cascade,
  roster_status text not null default 'planned' check (roster_status in ('planned', 'present', 'absent', 'leave', 'replacement', 'standby', 'released')),
  replacement_for_id uuid references public.field_executives(id) on delete set null,
  allocation_source text not null default 'sector' check (allocation_source in ('sector', 'backup_pool', 'cross_sector', 'manual')),
  is_cross_sector boolean not null default false,
  shift_code text not null default 'general',
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (route_plan_id, field_executive_id)
);

create table if not exists public.ops_network_backup_pool (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  station_id uuid not null references public.stations(id) on delete cascade,
  field_executive_id uuid not null references public.field_executives(id) on delete cascade,
  vehicle_type text not null check (vehicle_type in ('bike', 'van')),
  effective_from date not null default current_date,
  effective_to date,
  priority integer not null default 100 check (priority > 0),
  is_active boolean not null default true,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  unique (company_id, station_id, field_executive_id, effective_from)
);

create table if not exists public.ops_weekly_roster_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  station_id uuid not null references public.stations(id) on delete cascade,
  sector_id uuid references public.ops_network_sectors(id) on delete cascade,
  name text not null,
  template_payload jsonb not null default '{"routes":[]}'::jsonb,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, station_id, name)
);

create table if not exists public.ops_network_delegations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  station_id uuid not null references public.stations(id) on delete cascade,
  sector_id uuid references public.ops_network_sectors(id) on delete cascade,
  delegated_by_user_id uuid not null references public.profiles(id) on delete cascade,
  assigned_to_user_id uuid not null references public.profiles(id) on delete cascade,
  permission_level text not null default 'plan' check (permission_level in ('view', 'plan', 'approve')),
  effective_from date not null default current_date,
  effective_to date,
  reason text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create table if not exists public.ops_vehicle_incidents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  station_id uuid not null references public.stations(id) on delete cascade,
  route_plan_id uuid references public.ops_route_plans(id) on delete set null,
  field_executive_id uuid references public.field_executives(id) on delete set null,
  incident_date date not null,
  vehicle_type text not null check (vehicle_type in ('bike', 'van')),
  incident_type text not null check (incident_type in ('breakdown', 'accident', 'unavailable', 'capacity_restriction', 'other')),
  status text not null default 'open' check (status in ('open', 'replacement_assigned', 'resolved')),
  details text,
  replacement_field_executive_id uuid references public.field_executives(id) on delete set null,
  reported_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ops_network_sectors_station_idx on public.ops_network_sectors(company_id, station_id, is_active);
create index if not exists ops_network_pincodes_sector_idx on public.ops_network_sector_pincodes(company_id, station_id, sector_id);
create index if not exists ops_route_plans_station_date_idx on public.ops_route_plans(company_id, station_id, plan_date);
create index if not exists ops_route_roster_route_idx on public.ops_route_roster(company_id, station_id, route_plan_id);
create index if not exists ops_backup_pool_station_idx on public.ops_network_backup_pool(company_id, station_id, is_active, priority);
create index if not exists ops_delegations_assignee_idx on public.ops_network_delegations(company_id, station_id, assigned_to_user_id, is_active);
create index if not exists ops_vehicle_incidents_station_date_idx on public.ops_vehicle_incidents(company_id, station_id, incident_date, status);

create or replace function public.set_ops_network_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'ops_network_sectors', 'ops_network_sector_pincodes', 'ops_route_plans',
    'ops_route_roster', 'ops_network_backup_pool', 'ops_weekly_roster_templates',
    'ops_network_delegations', 'ops_vehicle_incidents'
  ] loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_updated_at', table_name);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_ops_network_updated_at()',
      table_name || '_updated_at', table_name
    );
  end loop;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'ops_network_sectors', 'ops_network_sector_pincodes', 'ops_route_plans',
    'ops_route_roster', 'ops_network_backup_pool', 'ops_weekly_roster_templates',
    'ops_network_delegations', 'ops_vehicle_incidents'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on table public.%I to service_role', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_service_role_all', table_name);
    execute format(
      'create policy %I on public.%I for all to service_role using (true) with check (true)',
      table_name || '_service_role_all', table_name
    );
  end loop;
end;
$$;

update public.app_pages
set name = case code
  when 'service_network' then 'Network Planning'
  when 'service_network_master' then 'Network Planning Master'
end,
updated_at = now()
where code in ('service_network', 'service_network_master');

insert into public.user_roles (company_id, code, name, parent_role_id, location_access_mode, is_active, is_system)
select companies.id, role_seed.code, role_seed.name, null, 'role_based', true, false
from public.companies
cross join (values
  ('STATION_MANAGER', 'Station Manager'),
  ('TEAM_LEADER', 'Team Leader'),
  ('SSA', 'Station Support Associate')
) as role_seed(code, name)
where companies.is_active is true
on conflict (company_id, code) do update set
  name = excluded.name,
  location_access_mode = 'role_based',
  is_active = true,
  updated_at = now();

update public.user_roles child
set parent_role_id = parent.id,
    updated_at = now()
from public.user_roles parent
where child.company_id = parent.company_id
  and child.parent_role_id is null
  and (
    (child.code = 'STATION_MANAGER' and parent.code = 'LOCATION')
    or (child.code = 'TEAM_LEADER' and parent.code = 'STATION_MANAGER')
    or (child.code = 'SSA' and parent.code = 'TEAM_LEADER')
  );

insert into public.role_page_permissions (company_id, role_id, page_id, can_view, can_add, can_edit)
select roles.company_id, roles.id, pages.id, true, true, true
from public.user_roles roles
join public.app_pages pages on pages.company_id = roles.company_id
where upper(roles.code) in ('OWNER', 'ADMIN', 'STATION_MANAGER')
  and pages.code in ('service_network', 'service_network_master')
on conflict (company_id, role_id, page_id) do update set
  company_id = excluded.company_id,
  can_view = true,
  can_add = true,
  can_edit = true,
  updated_at = now();

insert into public.role_page_permissions (company_id, role_id, page_id, can_view, can_add, can_edit)
select roles.company_id, roles.id, pages.id, true,
  pages.code = 'service_network',
  pages.code = 'service_network'
from public.user_roles roles
join public.app_pages pages on pages.company_id = roles.company_id
where upper(roles.code) in ('TEAM_LEADER', 'SSA')
  and pages.code in ('service_network', 'service_network_master')
on conflict (company_id, role_id, page_id) do update set
  company_id = excluded.company_id,
  can_view = excluded.can_view,
  can_add = excluded.can_add,
  can_edit = excluded.can_edit,
  updated_at = now();

commit;
