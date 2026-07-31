-- Independently manageable Service Network permissions for every company.
insert into public.app_pages (company_id, code, name, sort_order, is_active, created_at, updated_at)
select companies.id, definitions.code, definitions.name, definitions.sort_order, true, now(), now()
from public.companies companies
cross join (values
  ('service_network', 'Service Network', 84.1::numeric),
  ('service_network_master', 'Service Network Master', 84.2::numeric)
) as definitions(code, name, sort_order)
where not exists (
  select 1 from public.app_pages pages
  where pages.company_id = companies.id and pages.code = definitions.code
);

-- Owners receive access automatically. Configure every other role in Users & Access.
insert into public.role_page_permissions (company_id, role_id, page_id, can_view, can_add, can_edit, created_at, updated_at)
select roles.company_id, roles.id, pages.id, true, true, true, now(), now()
from public.user_roles roles
join public.app_pages pages on pages.company_id = roles.company_id
where upper(roles.code) = 'OWNER'
  and pages.code in ('service_network', 'service_network_master')
  and not exists (
    select 1 from public.role_page_permissions permissions
    where permissions.company_id = roles.company_id
      and permissions.role_id = roles.id
      and permissions.page_id = pages.id
  );
