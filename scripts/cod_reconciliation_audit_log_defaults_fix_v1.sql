-- Fix incomplete cod_reconciliation_audit_log schema on personal/dev DBs.

begin;

alter table public.cod_reconciliation_audit_log
  alter column id set default gen_random_uuid();

alter table public.cod_reconciliation_audit_log
  alter column created_at set default now();

alter table public.cod_reconciliation_audit_log
  alter column before_data set default '{}'::jsonb;

alter table public.cod_reconciliation_audit_log
  alter column after_data set default '{}'::jsonb;

alter table public.cod_reconciliation_audit_log
  alter column changed_fields set default '[]'::jsonb;

commit;
