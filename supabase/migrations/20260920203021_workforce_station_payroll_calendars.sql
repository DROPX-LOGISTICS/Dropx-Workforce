begin;
-- No calendar, rate or payroll is assigned to any real station by this release.
create table public.workforce_payroll_calendars (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  station_id uuid not null references public.stations(id),
  name text not null check(length(name) between 3 and 120),
  cadence text not null check(cadence in ('daily','weekly','fifteen_days','monthly','custom')),
  interval_days integer check(interval_days between 1 and 93),
  anchor_date date not null,
  policy_reference text not null check(length(policy_reference) between 3 and 1000),
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  retired_by uuid references auth.users(id),
  retired_at timestamptz,
  constraint workforce_calendar_interval_check check((cadence='custom' and interval_days is not null) or (cadence<>'custom' and interval_days is null)),
  constraint workforce_calendar_month_check check(cadence<>'monthly' or extract(day from anchor_date)=1)
);
create index workforce_payroll_calendar_scope_idx on public.workforce_payroll_calendars(company_id,station_id,is_active);
alter table public.workforce_payroll_calendars enable row level security;
revoke all on public.workforce_payroll_calendars from public,anon,authenticated;
grant select,insert,update on public.workforce_payroll_calendars to service_role;
alter table public.workforce_payroll_runs add column station_id uuid references public.stations(id);
alter table public.workforce_payroll_runs add column calendar_id uuid references public.workforce_payroll_calendars(id);
create index workforce_payroll_run_station_idx on public.workforce_payroll_runs(company_id,station_id,period_start,period_end);
alter table public.workforce_payroll_runs drop constraint workforce_payroll_runs_company_period_excl;

create function public.workforce_payroll_scope_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if (new.company_id,new.station_id,new.calendar_id,new.period_start,new.period_end) is distinct from (old.company_id,old.station_id,old.calendar_id,old.period_start,old.period_end) and old.status<>'draft' then raise exception 'Submitted payroll scope is immutable'; end if;
    if (new.company_id,new.station_id,new.calendar_id,new.period_start,new.period_end) is not distinct from (old.company_id,old.station_id,old.calendar_id,old.period_start,old.period_end) and old.status<>'cancelled' then return new; end if;
  end if;
  if new.station_id is not null and not exists(select 1 from public.stations where id=new.station_id and company_id=new.company_id) then raise exception 'Payroll station is outside this company'; end if;
  if new.calendar_id is not null and not exists(select 1 from public.workforce_payroll_calendars where id=new.calendar_id and company_id=new.company_id and station_id=new.station_id and is_active) then raise exception 'Select an active calendar for the payroll station'; end if;
  if new.status='cancelled' then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('payroll-scope:'||new.company_id::text,0));
  if exists(select 1 from public.workforce_payroll_runs r where r.company_id=new.company_id and r.id<>new.id and r.status<>'cancelled'
    and (new.station_id is null or r.station_id is null or r.station_id=new.station_id)
    and daterange(r.period_start,r.period_end,'[]') && daterange(new.period_start,new.period_end,'[]')) then raise exception 'Payroll period overlaps an existing run for this station or the whole network'; end if;
  return new;
end $$;
create trigger workforce_payroll_scope_guard before insert or update of company_id,station_id,calendar_id,period_start,period_end,status on public.workforce_payroll_runs for each row execute function public.workforce_payroll_scope_guard();

create function public.workforce_payroll_person_period_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare r public.workforce_payroll_runs;
begin
  select * into r from public.workforce_payroll_runs where id=new.payroll_run_id and company_id=new.company_id;
  if not found then raise exception 'Invalid payroll company'; end if;
  if new.status='excluded' or r.status='cancelled' then return new; end if;
  perform 1 from public.workforce where id=new.workforce_id and company_id=new.company_id for update;
  if not found then raise exception 'Invalid payroll associate'; end if;
  if r.station_id is not null and not exists(select 1 from public.stations s where s.id=r.station_id and s.company_id=new.company_id and s.station_code=new.station_code) then raise exception 'Associate earnings do not match the payroll station'; end if;
  if exists(select 1 from public.workforce_payroll_items i join public.workforce_payroll_runs x on x.id=i.payroll_run_id
    where i.company_id=new.company_id and i.workforce_id=new.workforce_id and i.payroll_run_id<>new.payroll_run_id and i.status<>'excluded' and x.status<>'cancelled'
    and daterange(x.period_start,x.period_end,'[]') && daterange(r.period_start,r.period_end,'[]')) then raise exception 'This associate already belongs to an overlapping payroll; resolve the earlier run first'; end if;
  return new;
end $$;
create trigger workforce_payroll_person_period_guard before insert or update of workforce_id,payroll_run_id,status,station_code on public.workforce_payroll_items for each row execute function public.workforce_payroll_person_period_guard();

create function public.workforce_calendar_immutable_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then
    if not exists(select 1 from public.stations where id=new.station_id and company_id=new.company_id) then raise exception 'Calendar station is outside this company'; end if;
  elsif (to_jsonb(new)-array['is_active','retired_by','retired_at']) is distinct from (to_jsonb(old)-array['is_active','retired_by','retired_at']) or old.is_active=false or new.is_active=true or new.retired_by is null or new.retired_at is null then
    raise exception 'Calendars are immutable; create a new version';
  end if;
  return new;
end $$;
create trigger workforce_calendar_immutable_guard before insert or update on public.workforce_payroll_calendars for each row execute function public.workforce_calendar_immutable_guard();
revoke all on function public.workforce_payroll_scope_guard(),public.workforce_payroll_person_period_guard(),public.workforce_calendar_immutable_guard() from public,anon,authenticated;
grant execute on function public.workforce_payroll_scope_guard(),public.workforce_payroll_person_period_guard(),public.workforce_calendar_immutable_guard() to service_role;

create or replace function public.workforce_save_payroll_snapshot(
  p_company uuid, p_actor uuid, p_run jsonb, p_items jsonb, p_lines jsonb, p_adjustments uuid[]
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := (p_run->>'id')::uuid;
  v_run public.workforce_payroll_runs;
  v_new boolean;
  v_changed integer;
begin
  if p_actor is null or v_id is null or jsonb_array_length(p_items)=0 then raise exception 'A complete payroll snapshot and actor are required'; end if;
  select * into v_run from public.workforce_payroll_runs where id=v_id and company_id=p_company for update;
  v_new := not found;
  if v_new then
    insert into public.workforce_payroll_runs(id,company_id,run_number,period_start,period_end,status,created_by,station_id,calendar_id)
    values(v_id,p_company,p_run->>'run_number',(p_run->>'period_start')::date,(p_run->>'period_end')::date,'draft',p_actor,nullif(p_run->>'station_id','')::uuid,nullif(p_run->>'calendar_id','')::uuid);
  else
    if v_run.status<>'draft' then raise exception 'Only a draft payroll can be recalculated'; end if;
    if p_run->>'expected_updated_at' is not null and v_run.updated_at<>(p_run->>'expected_updated_at')::timestamptz then
      raise exception 'Payroll changed during calculation. Refresh and recalculate';
    end if;
  end if;
  if exists(select 1 from jsonb_populate_recordset(null::public.workforce_payroll_items,p_items) i
    left join public.workforce w on w.id=i.workforce_id and w.company_id=p_company and w.deleted_at is null and w.migration_state<>'reclassified'
    where w.id is null or i.status not in ('ready','hold') or i.company_id<>p_company or i.payroll_run_id<>v_id) then
    raise exception 'Snapshot contains an invalid Workforce identity or scope';
  end if;
  delete from public.workforce_payroll_items where payroll_run_id=v_id and company_id=p_company;
  insert into public.workforce_payroll_items(id,company_id,payroll_run_id,workforce_id,dropx_id,worker_name,station_code,bank_account_no,ifsc_code,
    shipment_count,activity_count,work_days,base_amount,incentive_amount,adjustment_amount,deduction_amount,gross_amount,net_amount,status,hold_reasons,provider_member_ids)
  select id,p_company,v_id,workforce_id,dropx_id,worker_name,station_code,bank_account_no,ifsc_code,
    shipment_count,activity_count,work_days,base_amount,incentive_amount,adjustment_amount,deduction_amount,gross_amount,net_amount,status,hold_reasons,provider_member_ids
  from jsonb_populate_recordset(null::public.workforce_payroll_items,p_items);
  if exists(select 1 from jsonb_populate_recordset(null::public.workforce_payroll_lines,p_lines) l
    left join public.workforce_payroll_items i on i.id=l.payroll_item_id and i.payroll_run_id=v_id and i.workforce_id=l.workforce_id
    where i.id is null or l.company_id<>p_company or l.payroll_run_id<>v_id) then raise exception 'Invalid payroll line scope'; end if;
  insert into public.workforce_payroll_lines(company_id,payroll_run_id,payroll_item_id,workforce_id,source_type,source_id,work_date,provider_name,provider_member_id,
    shipment_count,activity_count,base_amount,incentive_amount,adjustment_amount,net_amount,calculation_source,calculation_snapshot)
  select p_company,v_id,payroll_item_id,workforce_id,source_type,source_id,work_date,provider_name,provider_member_id,
    shipment_count,activity_count,base_amount,incentive_amount,adjustment_amount,net_amount,calculation_source,calculation_snapshot
  from jsonb_populate_recordset(null::public.workforce_payroll_lines,p_lines);
  p_adjustments := coalesce(p_adjustments,'{}'::uuid[]);
  update public.workforce_adjustments set status='approved',payroll_run_id=null,updated_at=now()
    where company_id=p_company and payroll_run_id=v_id and status='posted' and not(id=any(p_adjustments));
  update public.workforce_adjustments set status='posted',payroll_run_id=v_id,updated_at=now()
    where company_id=p_company and id=any(p_adjustments)
    and ((status='approved' and payroll_run_id is null) or (status='posted' and payroll_run_id=v_id));
  get diagnostics v_changed = row_count;
  if v_changed<>cardinality(p_adjustments) then raise exception 'An adjustment changed or belongs to another payroll. Recalculate'; end if;
  perform public.workforce_refresh_payroll_totals(p_company,v_id);
  update public.workforce_payroll_runs set exception_count=(p_run->>'exception_count')::int,
    source_updated_at=(p_run->>'source_updated_at')::timestamptz,calculated_at=now() where id=v_id;
  insert into public.workforce_payroll_events(company_id,payroll_run_id,event_code,to_status,actor_user_id)
    values(p_company,v_id,case when v_new then 'run_created' else 'run_recalculated' end,'draft',p_actor);
  return v_id;
end $$;
commit;
