-- Repairs cross-company page permission rows.
-- Safe target: removes only grants where the grant company, role company, and page company do not match.

delete from public.role_page_permissions permission
using public.user_roles role_row, public.app_pages page_row
where permission.role_id = role_row.id
  and permission.page_id = page_row.id
  and (
    permission.company_id is distinct from role_row.company_id
    or permission.company_id is distinct from page_row.company_id
    or role_row.company_id is distinct from page_row.company_id
  );

create index if not exists app_pages_company_code_idx
  on public.app_pages(company_id, code);

create index if not exists role_page_permissions_company_role_page_idx
  on public.role_page_permissions(company_id, role_id, page_id);

