begin;

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

insert into public.app_pages (company_id, code, name, sort_order, is_active, created_at, updated_at)
select companies.id, page_seed.code, page_seed.name, page_seed.sort_order, true, now(), now()
from public.companies
cross join (values
  ('workforce_activity', 'Attendance & Activity', 190),
  ('workforce_rate_cards', 'Workforce Rate Cards', 191),
  ('workforce_earnings', 'Live Workforce Earnings', 192),
  ('workforce_incentives', 'Workforce Incentives', 193),
  ('workforce_adjustments', 'Workforce Adjustments', 194),
  ('workforce_payroll', 'Workforce Payroll', 195)
) as page_seed(code, name, sort_order)
on conflict (company_id, code) do update set
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();

-- Activity inherits the existing Workforce register scope. Financial workspaces
-- inherit ID & Rate Mapping access; final payroll approval is still owner-gated
-- by the application and every mutation remains company/location scoped.
insert into public.role_page_permissions (
  company_id, role_id, page_id, can_view, can_add, can_edit, created_at, updated_at
)
select source.company_id, source.role_id, target.id,
       source.can_view, source.can_add, source.can_edit, now(), now()
from public.role_page_permissions source
join public.app_pages source_page
  on source_page.id = source.page_id
 and source_page.company_id = source.company_id
 and source_page.code = 'delivery_associates'
join public.app_pages target
  on target.company_id = source.company_id
 and target.code = 'workforce_activity'
on conflict (company_id, role_id, page_id) do update set
  can_view = excluded.can_view,
  can_add = excluded.can_add,
  can_edit = excluded.can_edit,
  updated_at = now();

insert into public.role_page_permissions (
  company_id, role_id, page_id, can_view, can_add, can_edit, created_at, updated_at
)
select source.company_id, source.role_id, target.id,
       source.can_view, source.can_add, source.can_edit, now(), now()
from public.role_page_permissions source
join public.app_pages source_page
  on source_page.id = source.page_id
 and source_page.company_id = source.company_id
 and source_page.code = 'provider_mapping'
join public.app_pages target
  on target.company_id = source.company_id
 and target.code in (
   'workforce_rate_cards', 'workforce_earnings', 'workforce_incentives',
   'workforce_adjustments', 'workforce_payroll'
 )
on conflict (company_id, role_id, page_id) do update set
  can_view = excluded.can_view,
  can_add = excluded.can_add,
  can_edit = excluded.can_edit,
  updated_at = now();

create table if not exists public.workforce_rate_cards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  provider_id uuid not null references public.providers(id) on delete restrict,
  station_id uuid references public.stations(id) on delete restrict,
  designation_id uuid references public.designations(id) on delete restrict,
  pay_type text not null,
  effective_from date not null,
  effective_to date,
  delivery_rate numeric(14, 4) not null default 0,
  return_rate numeric(14, 4) not null default 0,
  mfn_rate numeric(14, 4) not null default 0,
  mfn_return_rate numeric(14, 4) not null default 0,
  fuel_rate numeric(14, 4) not null default 0,
  fixed_amount numeric(14, 2) not null default 0,
  guarantee_amount numeric(14, 2) not null default 0,
  status text not null default 'draft',
  notes text,
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workforce_rate_cards_pay_type_check check (
    pay_type in ('per_shipment', 'per_activity', 'fixed_daily', 'fixed_monthly', 'hybrid')
  ),
  constraint workforce_rate_cards_status_check check (status in ('draft', 'active', 'paused', 'closed')),
  constraint workforce_rate_cards_date_check check (effective_to is null or effective_to >= effective_from),
  constraint workforce_rate_cards_amount_check check (
    delivery_rate >= 0 and return_rate >= 0 and mfn_rate >= 0 and mfn_return_rate >= 0
    and fuel_rate >= 0 and fixed_amount >= 0 and guarantee_amount >= 0
  ),
  constraint workforce_rate_cards_required_amount_check check (
    (pay_type in ('fixed_daily', 'fixed_monthly') and fixed_amount > 0)
    or (pay_type in ('per_shipment', 'per_activity', 'hybrid') and delivery_rate > 0)
  )
);

create index if not exists workforce_rate_cards_scope_date_idx
  on public.workforce_rate_cards (company_id, provider_id, station_id, designation_id, effective_from desc);
create index if not exists workforce_rate_cards_provider_idx
  on public.workforce_rate_cards (provider_id);
create index if not exists workforce_rate_cards_station_idx
  on public.workforce_rate_cards (station_id) where station_id is not null;
create index if not exists workforce_rate_cards_designation_idx
  on public.workforce_rate_cards (designation_id) where designation_id is not null;
create index if not exists workforce_rate_cards_created_by_idx
  on public.workforce_rate_cards (created_by) where created_by is not null;
create index if not exists workforce_rate_cards_approved_by_idx
  on public.workforce_rate_cards (approved_by) where approved_by is not null;

alter table public.workforce_rate_cards
  add constraint workforce_rate_cards_active_scope_period_excl
  exclude using gist (
    company_id with =,
    provider_id with =,
    (coalesce(station_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    (coalesce(designation_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
  ) where (status = 'active');

create table if not exists public.workforce_incentive_campaigns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  provider_id uuid references public.providers(id) on delete restrict,
  station_id uuid references public.stations(id) on delete restrict,
  designation_id uuid references public.designations(id) on delete restrict,
  metric text not null,
  calculation_type text not null,
  threshold_value numeric(14, 4) not null default 0,
  rate_value numeric(14, 4) not null default 0,
  flat_amount numeric(14, 2) not null default 0,
  maximum_amount numeric(14, 2),
  effective_from date not null,
  effective_to date not null,
  status text not null default 'draft',
  description text,
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workforce_incentive_campaigns_company_code_unique unique (company_id, code),
  constraint workforce_incentive_metric_check check (
    metric in ('total_delivery', 'total_activity', 'amazon_delivery', 'swa_delivery', 'c_return', 'mfn')
  ),
  constraint workforce_incentive_calculation_check check (
    calculation_type in ('per_unit_above_threshold', 'flat_threshold')
  ),
  constraint workforce_incentive_status_check check (status in ('draft', 'active', 'paused', 'closed')),
  constraint workforce_incentive_date_check check (effective_to >= effective_from),
  constraint workforce_incentive_amount_check check (
    threshold_value >= 0 and rate_value >= 0 and flat_amount >= 0
    and (maximum_amount is null or maximum_amount >= 0)
  ),
  constraint workforce_incentive_reward_check check (
    (calculation_type = 'flat_threshold' and flat_amount > 0)
    or (calculation_type = 'per_unit_above_threshold' and rate_value > 0)
  )
);

create index if not exists workforce_incentive_campaigns_scope_date_idx
  on public.workforce_incentive_campaigns (company_id, status, effective_from, effective_to);
create index if not exists workforce_incentive_campaigns_provider_idx
  on public.workforce_incentive_campaigns (provider_id) where provider_id is not null;
create index if not exists workforce_incentive_campaigns_station_idx
  on public.workforce_incentive_campaigns (station_id) where station_id is not null;
create index if not exists workforce_incentive_campaigns_designation_idx
  on public.workforce_incentive_campaigns (designation_id) where designation_id is not null;
create index if not exists workforce_incentive_campaigns_created_by_idx
  on public.workforce_incentive_campaigns (created_by) where created_by is not null;
create index if not exists workforce_incentive_campaigns_approved_by_idx
  on public.workforce_incentive_campaigns (approved_by) where approved_by is not null;

create table if not exists public.workforce_adjustments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  workforce_id uuid not null references public.workforce(id) on delete restrict,
  adjustment_type text not null,
  category text not null,
  amount numeric(14, 2) not null,
  effective_date date not null,
  reason text not null,
  external_reference text,
  status text not null default 'pending',
  requested_by uuid references auth.users(id),
  requested_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_remarks text,
  payroll_run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workforce_adjustments_type_check check (adjustment_type in ('earning', 'deduction')),
  constraint workforce_adjustments_category_check check (
    category in ('id_exception', 'delivery_correction', 'joining_bonus', 'referral_bonus', 'reimbursement', 'asset_recovery', 'cash_recovery', 'other')
  ),
  constraint workforce_adjustments_amount_check check (amount > 0),
  constraint workforce_adjustments_reason_check check (length(btrim(reason)) between 1 and 2000),
  constraint workforce_adjustments_reference_check check (external_reference is null or length(external_reference) <= 250),
  constraint workforce_adjustments_maker_checker_check check (reviewed_by is null or requested_by is null or reviewed_by <> requested_by),
  constraint workforce_adjustments_status_check check (
    status in ('draft', 'pending', 'approved', 'rejected', 'posted', 'cancelled')
  ),
  constraint workforce_adjustments_review_state_check check (
    (status in ('approved', 'rejected', 'posted') and reviewed_by is not null and reviewed_at is not null)
    or (status not in ('approved', 'rejected', 'posted') and reviewed_by is null and reviewed_at is null)
  ),
  constraint workforce_adjustments_posting_check check (
    status <> 'posted' or payroll_run_id is not null
  )
);

create index if not exists workforce_adjustments_company_date_status_idx
  on public.workforce_adjustments (company_id, effective_date desc, status);
create index if not exists workforce_adjustments_workforce_idx
  on public.workforce_adjustments (workforce_id, effective_date desc);
create index if not exists workforce_adjustments_payroll_run_idx
  on public.workforce_adjustments (payroll_run_id) where payroll_run_id is not null;
create index if not exists workforce_adjustments_requested_by_idx
  on public.workforce_adjustments (requested_by) where requested_by is not null;
create index if not exists workforce_adjustments_reviewed_by_idx
  on public.workforce_adjustments (reviewed_by) where reviewed_by is not null;

create table if not exists public.workforce_payroll_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  run_number text not null,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft',
  worker_count integer not null default 0,
  shipment_count numeric(16, 2) not null default 0,
  base_amount numeric(16, 2) not null default 0,
  incentive_amount numeric(16, 2) not null default 0,
  adjustment_amount numeric(16, 2) not null default 0,
  deduction_amount numeric(16, 2) not null default 0,
  net_amount numeric(16, 2) not null default 0,
  ready_count integer not null default 0,
  hold_count integer not null default 0,
  exception_count integer not null default 0,
  source_updated_at timestamptz,
  calculated_at timestamptz,
  submitted_by uuid references auth.users(id),
  submitted_at timestamptz,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  paid_by uuid references auth.users(id),
  paid_at timestamptz,
  approval_remarks text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workforce_payroll_runs_company_number_unique unique (company_id, run_number),
  constraint workforce_payroll_runs_period_check check (period_end between period_start and period_start + 92),
  constraint workforce_payroll_runs_totals_check check (
    worker_count >= 0 and shipment_count >= 0 and base_amount >= 0 and incentive_amount >= 0
    and adjustment_amount >= 0 and deduction_amount >= 0 and net_amount >= 0
    and ready_count >= 0 and hold_count >= 0 and exception_count >= 0
    and ready_count + hold_count <= worker_count
  ),
  constraint workforce_payroll_runs_maker_checker_check check (
    submitted_by is null or approved_by is null or submitted_by <> approved_by
  ),
  constraint workforce_payroll_runs_review_state_check check (
    status not in ('review', 'approved', 'paid') or (submitted_by is not null and submitted_at is not null)
  ),
  constraint workforce_payroll_runs_approval_state_check check (
    status not in ('approved', 'paid') or (approved_by is not null and approved_at is not null)
  ),
  constraint workforce_payroll_runs_paid_state_check check (
    status <> 'paid' or (paid_by is not null and paid_at is not null)
  ),
  constraint workforce_payroll_runs_status_check check (
    status in ('draft', 'review', 'approved', 'paid', 'cancelled')
  ),
  constraint workforce_payroll_runs_company_period_excl exclude using gist (
    company_id with =,
    daterange(period_start, period_end, '[]') with &&
  ) where (status <> 'cancelled')
);

create index if not exists workforce_payroll_runs_company_created_idx
  on public.workforce_payroll_runs (company_id, created_at desc);
create index if not exists workforce_payroll_runs_submitted_by_idx
  on public.workforce_payroll_runs (submitted_by) where submitted_by is not null;
create index if not exists workforce_payroll_runs_approved_by_idx
  on public.workforce_payroll_runs (approved_by) where approved_by is not null;
create index if not exists workforce_payroll_runs_paid_by_idx
  on public.workforce_payroll_runs (paid_by) where paid_by is not null;
create index if not exists workforce_payroll_runs_created_by_idx
  on public.workforce_payroll_runs (created_by) where created_by is not null;

alter table public.workforce_adjustments
  drop constraint if exists workforce_adjustments_payroll_run_fkey;

alter table public.workforce_adjustments
  add constraint workforce_adjustments_payroll_run_fkey
  foreign key (payroll_run_id) references public.workforce_payroll_runs(id) on delete set null;

create table if not exists public.workforce_payroll_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  payroll_run_id uuid not null references public.workforce_payroll_runs(id) on delete cascade,
  workforce_id uuid not null references public.workforce(id) on delete restrict,
  dropx_id text not null,
  worker_name text not null,
  station_code text,
  bank_account_no text,
  ifsc_code text,
  shipment_count numeric(14, 2) not null default 0,
  activity_count numeric(14, 2) not null default 0,
  work_days integer not null default 0,
  base_amount numeric(14, 2) not null default 0,
  incentive_amount numeric(14, 2) not null default 0,
  adjustment_amount numeric(14, 2) not null default 0,
  deduction_amount numeric(14, 2) not null default 0,
  gross_amount numeric(14, 2) not null default 0,
  net_amount numeric(14, 2) not null default 0,
  status text not null default 'ready',
  hold_reasons jsonb not null default '[]'::jsonb,
  provider_member_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workforce_payroll_items_run_worker_unique unique (payroll_run_id, workforce_id),
  constraint workforce_payroll_items_status_check check (status in ('ready', 'hold', 'excluded', 'paid')),
  constraint workforce_payroll_items_totals_check check (
    shipment_count >= 0 and activity_count >= 0 and work_days >= 0 and base_amount >= 0
    and incentive_amount >= 0 and adjustment_amount >= 0 and deduction_amount >= 0 and gross_amount >= 0
  ),
  constraint workforce_payroll_items_json_check check (
    jsonb_typeof(hold_reasons) = 'array' and jsonb_typeof(provider_member_ids) = 'array'
  )
);

create index if not exists workforce_payroll_items_company_run_status_idx
  on public.workforce_payroll_items (company_id, payroll_run_id, status);
create index if not exists workforce_payroll_items_workforce_idx
  on public.workforce_payroll_items (workforce_id, payroll_run_id);

create table if not exists public.workforce_payroll_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  payroll_run_id uuid not null references public.workforce_payroll_runs(id) on delete cascade,
  payroll_item_id uuid not null references public.workforce_payroll_items(id) on delete cascade,
  workforce_id uuid not null references public.workforce(id) on delete restrict,
  source_type text not null,
  source_id uuid not null,
  work_date date not null,
  provider_name text,
  provider_member_id text,
  shipment_count numeric(14, 2) not null default 0,
  activity_count numeric(14, 2) not null default 0,
  base_amount numeric(14, 2) not null default 0,
  incentive_amount numeric(14, 2) not null default 0,
  adjustment_amount numeric(14, 2) not null default 0,
  net_amount numeric(14, 2) not null default 0,
  calculation_source text not null,
  calculation_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint workforce_payroll_lines_source_check check (source_type in ('shipment', 'adjustment')),
  constraint workforce_payroll_lines_counts_check check (
    shipment_count >= 0 and activity_count >= 0 and base_amount >= 0 and incentive_amount >= 0
  ),
  constraint workforce_payroll_lines_calculation_source_check check (
    calculation_source in ('rate_card', 'mapped_rate', 'imported_payout', 'adjustment', 'unresolved')
  )
);

create unique index if not exists workforce_payroll_lines_run_source_uidx
  on public.workforce_payroll_lines (payroll_run_id, source_type, source_id);
create index if not exists workforce_payroll_lines_item_date_idx
  on public.workforce_payroll_lines (payroll_item_id, work_date);
create index if not exists workforce_payroll_lines_workforce_idx
  on public.workforce_payroll_lines (workforce_id, work_date desc);
create index if not exists workforce_payroll_lines_company_idx
  on public.workforce_payroll_lines (company_id);

create table if not exists public.workforce_payroll_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  payroll_run_id uuid not null references public.workforce_payroll_runs(id) on delete cascade,
  event_code text not null,
  from_status text,
  to_status text,
  actor_user_id uuid references auth.users(id),
  remarks text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists workforce_payroll_events_run_created_idx
  on public.workforce_payroll_events (payroll_run_id, created_at desc);
create index if not exists workforce_payroll_events_company_idx
  on public.workforce_payroll_events (company_id);
create index if not exists workforce_payroll_events_actor_idx
  on public.workforce_payroll_events (actor_user_id) where actor_user_id is not null;

alter table public.workforce_rate_cards enable row level security;
alter table public.workforce_incentive_campaigns enable row level security;
alter table public.workforce_adjustments enable row level security;
alter table public.workforce_payroll_runs enable row level security;
alter table public.workforce_payroll_items enable row level security;
alter table public.workforce_payroll_lines enable row level security;
alter table public.workforce_payroll_events enable row level security;

revoke all on table public.workforce_rate_cards from anon, authenticated;
revoke all on table public.workforce_incentive_campaigns from anon, authenticated;
revoke all on table public.workforce_adjustments from anon, authenticated;
revoke all on table public.workforce_payroll_runs from anon, authenticated;
revoke all on table public.workforce_payroll_items from anon, authenticated;
revoke all on table public.workforce_payroll_lines from anon, authenticated;
revoke all on table public.workforce_payroll_events from anon, authenticated;

grant select, insert, update, delete on table public.workforce_rate_cards to service_role;
grant select, insert, update, delete on table public.workforce_incentive_campaigns to service_role;
grant select, insert, update, delete on table public.workforce_adjustments to service_role;
grant select, insert, update, delete on table public.workforce_payroll_runs to service_role;
grant select, insert, update, delete on table public.workforce_payroll_items to service_role;
grant select, insert, update, delete on table public.workforce_payroll_lines to service_role;
grant select, insert, update, delete on table public.workforce_payroll_events to service_role;

comment on table public.workforce_rate_cards is
  'Approved, date-effective Workforce commercial rules that supersede imported or legacy mapped payout values for their exact scope.';
comment on table public.workforce_incentive_campaigns is
  'Time-bound shipment incentives evaluated from the same daily production facts as base earnings.';
comment on table public.workforce_adjustments is
  'Audited ad hoc earning and deduction requests for exception payments and recoveries.';
comment on table public.workforce_payroll_runs is
  'Controlled payroll close header. Approval freezes calculated item and line snapshots.';
comment on table public.workforce_payroll_items is
  'Per-Workforce payout snapshot for a payroll run, including holds and approved adjustments.';
comment on table public.workforce_payroll_lines is
  'Immutable-at-approval calculation trace back to shipment and adjustment source rows.';

notify pgrst, 'reload schema';

commit;
