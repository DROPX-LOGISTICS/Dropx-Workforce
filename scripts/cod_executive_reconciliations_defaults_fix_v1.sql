-- Fix incomplete cod_executive_reconciliations schema on personal/dev DBs:
-- missing id/created_at/updated_at defaults and unique row index break Save cash.

begin;

alter table public.cod_executive_reconciliations
  alter column id set default gen_random_uuid();

alter table public.cod_executive_reconciliations
  alter column created_at set default now();

alter table public.cod_executive_reconciliations
  alter column updated_at set default now();

create unique index if not exists cod_executive_reconciliations_unique_row
  on public.cod_executive_reconciliations(company_id, business_date, station_code, provider_employee_id);

commit;
