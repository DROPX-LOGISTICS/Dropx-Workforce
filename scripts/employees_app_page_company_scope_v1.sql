begin;

insert into public.app_pages (company_id, code, name, sort_order, is_active, created_at)
select companies.id, 'employees', 'Employees', 21, true, now()
from public.companies
where not exists (
  select 1
  from public.app_pages pages
  where pages.company_id = companies.id
    and pages.code = 'employees'
);

update public.app_pages
set name = 'Employees',
    sort_order = 21,
    is_active = true
where code = 'employees';

commit;
