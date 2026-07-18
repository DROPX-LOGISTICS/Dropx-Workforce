insert into public.app_pages (company_id, code, name, sort_order, is_active, updated_at)
select companies.id, 'trash', 'Trash', 104, true, now()
from public.companies companies
on conflict (company_id, code) do update
set name = excluded.name,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now();

insert into public.role_page_permissions (company_id, role_id, page_id, can_view, can_add, can_edit, updated_at)
select roles.company_id, roles.id, pages.id, true, true, true, now()
from public.user_roles roles
join public.app_pages pages
  on pages.company_id = roles.company_id
 and pages.code = 'trash'
where roles.code = 'OWNER'
on conflict (company_id, role_id, page_id) do update
set can_view = true,
    can_add = true,
    can_edit = true,
    updated_at = now();
