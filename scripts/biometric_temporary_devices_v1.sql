begin;

alter table public.biometric_devices
  add column if not exists is_temporary boolean not null default false,
  add column if not exists temporary_until date;

create index if not exists biometric_devices_company_temporary_idx
  on public.biometric_devices(company_id, is_temporary, temporary_until)
  where is_temporary = true;

commit;
