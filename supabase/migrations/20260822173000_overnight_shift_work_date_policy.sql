begin;

alter table public.hr_company_settings
  add column if not exists overnight_shift_pairing_enabled boolean not null default true,
  add column if not exists overnight_pairing_window_minutes integer not null default 1080;

alter table public.hr_company_settings
  drop constraint if exists hr_company_settings_overnight_pairing_window_check,
  add constraint hr_company_settings_overnight_pairing_window_check
    check (overnight_pairing_window_minutes between 60 and 1440);

comment on column public.hr_company_settings.overnight_shift_pairing_enabled is
  'When enabled, punches after midnight remain on the overnight shift start date.';
comment on column public.hr_company_settings.overnight_pairing_window_minutes is
  'Maximum elapsed time from overnight shift start, or an unclosed first punch, that may remain on the prior work date.';

commit;
notify pgrst, 'reload schema';
