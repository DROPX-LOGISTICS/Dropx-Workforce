-- Fix incomplete cod_day_closures schema on personal/dev DBs:
-- missing id/created_at/updated_at defaults break cash submit inserts.

begin;

alter table public.cod_day_closures
  alter column id set default gen_random_uuid();

alter table public.cod_day_closures
  alter column created_at set default now();

alter table public.cod_day_closures
  alter column updated_at set default now();

alter table public.cod_day_closures
  alter column submitted_at set default now();

alter table public.cod_day_closures
  alter column amazon_open_remittance_expected set default 0;

alter table public.cod_day_closures
  alter column amazon_open_remittance_count set default 0;

alter table public.cod_day_closures
  alter column collected_cod set default 0;

alter table public.cod_day_closures
  alter column difference_amount set default 0;

alter table public.cod_day_closures
  alter column driver_reconciliation_pending set default 0;

alter table public.cod_day_closures
  alter column no_deposit_liability set default false;

alter table public.cod_day_closures
  alter column validation_snapshot set default '{}'::jsonb;

alter table public.cod_day_closures
  alter column is_final_submitted set default false;

commit;
