begin;

-- Give each reused Ops navigation entry an independently assignable page code.
with wanted_pages(code, name, sort_order) as (
  values
    ('performance', 'Performance', 84),
    ('capacity', 'Capacity', 84),
    ('capacity_overview', 'Capacity Overview', 84),
    ('capacity_associates', 'Associate SPR', 84),
    ('capacity_delivery', 'Delivery Data', 84),
    ('capacity_hiring', 'Hiring Review', 84),
    ('ops_reports', 'Ops Reports', 84),
    ('performance_master', 'Performance Master', 130),
    ('capacity_master', 'Capacity Master', 130)
)
insert into public.app_pages (company_id, code, name, sort_order, is_active, created_at, updated_at)
select companies.id, wanted_pages.code, wanted_pages.name, wanted_pages.sort_order, true, now(), now()
from public.companies
cross join wanted_pages
where not exists (
  select 1
  from public.app_pages pages
  where pages.company_id = companies.id
    and pages.code = wanted_pages.code
);

with wanted_pages(code, name, sort_order) as (
  values
    ('performance', 'Performance', 84),
    ('capacity', 'Capacity', 84),
    ('capacity_overview', 'Capacity Overview', 84),
    ('capacity_associates', 'Associate SPR', 84),
    ('capacity_delivery', 'Delivery Data', 84),
    ('capacity_hiring', 'Hiring Review', 84),
    ('ops_reports', 'Ops Reports', 84),
    ('performance_master', 'Performance Master', 130),
    ('capacity_master', 'Capacity Master', 130)
)
update public.app_pages pages
set name = wanted_pages.name,
    sort_order = wanted_pages.sort_order,
    is_active = true,
    updated_at = now()
from wanted_pages
where pages.code = wanted_pages.code;

-- Preserve existing access when splitting shared permissions. Explicit grants on
-- the new page codes are never overwritten by this migration.
with permission_map(source_code, target_code) as (
  values
    ('cod_reports', 'performance'),
    ('cps_associates', 'capacity'),
    ('cps_associates', 'capacity_overview'),
    ('cps_associates', 'capacity_associates'),
    ('cps_associates', 'capacity_delivery'),
    ('cps_associates', 'capacity_hiring'),
    ('cod_reports', 'ops_reports'),
    ('cod_master', 'performance_master'),
    ('cod_master', 'capacity_master')
), copied_permissions as (
  select
    permissions.company_id,
    permissions.role_id,
    target_page.id as page_id,
    (permissions.can_view or permissions.can_add or permissions.can_edit) as can_view,
    permissions.can_add,
    permissions.can_edit
  from permission_map
  join public.app_pages source_page
    on source_page.code = permission_map.source_code
  join public.app_pages target_page
    on target_page.company_id = source_page.company_id
   and target_page.code = permission_map.target_code
  join public.role_page_permissions permissions
    on permissions.company_id = source_page.company_id
   and permissions.page_id = source_page.id
)
insert into public.role_page_permissions (
  company_id, role_id, page_id, can_view, can_add, can_edit, created_at, updated_at
)
select company_id, role_id, page_id, can_view, can_add, can_edit, now(), now()
from copied_permissions
on conflict (company_id, role_id, page_id) do nothing;

-- Company owners keep full access to all newly separated menus.
insert into public.role_page_permissions (
  company_id, role_id, page_id, can_view, can_add, can_edit, created_at, updated_at
)
select roles.company_id, roles.id, pages.id, true, true, true, now(), now()
from public.user_roles roles
join public.app_pages pages
  on pages.company_id = roles.company_id
 and pages.code in ('performance', 'capacity', 'capacity_overview', 'capacity_associates', 'capacity_delivery', 'capacity_hiring', 'ops_reports', 'performance_master', 'capacity_master')
where upper(coalesce(roles.code, '')) = 'OWNER'
on conflict (company_id, role_id, page_id) do update
set can_view = true,
    can_add = true,
    can_edit = true,
    updated_at = now();

commit;
