-- Canonical Workforce lifecycle: request -> candidate submission -> HO approval -> activation -> exit/settlement.
-- Workforce-only by design. HR employees and HR candidate tables are not read or changed here.

begin;

create extension if not exists pgcrypto;

alter table public.field_executives
  add column if not exists approval_required boolean not null default true,
  add column if not exists onboarding_application_source text,
  add column if not exists recruitment_lead_id uuid references public.recruitment_leads(id) on delete set null,
  add column if not exists onboarding_submitted_at timestamptz,
  add column if not exists onboarding_reviewed_at timestamptz,
  add column if not exists onboarding_reviewed_by uuid references auth.users(id),
  add column if not exists onboarding_review_remarks text,
  add column if not exists onboarding_approved_at timestamptz,
  add column if not exists onboarding_approved_by uuid references auth.users(id),
  add column if not exists onboarding_activated_at timestamptz,
  add column if not exists provider_id_status text not null default 'pending',
  add column if not exists provider_employee_id text,
  add column if not exists lifecycle_status text not null default 'onboarding',
  add column if not exists last_working_date date,
  add column if not exists deactivated_at timestamptz,
  add column if not exists deactivated_by uuid references auth.users(id);

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='field_executives' and column_name='onboarding_approval_required') then
    execute 'update public.field_executives set approval_required = coalesce(onboarding_approval_required, approval_required)';
  end if;
end $$;

update public.field_executives
set approval_required = false,
    onboarding_application_source = coalesce(onboarding_application_source, 'legacy'),
    onboarding_approved_at = coalesce(onboarding_approved_at, case when onboarding_status = 'active' then created_at end),
    onboarding_activated_at = coalesce(onboarding_activated_at, case when onboarding_status = 'active' then created_at end),
    lifecycle_status = case when onboarding_status = 'active' and is_active then 'active' else lifecycle_status end,
    provider_id_status = case when onboarding_status = 'active' then coalesce(nullif(provider_id_status, 'pending'), 'not_required') else provider_id_status end
where onboarding_application_source is null;

alter table public.field_executives
  alter column onboarding_application_source set default 'dashboard';

alter table public.field_executives
  drop constraint if exists field_executives_onboarding_status_check;
alter table public.field_executives
  add constraint field_executives_onboarding_status_check
  check (onboarding_status in ('pending','submitted','under_review','returned','approved','active','rejected','cancelled'));

alter table public.field_executives
  drop constraint if exists field_executives_provider_id_status_check;
alter table public.field_executives
  add constraint field_executives_provider_id_status_check
  check (provider_id_status in ('not_started','pending','in_progress','created','blocked','failed','not_required'));

alter table public.field_executives
  drop constraint if exists field_executives_lifecycle_status_check;
alter table public.field_executives
  add constraint field_executives_lifecycle_status_check
  check (lifecycle_status in ('onboarding','active','resignation_pending','termination_pending','settlement_pending','exited'));

create index if not exists field_executives_onboarding_queue_idx
  on public.field_executives(company_id, onboarding_status, location_id, updated_at desc);
create index if not exists field_executives_lifecycle_queue_idx
  on public.field_executives(company_id, lifecycle_status, location_id, updated_at desc);

create table if not exists public.workforce_agreement_master (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  title text not null,
  version integer not null default 1 check (version > 0),
  agreement_body text not null,
  applicable_designation_codes text[] not null default '{}',
  is_active boolean not null default true,
  effective_from date not null default current_date,
  effective_to date,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, code, version)
);

create table if not exists public.workforce_agreement_acceptances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  field_executive_id uuid not null references public.field_executives(id) on delete cascade,
  agreement_id uuid not null references public.workforce_agreement_master(id),
  agreement_version integer not null,
  content_hash text not null,
  accepted_at timestamptz not null default now(),
  accepted_ip text,
  accepted_user_agent text,
  unique(field_executive_id, agreement_id, agreement_version)
);

create table if not exists public.workforce_onboarding_checklist_master (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  label text not null,
  description text,
  applicable_designation_codes text[] not null default '{}',
  is_required boolean not null default true,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, code)
);

alter table public.workforce_onboarding_checklist_master
  add column if not exists applicable_designation_codes text[] not null default '{}';

create table if not exists public.workforce_onboarding_checklist_results (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  field_executive_id uuid not null references public.field_executives(id) on delete cascade,
  checklist_item_id uuid not null references public.workforce_onboarding_checklist_master(id),
  status text not null default 'pending' check (status in ('pending','completed','not_required','failed')),
  remarks text,
  completed_by uuid references auth.users(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(field_executive_id, checklist_item_id)
);

alter table public.workforce_onboarding_checklist_results
  add column if not exists checklist_item_id uuid references public.workforce_onboarding_checklist_master(id),
  add column if not exists created_at timestamptz not null default now();
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='workforce_onboarding_checklist_results' and column_name='checklist_id') then
    execute 'update public.workforce_onboarding_checklist_results set checklist_item_id = checklist_id where checklist_item_id is null';
    execute 'alter table public.workforce_onboarding_checklist_results alter column checklist_id drop not null';
  end if;
end $$;
alter table public.workforce_onboarding_checklist_results alter column checklist_item_id set not null;
alter table public.workforce_onboarding_checklist_results drop constraint if exists workforce_onboarding_checklist_results_status_check;
alter table public.workforce_onboarding_checklist_results add constraint workforce_onboarding_checklist_results_status_check
  check (status in ('pending','completed','not_required','not_applicable','failed'));
create unique index if not exists workforce_onboarding_checklist_result_item_unique
  on public.workforce_onboarding_checklist_results(field_executive_id, checklist_item_id);

create table if not exists public.workforce_onboarding_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  field_executive_id uuid not null references public.field_executives(id) on delete cascade,
  event_code text not null,
  from_status text,
  to_status text,
  actor_user_id uuid references auth.users(id),
  source_portal text not null default 'dashboard',
  remarks text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.workforce_onboarding_events
  add column if not exists event_code text,
  add column if not exists actor_user_id uuid references auth.users(id),
  add column if not exists source_portal text not null default 'dashboard';
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='workforce_onboarding_events' and column_name='event_type') then
    execute 'update public.workforce_onboarding_events set event_code = event_type where event_code is null';
    execute 'alter table public.workforce_onboarding_events alter column event_type drop not null';
  end if;
end $$;
update public.workforce_onboarding_events set event_code = 'legacy_event' where event_code is null;
alter table public.workforce_onboarding_events alter column event_code set not null;

create index if not exists workforce_onboarding_events_profile_idx
  on public.workforce_onboarding_events(company_id, field_executive_id, created_at desc);

create table if not exists public.workforce_lifecycle_cases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  field_executive_id uuid not null references public.field_executives(id) on delete restrict,
  case_type text not null check (case_type in ('resignation','termination')),
  status text not null default 'submitted' check (status in ('submitted','under_review','approved','rejected','settlement_pending','settled','cancelled')),
  requested_effective_date date not null,
  approved_effective_date date,
  reason_code text not null,
  reason_details text,
  initiated_by uuid references auth.users(id),
  initiated_source text not null default 'dashboard',
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_remarks text,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists workforce_lifecycle_open_case_unique
  on public.workforce_lifecycle_cases(field_executive_id)
  where status in ('submitted','under_review','approved','settlement_pending');
create index if not exists workforce_lifecycle_cases_queue_idx
  on public.workforce_lifecycle_cases(company_id, status, created_at desc);

create table if not exists public.workforce_exit_checklist_master (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  label text not null,
  description text,
  is_required boolean not null default true,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  unique(company_id, code)
);

create table if not exists public.workforce_exit_checklist_results (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  lifecycle_case_id uuid not null references public.workforce_lifecycle_cases(id) on delete cascade,
  checklist_item_id uuid not null references public.workforce_exit_checklist_master(id),
  status text not null default 'pending' check (status in ('pending','completed','not_required','failed')),
  remarks text,
  completed_by uuid references auth.users(id),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(lifecycle_case_id, checklist_item_id)
);

create table if not exists public.workforce_final_settlements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  lifecycle_case_id uuid not null unique references public.workforce_lifecycle_cases(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','pending','approved','paid','waived','failed')),
  gross_amount numeric(12,2) not null default 0,
  deduction_amount numeric(12,2) not null default 0,
  net_amount numeric(12,2) generated always as (gross_amount - deduction_amount) stored,
  calculation_details jsonb not null default '{}'::jsonb,
  payment_reference text,
  payment_date date,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  paid_by uuid references auth.users(id),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workforce_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  lifecycle_case_id uuid not null references public.workforce_lifecycle_cases(id) on delete cascade,
  field_executive_id uuid not null references public.field_executives(id) on delete restrict,
  event_code text not null,
  from_status text,
  to_status text,
  actor_user_id uuid references auth.users(id),
  source_portal text not null default 'dashboard',
  remarks text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists workforce_lifecycle_events_case_idx
  on public.workforce_lifecycle_events(company_id, lifecycle_case_id, created_at desc);

insert into public.workforce_agreement_master(company_id, code, title, version, agreement_body, applicable_designation_codes)
select id, 'DA_SERVICE_AGREEMENT', 'Delivery Associate Service Agreement', 1,
  'I confirm that the information and documents submitted by me are correct. I understand that activation is subject to DropX verification, the applicable client or provider ID process, attendance rules, safety requirements, code of conduct, asset and cash-handling policies, and the commercial terms communicated for my location. I consent to verification of my identity, bank, licence and work records for onboarding and operational compliance.',
  array['DA','DCD','ODCD','PTDA']::text[]
from public.companies
on conflict(company_id, code, version) do nothing;

insert into public.workforce_onboarding_checklist_master(company_id, code, label, description, applicable_designation_codes, sort_order)
select companies.id, seed.code, seed.label, seed.description, seed.designations, seed.sort_order
from public.companies
cross join (values
  ('profile_verified','Profile and documents verified','Confirm identity, address, bank and required documents.',array[]::text[],10),
  ('agreement_accepted','DA agreement accepted','Confirm the current mandatory agreement was accepted by the applicant.',array['DA','DCD','ODCD','PTDA']::text[],20),
  ('provider_id_created','Amazon / provider ID created','Record the provider ID or explicitly mark not required.',array['DA','DCD','ODCD','PTDA']::text[],30),
  ('biometric_ready','Biometric enrolment prepared','Confirm the reserved biometric enrolment is ready for activation.',array[]::text[],40)
) as seed(code,label,description,designations,sort_order)
on conflict(company_id, code) do nothing;

insert into public.workforce_exit_checklist_master(company_id, code, label, description, sort_order)
select companies.id, seed.code, seed.label, seed.description, seed.sort_order
from public.companies
cross join (values
  ('attendance_locked','Attendance and last working day confirmed','Confirm final attendance and last working date.',10),
  ('assets_returned','Assets and cash cleared','Confirm all company/provider assets, COD and advances are cleared.',20),
  ('expenses_closed','Expenses and recoveries closed','Confirm approved reimbursements and recoveries are accounted for.',30),
  ('access_deactivated','System and provider access deactivated','Confirm DropX, biometric and provider access are closed.',40),
  ('settlement_completed','Final settlement completed','Record paid, waived or approved settlement outcome.',50)
) as seed(code,label,description,sort_order)
on conflict(company_id, code) do nothing;

create or replace function public.workforce_designation_code(p_company_id uuid, p_designation text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select upper(coalesce(d.code, ''))
  from public.designations d
  where d.company_id = p_company_id
    and lower(d.name) = lower(coalesce(p_designation, ''))
  limit 1
$$;

create or replace function public.enforce_workforce_activation_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if new.onboarding_status = 'active'
     and old.onboarding_status is distinct from 'active'
     and coalesce(new.approval_required, true) then
    v_code := public.workforce_designation_code(new.company_id, new.designation);
    if new.onboarding_approved_at is null or new.onboarding_approved_by is null then
      raise exception 'HO approval is required before workforce activation.';
    end if;
    if exists (
      select 1
      from public.workforce_agreement_master a
      where a.company_id = new.company_id
        and a.is_active
        and current_date between a.effective_from and coalesce(a.effective_to, 'infinity'::date)
        and (cardinality(a.applicable_designation_codes) = 0 or v_code = any(a.applicable_designation_codes))
        and not exists (
          select 1 from public.workforce_agreement_acceptances x
          where x.field_executive_id = new.id
            and x.agreement_id = a.id
            and x.agreement_version = a.version
        )
    ) then
      raise exception 'The required workforce agreement has not been accepted.';
    end if;
    if exists (
      select 1
      from public.workforce_onboarding_checklist_master m
      where m.company_id = new.company_id
        and m.is_active and m.is_required
        and (cardinality(m.applicable_designation_codes) = 0 or v_code = any(m.applicable_designation_codes))
        and not exists (
          select 1 from public.workforce_onboarding_checklist_results r
          where r.field_executive_id = new.id
            and r.checklist_item_id = m.id
            and r.status in ('completed','not_required')
        )
    ) then
      raise exception 'Complete every required onboarding checklist item before activation.';
    end if;
    new.onboarding_activated_at := coalesce(new.onboarding_activated_at, now());
    new.lifecycle_status := 'active';
  end if;
  return new;
end;
$$;

drop trigger if exists field_executives_activation_gate on public.field_executives;
create trigger field_executives_activation_gate
before update of onboarding_status on public.field_executives
for each row execute function public.enforce_workforce_activation_gate();

alter table public.workforce_agreement_master enable row level security;
alter table public.workforce_agreement_acceptances enable row level security;
alter table public.workforce_onboarding_checklist_master enable row level security;
alter table public.workforce_onboarding_checklist_results enable row level security;
alter table public.workforce_onboarding_events enable row level security;
alter table public.workforce_lifecycle_cases enable row level security;
alter table public.workforce_exit_checklist_master enable row level security;
alter table public.workforce_exit_checklist_results enable row level security;
alter table public.workforce_final_settlements enable row level security;
alter table public.workforce_lifecycle_events enable row level security;

revoke all on public.workforce_agreement_master from anon, authenticated;
revoke all on public.workforce_agreement_acceptances from anon, authenticated;
revoke all on public.workforce_onboarding_checklist_master from anon, authenticated;
revoke all on public.workforce_onboarding_checklist_results from anon, authenticated;
revoke all on public.workforce_onboarding_events from anon, authenticated;
revoke all on public.workforce_lifecycle_cases from anon, authenticated;
revoke all on public.workforce_exit_checklist_master from anon, authenticated;
revoke all on public.workforce_exit_checklist_results from anon, authenticated;
revoke all on public.workforce_final_settlements from anon, authenticated;
revoke all on public.workforce_lifecycle_events from anon, authenticated;

commit;

notify pgrst, 'reload schema';
