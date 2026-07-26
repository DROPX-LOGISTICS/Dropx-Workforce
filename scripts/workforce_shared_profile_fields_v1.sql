begin;

-- Every workforce category uses the same configurable profile-field catalog.
-- Existing designation rules remain authoritative, so new columns stay hidden
-- until explicitly enabled for DropX One or Dashboard.
alter table public.employees
  add column if not exists eshram_uan text,
  add column if not exists is_handicapped boolean,
  add column if not exists driving_license_no text,
  add column if not exists driving_license_exp_date date,
  add column if not exists vehicle_reg_no text,
  add column if not exists vehicle_reg_exp_date date,
  add column if not exists vehicle_insurance_exp_date date,
  add column if not exists vehicle_pollution_exp_date date,
  add column if not exists dl_front_path text,
  add column if not exists dl_back_path text;

do $$
declare
  workforce_table text;
begin
  foreach workforce_table in array array['field_executives', 'contractors', 'vendors', 'workers']
  loop
    execute format(
      'alter table public.%I
        add column if not exists statutory_applicability text[] not null default array[''not_applicable'']::text[],
        add column if not exists pf_uan text,
        add column if not exists pf_account_no text,
        add column if not exists esi_no text',
      workforce_table
    );
  end loop;
end
$$;

alter table public.employees
  drop constraint if exists employees_eshram_uan_digits_check;
alter table public.employees
  add constraint employees_eshram_uan_digits_check
  check (eshram_uan is null or eshram_uan ~ '^[0-9]{12}$');

do $$
declare
  workforce_table text;
begin
  foreach workforce_table in array array['field_executives', 'contractors', 'vendors', 'workers']
  loop
    execute format('alter table public.%I drop constraint if exists %I', workforce_table, workforce_table || '_statutory_values');
    execute format(
      'alter table public.%I add constraint %I check (
        statutory_applicability <@ array[''not_applicable'', ''pf'', ''esi'']::text[]
      )',
      workforce_table,
      workforce_table || '_statutory_values'
    );
  end loop;
end
$$;

commit;
