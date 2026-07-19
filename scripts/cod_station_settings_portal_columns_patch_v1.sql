begin;

alter table public.cod_station_settings
  add column if not exists portal_station_code text,
  add column if not exists portal_login_url text,
  add column if not exists portal_username text,
  add column if not exists portal_secret_name text,
  add column if not exists amazon_driver_recon_url text,
  add column if not exists amazon_bank_deposit_url text,
  add column if not exists driver_recon_due_time time,
  add column if not exists prepared_deposit_due_time time,
  add column if not exists portal_check_interval_minutes integer not null default 30,
  add column if not exists portal_checks_enabled boolean not null default false;

update public.cod_station_settings
set
  portal_station_code = coalesce(nullif(portal_station_code, ''), station_code),
  portal_check_interval_minutes = coalesce(portal_check_interval_minutes, 30),
  portal_checks_enabled = coalesce(portal_checks_enabled, false)
where
  portal_station_code is null
  or portal_station_code = ''
  or portal_check_interval_minutes is null
  or portal_checks_enabled is null;

create index if not exists cod_station_settings_company_portal_station_idx
  on public.cod_station_settings(company_id, portal_station_code);

commit;
