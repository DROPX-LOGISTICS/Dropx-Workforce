begin;

-- A single mobile number can belong to multiple IDs in the same company.
-- Connect OTP/PIN remains mobile-level, and users choose the correct account after verification.
drop index if exists public.field_executives_mobile_unique;
drop index if exists public.field_executives_company_country_mobile_unique;

create index if not exists field_executives_company_mobile_country_idx
  on public.field_executives (company_id, mobile_country_code, mobile);

create index if not exists profiles_company_mobile_country_idx
  on public.profiles (company_id, mobile_country_code, mobile);

commit;
