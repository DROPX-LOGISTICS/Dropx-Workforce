begin;

-- Referral qualification is a company master. Programs select a source; the
-- evidence kind is the stable system contract used to count qualifying days.
create table if not exists public.workforce_referral_qualification_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  evidence_kind text not null,
  description text,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workforce_referral_sources_company_code_unique unique (company_id, code),
  constraint workforce_referral_sources_code_check check (code ~ '^[a-z][a-z0-9_]{1,49}$'),
  constraint workforce_referral_sources_name_check check (length(btrim(name)) between 2 and 100),
  constraint workforce_referral_sources_evidence_check check (evidence_kind in ('calendar_elapsed','biometric_present','delivery_activity'))
);

insert into public.workforce_referral_qualification_sources
  (company_id, code, name, evidence_kind, description, sort_order)
select company.id, source.code, source.name, source.evidence_kind, source.description, source.sort_order
from public.companies company
cross join (values
  ('calendar_days','Calendar days from joining','calendar_elapsed','Counts elapsed days from the associate joining date.',10),
  ('biometric_present_days','Biometric present days','biometric_present','Counts distinct attendance days marked present.',20),
  ('delivery_days','Delivery activity days','delivery_activity','Counts distinct mapped delivery activity days from partner shipment data.',30)
) source(code,name,evidence_kind,description,sort_order)
on conflict (company_id, code) do update set
  name=excluded.name,
  evidence_kind=excluded.evidence_kind,
  description=excluded.description,
  sort_order=excluded.sort_order,
  updated_at=now();

update public.workforce_referral_programs
set qualification_source='delivery_days', updated_at=now()
where qualification_source='amazon_delivery_days';

update public.workforce_referrals
set qualification_source_snapshot='delivery_days', updated_at=now()
where qualification_source_snapshot='amazon_delivery_days';

alter table public.workforce_referral_programs
  drop constraint if exists workforce_referral_programs_source_check;
alter table public.workforce_referrals
  drop constraint if exists workforce_referrals_source_check;

create or replace function public.workforce_referral_source_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if not exists (
    select 1 from public.workforce_referral_qualification_sources source
    where source.company_id=new.company_id and source.code=new.qualification_source and source.is_active
  ) then
    raise exception 'Choose an active referral qualification source';
  end if;
  return new;
end $$;

drop trigger if exists workforce_referral_program_source_guard on public.workforce_referral_programs;
create trigger workforce_referral_program_source_guard
before insert or update of company_id,qualification_source on public.workforce_referral_programs
for each row execute function public.workforce_referral_source_guard();

alter table public.workforce_referrals
  add column if not exists adjustment_id uuid references public.workforce_adjustments(id) on delete set null;

create index if not exists workforce_referrals_adjustment_idx
  on public.workforce_referrals(adjustment_id) where adjustment_id is not null;

-- Existing delivery roles receive the benefit now. Future role changes remain
-- controlled by the Designation master in Workforce.
update public.designations designation
set app_page_access=(
      select array_agg(distinct page order by page)
      from unnest(coalesce(designation.app_page_access,'{}'::text[]) || array['refer_earn']::text[]) page
    ),
    updated_at=now()
from public.designation_categories category
where designation.designation_category_id=category.id
  and category.people_module='delivery_network'
  and upper(designation.code) in ('DA','DCD','ODCD')
  and not ('refer_earn'=any(coalesce(designation.app_page_access,'{}'::text[])));

-- Link a referral when a candidate later enters the canonical Workforce table.
-- The match is company-scoped and uses the verified mobile identity shared by
-- Recruit, OpsPulse and Workforce onboarding.
create or replace function public.workforce_link_open_referral()
returns trigger language plpgsql security invoker set search_path='' as $$
declare worker_mobile text:=regexp_replace(coalesce(new.mobile,''),'[^0-9]','','g'); matching_profiles integer;
begin
  if new.deleted_at is not null or worker_mobile='' then return new; end if;
  select count(*)::integer into matching_profiles
  from public.workforce candidate
  where candidate.company_id=new.company_id and candidate.deleted_at is null
    and (
      regexp_replace(candidate.mobile,'[^0-9]','','g')=worker_mobile
      or regexp_replace(coalesce(candidate.mobile_country_code,'')||candidate.mobile,'[^0-9]','','g')=worker_mobile
    );
  if matching_profiles<>1 then return new; end if;
  update public.workforce_referrals referral
  set referred_workforce_id=new.id,
      status=case when referral.status='submitted' then 'linked' else referral.status end,
      updated_at=now()
  where referral.company_id=new.company_id
    and referral.referred_workforce_id is null
    and referral.status in ('submitted','linked','qualified')
    and (
      regexp_replace(referral.referred_mobile,'[^0-9]','','g')=worker_mobile
      or regexp_replace(referral.referred_country_code||referral.referred_mobile,'[^0-9]','','g')=worker_mobile
      or regexp_replace(referral.referred_mobile,'[^0-9]','','g')=
         regexp_replace(coalesce(new.mobile_country_code,'')||new.mobile,'[^0-9]','','g')
    );
  return new;
end $$;

drop trigger if exists workforce_link_open_referral on public.workforce;
create trigger workforce_link_open_referral
after insert or update of mobile,mobile_country_code,deleted_at on public.workforce
for each row execute function public.workforce_link_open_referral();

-- One refresh operation links the candidate and calculates progress from the
-- source selected in the location program master.
create or replace function public.workforce_refresh_referral(p_company uuid,p_referral uuid)
returns table(referred_workforce_id uuid,qualification_progress integer,status text)
language plpgsql security invoker set search_path='' as $$
declare referral public.workforce_referrals; source_kind text; worker uuid; progress integer:=0; matched integer:=0;
begin
  select * into referral from public.workforce_referrals
  where company_id=p_company and id=p_referral for update;
  if not found then raise exception 'Referral was not found'; end if;
  if referral.status in ('rejected','cancelled','paid') then
    return query select referral.referred_workforce_id,referral.qualification_progress,referral.status;
    return;
  end if;

  worker:=referral.referred_workforce_id;
  if worker is null then
    select (array_agg(candidate.id order by candidate.id))[1],count(*) into worker,matched
    from public.workforce candidate
    where candidate.company_id=p_company and candidate.deleted_at is null
      and (
        regexp_replace(candidate.mobile,'[^0-9]','','g')=regexp_replace(referral.referred_mobile,'[^0-9]','','g')
        or regexp_replace(candidate.mobile,'[^0-9]','','g')=regexp_replace(referral.referred_country_code||referral.referred_mobile,'[^0-9]','','g')
        or regexp_replace(coalesce(candidate.mobile_country_code,'')||candidate.mobile,'[^0-9]','','g')=regexp_replace(referral.referred_mobile,'[^0-9]','','g')
      );
    if matched<>1 then worker:=null; end if;
  end if;

  select master.evidence_kind into source_kind
  from public.workforce_referral_qualification_sources master
  where master.company_id=p_company and master.code=referral.qualification_source_snapshot;
  if source_kind is null then raise exception 'Referral qualification source is not configured'; end if;

  if worker is not null and source_kind='calendar_elapsed' then
    select case when date_of_join is null then 0 else greatest(0,(current_date-date_of_join)+1) end
    into progress from public.workforce where company_id=p_company and id=worker;
  elsif worker is not null and source_kind='biometric_present' then
    select count(distinct attendance.punch_date)::integer into progress
    from public.attendance_daily attendance
    where attendance.company_id=p_company and attendance.workforce_id=worker
      and upper(coalesce(attendance.status,'')) in ('P','PRESENT');
  elsif worker is not null and source_kind='delivery_activity' then
    select count(distinct evidence.work_date)::integer into progress from (
      select line.work_date
      from public.workforce_payroll_lines line
      where line.company_id=p_company and line.workforce_id=worker
        and line.source_type='shipment' and (line.shipment_count>0 or line.activity_count>0)
      union
      select shipment.work_date
      from public.cps_shipment_daily shipment
      join public.field_executive_provider_mappings mapping
        on mapping.company_id=shipment.company_id
       and mapping.workforce_id=worker
       and mapping.provider_member_id=shipment.provider_employee_id
       and mapping.status<>'cancelled'
       and mapping.effective_from<=shipment.work_date
       and (mapping.effective_to is null or mapping.effective_to>=shipment.work_date)
      where shipment.company_id=p_company and shipment.total_activity>0
    ) evidence;
  end if;

  update public.workforce_referrals item
  set referred_workforce_id=worker,
      qualification_progress=coalesce(progress,0),
      status=case
        when worker is null then 'submitted'
        when coalesce(progress,0)>=item.qualifying_days_snapshot then 'qualified'
        else 'linked'
      end,
      qualified_at=case when worker is not null and coalesce(progress,0)>=item.qualifying_days_snapshot then coalesce(item.qualified_at,now()) else null end,
      updated_at=now()
  where item.company_id=p_company and item.id=p_referral
  returning item.referred_workforce_id,item.qualification_progress,item.status
  into referred_workforce_id,qualification_progress,status;
  return next;
end $$;

-- Close the final step when Finance processes the referrer's payroll item.
create or replace function public.workforce_referral_payment_sync()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.status='paid' and old.status is distinct from 'paid' then
    update public.workforce_referrals referral
    set status='paid',paid_at=coalesce(referral.paid_at,now()),updated_at=now()
    from public.workforce_adjustments adjustment
    where referral.adjustment_id=adjustment.id
      and adjustment.company_id=new.company_id
      and adjustment.payroll_run_id=new.payroll_run_id
      and adjustment.workforce_id=new.workforce_id
      and referral.status='approved';
  end if;
  return new;
end $$;

drop trigger if exists workforce_referral_payment_sync on public.workforce_payroll_items;
create trigger workforce_referral_payment_sync
after update of status on public.workforce_payroll_items
for each row execute function public.workforce_referral_payment_sync();

alter table public.workforce_referral_qualification_sources enable row level security;
revoke all on table public.workforce_referral_qualification_sources from public,anon,authenticated;
grant select,insert,update,delete on table public.workforce_referral_qualification_sources to service_role;
revoke all on function public.workforce_referral_source_guard(),public.workforce_link_open_referral(),public.workforce_refresh_referral(uuid,uuid),public.workforce_referral_payment_sync() from public,anon,authenticated;
grant execute on function public.workforce_refresh_referral(uuid,uuid) to service_role;

commit;
