begin;

create table if not exists public.payment_banks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  bank_code text not null,
  display_name text not null,
  account_no text not null,
  ifsc text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_banks_company_account_key unique (company_id, account_no)
);

alter table public.payment_banks add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.payment_banks add column if not exists bank_code text;
alter table public.payment_banks add column if not exists display_name text;
alter table public.payment_banks add column if not exists account_no text;
alter table public.payment_banks add column if not exists ifsc text;
alter table public.payment_banks add column if not exists is_active boolean not null default true;
alter table public.payment_banks add column if not exists created_at timestamptz not null default now();
alter table public.payment_banks add column if not exists updated_at timestamptz not null default now();

create unique index if not exists payment_banks_company_account_key
  on public.payment_banks(company_id, account_no);
create index if not exists payment_banks_company_idx
  on public.payment_banks(company_id);

alter table public.payment_banks enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'payment_banks'
      and policyname = 'service_role_payment_banks_all'
  ) then
    create policy "service_role_payment_banks_all"
      on public.payment_banks
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;

insert into public.app_pages (company_id, code, name, sort_order, is_active, updated_at)
select companies.id, page_data.code, page_data.name, page_data.sort_order, true, now()
from public.companies
cross join (
  values
    ('master_payment_banks', 'Payment Banks', 124),
    ('payment_process', 'Payment Process', 107)
) as page_data(code, name, sort_order)
where not exists (
  select 1
  from public.app_pages pages
  where pages.company_id = companies.id
    and pages.code = page_data.code
);

update public.app_pages pages
set name = page_data.name,
    sort_order = page_data.sort_order,
    is_active = true,
    updated_at = now()
from (
  values
    ('master_payment_banks', 'Payment Banks', 124),
    ('payment_process', 'Payment Process', 107)
) as page_data(code, name, sort_order)
where pages.code = page_data.code
  and pages.company_id is not null;

insert into public.role_page_permissions (company_id, role_id, page_id, can_view, can_add, can_edit)
select roles.company_id, roles.id, pages.id, true, true, true
from public.user_roles roles
join public.app_pages pages
  on pages.company_id = roles.company_id
where roles.code = 'OWNER'
  and pages.code in ('master_payment_banks', 'payment_process')
  and not exists (
    select 1
    from public.role_page_permissions permissions
    where permissions.company_id = roles.company_id
      and permissions.role_id = roles.id
      and permissions.page_id = pages.id
  );

commit;
