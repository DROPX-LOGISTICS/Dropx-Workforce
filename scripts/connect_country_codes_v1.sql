alter table public.profiles
  add column if not exists mobile_country_code text not null default '91';

alter table public.field_executives
  add column if not exists mobile_country_code text not null default '91';

alter table public.companies
  add column if not exists admin_mobile_country_code text not null default '91';

update public.profiles
set mobile_country_code = '91'
where mobile_country_code is null or btrim(mobile_country_code) = '';

update public.field_executives
set mobile_country_code = '91'
where mobile_country_code is null or btrim(mobile_country_code) = '';

update public.companies
set admin_mobile_country_code = '91'
where admin_mobile_country_code is null or btrim(admin_mobile_country_code) = '';

create index if not exists profiles_company_mobile_country_idx
  on public.profiles (company_id, mobile_country_code, mobile);

alter table public.field_executives
  drop constraint if exists field_executives_mobile_format;

alter table public.field_executives
  add constraint field_executives_mobile_format check (mobile ~ '^[0-9]{6,15}$');

drop index if exists public.field_executives_mobile_unique;

create index if not exists field_executives_company_mobile_country_idx
  on public.field_executives (company_id, mobile_country_code, mobile);

create unique index if not exists field_executives_company_country_mobile_unique
  on public.field_executives (company_id, mobile_country_code, mobile);
