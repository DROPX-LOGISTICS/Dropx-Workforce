with old_permissions as (
  select
    old_permission.role_id,
    old_permission.company_id,
    bool_or(old_permission.can_view) as can_view,
    bool_or(old_permission.can_add) as can_add,
    bool_or(old_permission.can_edit) as can_edit
  from public.role_page_permissions old_permission
  join public.app_pages old_page
    on old_page.id = old_permission.page_id
   and old_page.company_id = old_permission.company_id
   and old_page.code = 'mapping'
  group by old_permission.role_id, old_permission.company_id
)
update public.role_page_permissions provider_permission
set can_view = provider_permission.can_view or old_permissions.can_view,
    can_add = provider_permission.can_add or old_permissions.can_add,
    can_edit = provider_permission.can_edit or old_permissions.can_edit,
    updated_at = now()
from old_permissions
join public.app_pages provider_page
  on provider_page.company_id = old_permissions.company_id
 and provider_page.code = 'provider_mapping'
where provider_permission.role_id = old_permissions.role_id
  and provider_permission.page_id = provider_page.id
  and provider_permission.company_id = old_permissions.company_id;

insert into public.role_page_permissions (
  role_id,
  page_id,
  can_view,
  can_add,
  can_edit,
  company_id,
  created_at,
  updated_at
)
select
  old_permission.role_id,
  provider_page.id,
  bool_or(old_permission.can_view),
  bool_or(old_permission.can_add),
  bool_or(old_permission.can_edit),
  old_permission.company_id,
  now(),
  now()
from public.role_page_permissions old_permission
join public.app_pages old_page
  on old_page.id = old_permission.page_id
 and old_page.company_id = old_permission.company_id
 and old_page.code = 'mapping'
join public.app_pages provider_page
  on provider_page.company_id = old_permission.company_id
 and provider_page.code = 'provider_mapping'
where not exists (
  select 1
  from public.role_page_permissions existing
  where existing.role_id = old_permission.role_id
    and existing.page_id = provider_page.id
    and existing.company_id = old_permission.company_id
)
group by old_permission.role_id, provider_page.id, old_permission.company_id;

update public.app_pages
set is_active = false,
    updated_at = now()
where code = 'mapping';
