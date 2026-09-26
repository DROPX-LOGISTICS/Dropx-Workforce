begin;

alter table public.designations
  add column if not exists dropx_one_activation_gate boolean not null default false;

comment on column public.designations.dropx_one_activation_gate is
  'When true, a Workforce associate sees only Amazon activation status in DropX One until the provider ID is active.';

update public.designations designation
set dropx_one_activation_gate = true,
    updated_at = now()
from public.designation_categories category
where designation.designation_category_id = category.id
  and category.people_module = 'delivery_network'
  and upper(designation.code) in ('DA', 'DCD', 'ODCD')
  and designation.dropx_one_activation_gate = false;

alter table public.workforce_joining_plans
  add column if not exists provider_candidate_reference text,
  add column if not exists provider_candidate_first_seen date,
  add column if not exists provider_candidate_detected_at timestamptz,
  add column if not exists provider_candidate_status text,
  add column if not exists provider_candidate_evidence jsonb not null default '{}'::jsonb;

alter table public.workforce_joining_plans
  drop constraint if exists workforce_joining_provider_candidate_status_check;
alter table public.workforce_joining_plans
  add constraint workforce_joining_provider_candidate_status_check
  check (provider_candidate_status is null or provider_candidate_status in ('pending','confirmed','dismissed'));

create table if not exists public.workforce_referral_programs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  station_id uuid references public.stations(id) on delete cascade,
  name text not null,
  reward_amount numeric(14, 2) not null,
  qualification_source text not null,
  qualifying_days integer not null,
  effective_from date not null,
  effective_to date,
  terms text not null,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workforce_referral_programs_name_check check (length(btrim(name)) between 1 and 120),
  constraint workforce_referral_programs_reward_check check (reward_amount > 0),
  constraint workforce_referral_programs_source_check check (qualification_source in ('calendar_days', 'biometric_present_days', 'amazon_delivery_days')),
  constraint workforce_referral_programs_days_check check (qualifying_days > 0 and qualifying_days <= 365),
  constraint workforce_referral_programs_dates_check check (effective_to is null or effective_to >= effective_from),
  constraint workforce_referral_programs_terms_check check (length(btrim(terms)) between 1 and 2000)
);

create unique index if not exists workforce_referral_programs_scope_active_idx
  on public.workforce_referral_programs (company_id, coalesce(station_id, '00000000-0000-0000-0000-000000000000'::uuid), effective_from)
  where is_active;

create table if not exists public.workforce_referrals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  program_id uuid not null references public.workforce_referral_programs(id) on delete restrict,
  referrer_workforce_id uuid not null references public.workforce(id) on delete restrict,
  referred_full_name text not null,
  referred_country_code text not null default '91',
  referred_mobile text not null,
  preferred_station_id uuid references public.stations(id) on delete set null,
  referred_workforce_id uuid references public.workforce(id) on delete set null,
  status text not null default 'submitted',
  qualification_progress integer not null default 0,
  reward_amount_snapshot numeric(14, 2) not null,
  qualification_source_snapshot text not null,
  qualifying_days_snapshot integer not null,
  terms_snapshot text not null,
  decision_remarks text,
  submitted_at timestamptz not null default now(),
  qualified_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  paid_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint workforce_referrals_name_check check (length(btrim(referred_full_name)) between 2 and 160),
  constraint workforce_referrals_country_check check (referred_country_code ~ '^[0-9]{1,4}$'),
  constraint workforce_referrals_mobile_check check (referred_mobile ~ '^[0-9]{6,15}$'),
  constraint workforce_referrals_status_check check (status in ('submitted', 'linked', 'qualified', 'approved', 'rejected', 'paid', 'cancelled')),
  constraint workforce_referrals_progress_check check (qualification_progress >= 0),
  constraint workforce_referrals_reward_check check (reward_amount_snapshot > 0),
  constraint workforce_referrals_source_check check (qualification_source_snapshot in ('calendar_days', 'biometric_present_days', 'amazon_delivery_days')),
  constraint workforce_referrals_days_check check (qualifying_days_snapshot > 0),
  constraint workforce_referrals_terms_check check (length(btrim(terms_snapshot)) between 1 and 2000)
);

create index if not exists workforce_referrals_referrer_idx
  on public.workforce_referrals (referrer_workforce_id, submitted_at desc);
create index if not exists workforce_referrals_company_status_idx
  on public.workforce_referrals (company_id, status, submitted_at desc);
create unique index if not exists workforce_referrals_open_mobile_idx
  on public.workforce_referrals (company_id, referred_country_code, referred_mobile)
  where status in ('submitted', 'linked', 'qualified', 'approved');
create unique index if not exists workforce_referral_reward_reference_idx
  on public.workforce_adjustments (company_id, external_reference)
  where external_reference like 'REFERRAL:%';

alter table public.workforce_referral_programs enable row level security;
alter table public.workforce_referrals enable row level security;

insert into public.app_pages (company_id, code, name, sort_order, is_active, created_at, updated_at)
select id, 'workforce_referrals', 'Workforce referrals', 196, true, now(), now()
from public.companies
on conflict (company_id, code) do update set
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_active = true,
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
 and source_page.code = 'delivery_associates'
join public.app_pages target
  on target.company_id = source.company_id
 and target.code = 'workforce_referrals'
on conflict (company_id, role_id, page_id) do update set
  can_view = excluded.can_view,
  can_add = excluded.can_add,
  can_edit = excluded.can_edit,
  updated_at = now();

-- The Daily Shipment Count does not contain the onboarding email. DA In-App
-- Onboarding contains that email as rabbit_id, while both reports contain the
-- Surface a review candidate only. Reports never activate an associate or write
-- the canonical Provider ID without a Workforce user's explicit confirmation.
-- Evidence chain: exact email -> latest completed onboarding row -> one unique
-- name/station shipment ID.
create or replace function public.workforce_reconcile_amazon_activations(p_company uuid)
returns integer language plpgsql security invoker set search_path='' as $$
declare matched record; changed integer:=0;
begin
  for matched in
    with latest_onboarding as (
      select distinct on (lower(btrim(coalesce(r.normalized_data->>'rabbit_id',r.raw_data->>'rabbit_id',''))))
        lower(btrim(coalesce(r.normalized_data->>'rabbit_id',r.raw_data->>'rabbit_id',''))) email,
        upper(btrim(coalesce(r.station_code,r.normalized_data->>'station_code',r.raw_data->>'station_code',''))) station_code,
        regexp_replace(lower(btrim(coalesce(r.normalized_data->>'employee_name',r.raw_data->>'employee_name',''))),'[^a-z0-9]','','g') person_key,
        lower(btrim(coalesce(r.normalized_data->>'action_item',r.raw_data->>'action_item',''))) action_item,
        r.created_at
      from public.report_import_rows r
      where r.company_id=p_company and r.source_type='da_inapp_onboarding'
        and coalesce(r.normalized_data->>'rabbit_id',r.raw_data->>'rabbit_id','')<>''
      order by lower(btrim(coalesce(r.normalized_data->>'rabbit_id',r.raw_data->>'rabbit_id',''))),r.created_at desc,r.id desc
    ), shipment_candidates as (
      select upper(btrim(s.station_code)) station_code,
        regexp_replace(lower(btrim(coalesce(s.provider_employee_name,''))),'[^a-z0-9]','','g') person_key,
        min(s.provider_employee_id) provider_member_id,min(s.work_date) first_seen,
        count(distinct s.provider_employee_id) candidate_count
      from public.cps_shipment_daily s
      where s.company_id=p_company and btrim(coalesce(s.provider_employee_id,''))<>''
      group by upper(btrim(s.station_code)),regexp_replace(lower(btrim(coalesce(s.provider_employee_name,''))),'[^a-z0-9]','','g')
    )
    select w.id workforce_id,ship.provider_member_id,ship.first_seen
    from public.workforce w
    join public.workforce_joining_plans plan on plan.company_id=w.company_id and plan.workforce_id=w.id and plan.closed_on is null
    join public.stations station on station.company_id=w.company_id and station.id=w.location_id
    join latest_onboarding onboard on onboard.email=lower(btrim(plan.contact_email))
      and onboard.station_code=upper(btrim(station.station_code))
      and onboard.person_key=regexp_replace(lower(btrim(w.full_name)),'[^a-z0-9]','','g')
    join shipment_candidates ship on ship.station_code=onboard.station_code and ship.person_key=onboard.person_key and ship.candidate_count=1
    where w.company_id=p_company and w.deleted_at is null and w.migration_state<>'reclassified'
      and onboard.action_item like '%no further action required%'
      and not exists(select 1 from public.workforce other where other.company_id=p_company and other.id<>w.id and other.provider_employee_id=ship.provider_member_id and other.deleted_at is null)
      and not exists(select 1 from public.field_executive_provider_mappings mapping where mapping.company_id=p_company and mapping.provider_member_id=ship.provider_member_id and mapping.status<>'cancelled' and mapping.workforce_id is distinct from w.id)
  loop
    update public.workforce_joining_plans
      set provider_candidate_reference=matched.provider_member_id,
          provider_candidate_first_seen=matched.first_seen,
          provider_candidate_detected_at=now(),
          provider_candidate_status='pending',
          provider_candidate_evidence=jsonb_build_object(
            'first_shipment_date',matched.first_seen,
            'match_rule','email_to_da_inapp_then_unique_station_name'
          ),
          version=version+1,
          updated_at=now()
      where company_id=p_company and workforce_id=matched.workforce_id
        and provider_stage<>'activated'
        and (provider_candidate_reference is distinct from matched.provider_member_id
          or provider_candidate_status is null);
    if found then
      insert into public.workforce_joining_events(company_id,workforce_id,event_code,actor_name,details)
      values(p_company,matched.workforce_id,'amazon_provider_candidate_found','Amazon report reconciliation',jsonb_build_object('provider_member_id',matched.provider_member_id,'first_shipment_date',matched.first_seen,'match_rule','email_to_da_inapp_then_unique_station_name','requires_confirmation',true));
      changed:=changed+1;
    end if;
  end loop;
  return changed;
end $$;

revoke all on function public.workforce_reconcile_amazon_activations(uuid) from public,anon,authenticated;
grant execute on function public.workforce_reconcile_amazon_activations(uuid) to service_role;

create or replace function public.workforce_review_amazon_provider_candidate(
  p_company uuid,p_actor uuid,p_actor_name text,p_workforce uuid,p_candidate text,
  p_decision text,p_remarks text,p_locations uuid[]
) returns void language plpgsql security invoker set search_path='' as $$
declare plan public.workforce_joining_plans; worker public.workforce; today date:=(now() at time zone 'Asia/Kolkata')::date;
begin
  if p_actor is null or p_decision not in ('confirm','dismiss') then raise exception 'A reviewer and valid decision are required'; end if;
  select * into worker from public.workforce where company_id=p_company and id=p_workforce and deleted_at is null and migration_state<>'reclassified' for update;
  select * into plan from public.workforce_joining_plans where company_id=p_company and workforce_id=p_workforce and closed_on is null for update;
  if worker.id is null or plan.workforce_id is null then raise exception 'The Workforce activation record was not found'; end if;
  if p_locations is not null and not(worker.location_id=any(p_locations)) then raise exception 'The associate is outside your station scope'; end if;
  if plan.provider_candidate_status<>'pending' or nullif(btrim(plan.provider_candidate_reference),'') is null
    or plan.provider_candidate_reference is distinct from nullif(btrim(p_candidate),'') then
    raise exception 'The Provider ID suggestion changed. Refresh before reviewing';
  end if;
  if p_decision='dismiss' then
    if length(btrim(coalesce(p_remarks,'')))<3 then raise exception 'Add a short reason for dismissing this suggestion'; end if;
    update public.workforce_joining_plans set provider_candidate_status='dismissed',version=version+1,updated_by=p_actor,updated_at=now()
      where company_id=p_company and workforce_id=p_workforce;
    insert into public.workforce_joining_events(company_id,workforce_id,event_code,actor_id,actor_name,details)
    values(p_company,p_workforce,'amazon_provider_candidate_dismissed',p_actor,coalesce(nullif(btrim(p_actor_name),''),'Workforce reviewer'),jsonb_build_object('provider_member_id',p_candidate,'remarks',btrim(p_remarks)));
    return;
  end if;
  if exists(select 1 from public.workforce other where other.company_id=p_company and other.id<>p_workforce and other.provider_employee_id=p_candidate and other.deleted_at is null) then raise exception 'This Provider ID is already assigned to another Workforce associate'; end if;
  if exists(select 1 from public.field_executive_provider_mappings mapping where mapping.company_id=p_company and mapping.provider_member_id=p_candidate and mapping.status<>'cancelled' and mapping.workforce_id is distinct from p_workforce) then raise exception 'This Provider ID is already mapped to another associate'; end if;
  update public.workforce_joining_plans
    set provider_stage='activated',provider_reference=p_candidate,provider_activated_on=today,next_follow_up_on=null,
        provider_candidate_status='confirmed',version=version+1,updated_by=p_actor,updated_at=now()
    where company_id=p_company and workforce_id=p_workforce;
  update public.workforce set provider_id_status='created',provider_employee_id=p_candidate,updated_at=now()
    where company_id=p_company and id=p_workforce;
  insert into public.workforce_joining_events(company_id,workforce_id,event_code,actor_id,actor_name,details)
  values(p_company,p_workforce,'amazon_provider_candidate_confirmed',p_actor,coalesce(nullif(btrim(p_actor_name),''),'Workforce reviewer'),jsonb_build_object('provider_member_id',p_candidate,'remarks',nullif(btrim(coalesce(p_remarks,'')),''),'evidence',plan.provider_candidate_evidence));
end $$;

revoke all on function public.workforce_review_amazon_provider_candidate(uuid,uuid,text,uuid,text,text,text,uuid[]) from public,anon,authenticated;
grant execute on function public.workforce_review_amazon_provider_candidate(uuid,uuid,text,uuid,text,text,text,uuid[]) to service_role;

commit;
