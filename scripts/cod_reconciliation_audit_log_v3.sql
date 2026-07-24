create table if not exists public.cod_reconciliation_audit_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  business_date date not null,
  location_id uuid references public.stations(id) on delete set null,
  station_code text not null,
  reconciliation_id uuid,
  closure_id uuid references public.cod_day_closures(id) on delete set null,
  provider_employee_id text,
  associate_name text,
  action text not null,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  changed_fields jsonb not null default '[]'::jsonb,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_name text,
  actor_email text,
  actor_role text,
  created_at timestamptz not null default now()
);

create index if not exists cod_reconciliation_audit_company_date_idx
  on public.cod_reconciliation_audit_log(company_id, business_date desc, station_code, created_at desc);

create index if not exists cod_reconciliation_audit_location_idx
  on public.cod_reconciliation_audit_log(company_id, location_id, created_at desc);

alter table public.cod_reconciliation_audit_log enable row level security;

insert into public.cod_reconciliation_audit_log (
  company_id,
  business_date,
  location_id,
  station_code,
  reconciliation_id,
  provider_employee_id,
  associate_name,
  action,
  after_data,
  changed_fields,
  actor_name,
  actor_role
)
select
  reconciliation.company_id,
  reconciliation.business_date,
  reconciliation.location_id,
  reconciliation.station_code,
  reconciliation.id,
  reconciliation.provider_employee_id,
  coalesce(reconciliation.source_associate_name, reconciliation.manual_associate_name),
  'Baseline captured at audit activation',
  to_jsonb(reconciliation),
  '["baseline"]'::jsonb,
  'System',
  'System'
from public.cod_executive_reconciliations reconciliation
where not exists (
  select 1
  from public.cod_reconciliation_audit_log audit
  where audit.reconciliation_id = reconciliation.id
);

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'cod_reconciliation_audit_log'
      and policyname = 'cod_reconciliation_audit_service_role_all'
  ) then
    create policy cod_reconciliation_audit_service_role_all
      on public.cod_reconciliation_audit_log
      for all to service_role
      using (true)
      with check (true);
  end if;
end $$;

comment on table public.cod_reconciliation_audit_log is
  'Immutable server-written history for COD entry edits, deletes, validation gates, exceptions, approvals, and final submission.';
