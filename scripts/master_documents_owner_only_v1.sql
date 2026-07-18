-- Keep Document Master available for company owners, but remove accidental access from non-owner tenant roles.
-- This does not delete document types. It only repairs page permissions.

update public.app_pages
set is_active = true,
    updated_at = now()
where code = 'master_documents';

delete from public.role_page_permissions permission
using public.app_pages page_row, public.user_roles role_row
where permission.page_id = page_row.id
  and permission.role_id = role_row.id
  and page_row.code = 'master_documents'
  and upper(coalesce(role_row.code, '')) <> 'OWNER';

insert into public.role_page_permissions (company_id, role_id, page_id, can_view, can_add, can_edit, updated_at)
select roles.company_id, roles.id, pages.id, true, true, true, now()
from public.user_roles roles
join public.app_pages pages
  on pages.company_id = roles.company_id
 and pages.code = 'master_documents'
where upper(coalesce(roles.code, '')) = 'OWNER'
on conflict (company_id, role_id, page_id) do update
set can_view = true,
    can_add = true,
    can_edit = true,
    updated_at = now();

