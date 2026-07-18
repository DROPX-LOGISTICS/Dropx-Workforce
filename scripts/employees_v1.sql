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

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  employee_code text,
  biometric_id text,
  full_name text not null,
  mobile_country_code text not null default '91',
  mobile text not null,
  email text,
  date_of_join date not null,
  location_id uuid references public.stations(id) on delete restrict,
  designation_id uuid references public.designations(id) on delete set null,
  statutory_applicability text[] not null default array['not_applicable']::text[],
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employees_mobile_format check (mobile ~ '^[0-9]{6,15}$'),
  constraint employees_statutory_values check (
    statutory_applicability <@ array['not_applicable', 'pf', 'esi']::text[]
  )
);

alter table public.employees
  add column if not exists employee_code text;

alter table public.employees
  add column if not exists biometric_id text;

create index if not exists employees_company_id_idx
  on public.employees (company_id);

create index if not exists employees_company_location_idx
  on public.employees (company_id, location_id);

create index if not exists employees_company_designation_idx
  on public.employees (company_id, designation_id);

create index if not exists employees_company_mobile_idx
  on public.employees (company_id, mobile_country_code, mobile);

create unique index if not exists employees_company_employee_code_key
  on public.employees (company_id, employee_code)
  where employee_code is not null;

alter table public.employees enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'employees'
      and policyname = 'service_role_employees_all'
  ) then
    create policy "service_role_employees_all"
      on public.employees
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;

commit;
