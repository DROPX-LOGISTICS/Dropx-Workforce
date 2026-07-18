begin;

do $$
declare
  master_company uuid;
begin
  select id
    into master_company
    from public.companies
   where code = 'DROPX_LOGISTICS'
   limit 1;

  if master_company is null then
    select id
      into master_company
      from public.companies
     where is_master is true
     limit 1;
  end if;

  if master_company is null then
    select id
      into master_company
      from public.companies
     limit 1;
  end if;

  if master_company is null then
    raise exception 'No company row found. Run scripts/company_master_v1.sql first.';
  end if;

  alter table public.app_pages
    add column if not exists company_id uuid;

  update public.app_pages
     set company_id = master_company
   where company_id is null;

  alter table public.app_pages
    alter column company_id set not null;

  alter table public.user_roles
    add column if not exists company_id uuid;

  update public.user_roles
     set company_id = master_company
   where company_id is null;

  alter table public.user_roles
    alter column company_id set not null;

  alter table public.role_page_permissions
    add column if not exists company_id uuid;

  update public.role_page_permissions permission
     set company_id = coalesce(role.company_id, page.company_id, master_company)
    from public.user_roles role,
         public.app_pages page
   where permission.role_id = role.id
     and permission.page_id = page.id
     and permission.company_id is null;

  update public.role_page_permissions
     set company_id = master_company
   where company_id is null;

  alter table public.role_page_permissions
    alter column company_id set not null;
end $$;

do $$
begin
  alter table public.app_pages
    add constraint app_pages_company_id_fkey
    foreign key (company_id) references public.companies(id) on delete cascade;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.user_roles
    add constraint user_roles_company_id_fkey
    foreign key (company_id) references public.companies(id) on delete cascade;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.role_page_permissions
    add constraint role_page_permissions_company_id_fkey
    foreign key (company_id) references public.companies(id) on delete cascade;
exception
  when duplicate_object then null;
end $$;

create index if not exists app_pages_company_id_idx
  on public.app_pages(company_id);

create index if not exists user_roles_company_id_idx
  on public.user_roles(company_id);

create index if not exists role_page_permissions_company_id_idx
  on public.role_page_permissions(company_id);

create index if not exists role_page_permissions_company_role_idx
  on public.role_page_permissions(company_id, role_id);

create index if not exists role_page_permissions_company_page_idx
  on public.role_page_permissions(company_id, page_id);

alter table public.app_pages
  drop constraint if exists app_pages_code_key;

alter table public.user_roles
  drop constraint if exists user_roles_code_key;

alter table public.role_page_permissions
  drop constraint if exists role_page_permissions_pkey;

create unique index if not exists app_pages_company_code_key
  on public.app_pages(company_id, code);

create unique index if not exists user_roles_company_code_key
  on public.user_roles(company_id, code);

create unique index if not exists role_page_permissions_company_role_page_key
  on public.role_page_permissions(company_id, role_id, page_id);

commit;
