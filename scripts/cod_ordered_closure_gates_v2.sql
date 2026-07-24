alter table public.cod_day_closures
  add column if not exists driver_check_status text not null default 'Not run',
  add column if not exists driver_exception_reason text,
  add column if not exists driver_exception_requested_by uuid references auth.users(id) on delete set null,
  add column if not exists driver_exception_requested_at timestamptz,
  add column if not exists driver_exception_reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists driver_exception_reviewed_at timestamptz,
  add column if not exists driver_exception_manager_remarks text,
  add column if not exists deposit_check_status text not null default 'Locked',
  add column if not exists deposit_exception_reason text,
  add column if not exists deposit_exception_requested_by uuid references auth.users(id) on delete set null,
  add column if not exists deposit_exception_requested_at timestamptz,
  add column if not exists deposit_exception_reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists deposit_exception_reviewed_at timestamptz,
  add column if not exists deposit_exception_manager_remarks text,
  add column if not exists final_submitted_by uuid references auth.users(id) on delete set null,
  add column if not exists final_submitted_at timestamptz,
  add column if not exists is_final_submitted boolean not null default false;

alter table public.cod_day_closures
  drop constraint if exists cod_day_closures_driver_check_status_check;
alter table public.cod_day_closures
  add constraint cod_day_closures_driver_check_status_check
  check (driver_check_status in (
    'Not run', 'Queued', 'Running', 'Passed', 'Pending',
    'Exception requested', 'Exception approved', 'Exception rejected', 'Error'
  ));

alter table public.cod_day_closures
  drop constraint if exists cod_day_closures_deposit_check_status_check;
alter table public.cod_day_closures
  add constraint cod_day_closures_deposit_check_status_check
  check (deposit_check_status in (
    'Locked', 'Not run', 'Queued', 'Running', 'Passed', 'Pending',
    'Exception requested', 'Exception approved', 'Exception rejected', 'Error'
  ));

create index if not exists cod_day_closures_gate_status_idx
  on public.cod_day_closures(company_id, business_date desc, driver_check_status, deposit_check_status);

comment on column public.cod_day_closures.driver_check_status is
  'Ordered closure gate 1. Bank Deposit remains locked until this is Passed or Exception approved.';
comment on column public.cod_day_closures.deposit_check_status is
  'Ordered closure gate 2. Final submission requires Passed or Exception approved.';
comment on column public.cod_day_closures.is_final_submitted is
  'Locks COD reconciliation edits and deletes for this station/date after final submission.';
