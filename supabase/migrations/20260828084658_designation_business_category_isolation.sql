begin;

create extension if not exists pgcrypto;

create table if not exists public.designation_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  people_module text not null,
  is_system boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint designation_categories_code_format_check
    check (code = lower(code) and code ~ '^[a-z0-9_]+$'),
  constraint designation_categories_people_module_check
    check (people_module in ('delivery_network', 'people_hr')),
  constraint designation_categories_company_code_unique unique (company_id, code)
);

create index if not exists designation_categories_company_active_idx
  on public.designation_categories(company_id, is_active, sort_order, name);

with category_seed(code, name, people_module, sort_order) as (
  values
    ('workforce', 'Workforce', 'delivery_network', 10),
    ('hr', 'HR', 'people_hr', 20)
)
insert into public.designation_categories (
  company_id,
  code,
  name,
  people_module,
  is_system,
  is_active,
  sort_order
)
select
  company.id,
  category_seed.code,
  category_seed.name,
  category_seed.people_module,
  true,
  true,
  category_seed.sort_order
from public.companies company
cross join category_seed
on conflict (company_id, code) do update
set
  name = excluded.name,
  people_module = excluded.people_module,
  is_system = true,
  is_active = true,
  sort_order = excluded.sort_order,
  updated_at = now();

alter table public.designations
  add column if not exists designation_category_id uuid;

alter table public.designations
  drop constraint if exists designations_designation_category_id_fkey;

alter table public.designations
  add constraint designations_designation_category_id_fkey
  foreign key (designation_category_id)
  references public.designation_categories(id)
  on delete restrict;

-- Existing designations are classified once so the master starts usable. This
-- is a data migration only; application routing reads designation_category_id.
-- Existing people rows and active invitations are not moved.
update public.designations designation
set designation_category_id = category.id
from public.designation_categories category
where category.company_id = designation.company_id
  and category.code = case
    when upper(designation.code) in ('DA', 'DCD', 'DR', 'HK', 'ODCD', 'PTDA', 'RINF', 'SRTR', 'VAN', 'VNV', 'WM')
    then 'workforce'
    else 'hr'
  end
  and designation.designation_category_id is null;

alter table public.designations
  alter column designation_category_id set not null;

create index if not exists designations_company_designation_category_idx
  on public.designations(company_id, designation_category_id, is_active, name);

create or replace function public.seed_designation_categories_for_company()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.designation_categories (
    company_id,
    code,
    name,
    people_module,
    is_system,
    is_active,
    sort_order
  )
  values
    (new.id, 'workforce', 'Workforce', 'delivery_network', true, true, 10),
    (new.id, 'hr', 'HR', 'people_hr', true, true, 20)
  on conflict (company_id, code) do nothing;
  return new;
end;
$$;

drop trigger if exists companies_seed_designation_categories on public.companies;
create trigger companies_seed_designation_categories
after insert on public.companies
for each row execute function public.seed_designation_categories_for_company();

alter table public.designation_categories enable row level security;

revoke all on table public.designation_categories from anon, authenticated;
grant select, insert, update, delete on table public.designation_categories to service_role;

comment on table public.designation_categories is
  'Database-backed Workforce or HR classification selected within Designation details.';
comment on column public.designation_categories.people_module is
  'Dashboard module that receives new profiles assigned to this category.';
comment on column public.designations.designation_category_id is
  'Required Workforce or HR classification; independent from engagement type in onboarding_categories.';

notify pgrst, 'reload schema';

commit;
