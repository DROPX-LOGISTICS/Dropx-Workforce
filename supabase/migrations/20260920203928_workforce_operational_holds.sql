begin;
create table public.workforce_payment_holds (
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
  workforce_id uuid not null references public.workforce(id),station_id uuid not null references public.stations(id),
  period_start date not null,period_end date not null check(period_end>=period_start and period_end<=period_start+92),
  reason text not null check(length(reason) between 5 and 2000),reference text not null check(length(reference) between 3 and 250),
  status text not null default 'active' check(status in ('active','release_requested','released')),
  requested_by uuid not null references auth.users(id),requested_at timestamptz not null default now(),
  release_requested_at timestamptz,released_by uuid references auth.users(id),released_at timestamptz,release_note text,
  check(status<>'released' or (released_by is not null and released_by<>requested_by and released_at is not null and length(release_note)>=5)),
  unique(company_id,workforce_id,reference)
);
create index workforce_payment_holds_scope_idx on public.workforce_payment_holds(company_id,station_id,status,period_start,period_end);
create index workforce_payment_holds_person_idx on public.workforce_payment_holds(company_id,workforce_id,status);
alter table public.workforce_payment_holds enable row level security;
revoke all on public.workforce_payment_holds from public,anon,authenticated;
grant select on public.workforce_payment_holds to service_role;

create function public.workforce_manage_payment_hold(p_company uuid,p_actor uuid,p_id uuid,p_workforce uuid,p_action text,p_payload jsonb,p_locations uuid[],p_reviewer boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare w public.workforce; h public.workforce_payment_holds; v_id uuid;
begin
  if p_actor is null then raise exception 'Actor is required'; end if;
  if p_action='create' then
    select * into w from public.workforce where company_id=p_company and id=p_workforce and deleted_at is null and migration_state<>'reclassified' for update;
    if not found or (p_locations is not null and not(w.location_id=any(p_locations))) then raise exception 'Workforce associate is outside your station scope'; end if;
    if exists(select 1 from public.workforce_payroll_finance_links l join public.workforce_payroll_runs r on r.id=l.payroll_run_id join public.payment_requests p on p.id=l.payment_request_id join public.workforce_payroll_items i on i.id=l.payroll_item_id
      where l.company_id=p_company and i.workforce_id=p_workforce and p.status in ('processing','processed') and daterange(r.period_start,r.period_end,'[]') && daterange((p_payload->>'period_start')::date,(p_payload->>'period_end')::date,'[]')) then raise exception 'This period is already at the bank or paid. Contact Finance; choose only an unpaid period for a new hold'; end if;
    insert into public.workforce_payment_holds(company_id,workforce_id,station_id,period_start,period_end,reason,reference,requested_by)
      values(p_company,p_workforce,w.location_id,(p_payload->>'period_start')::date,(p_payload->>'period_end')::date,p_payload->>'reason',p_payload->>'reference',p_actor) returning id into v_id;
    return v_id;
  end if;
  select * into h from public.workforce_payment_holds where company_id=p_company and id=p_id for update;
  if not found or (p_locations is not null and not(h.station_id=any(p_locations))) then raise exception 'Hold is outside your station scope'; end if;
  if p_action='request_release' and h.requested_by=p_actor and h.status='active' then
    update public.workforce_payment_holds set status='release_requested',release_requested_at=now() where id=h.id;
  elsif p_action='release' and p_reviewer is true and h.requested_by<>p_actor and h.status in ('active','release_requested') then
    if length(coalesce(p_payload->>'note',''))<5 then raise exception 'A release decision note is required'; end if;
    update public.workforce_payment_holds set status='released',released_by=p_actor,released_at=now(),release_note=p_payload->>'note' where id=h.id;
  else raise exception 'Hold release requires a different authorised reviewer'; end if;
  return h.id;
end $$;

create function public.workforce_payment_hold_gate() returns trigger language plpgsql security invoker set search_path='' as $$
declare r public.workforce_payroll_runs; person uuid; run_id uuid;
begin
  if tg_table_name='workforce_payroll_runs' then
    if new.status not in ('review','approved') or old.status=new.status then return new; end if;
    r:=new;
    perform 1 from public.workforce w join public.workforce_payroll_items i on i.workforce_id=w.id where i.payroll_run_id=r.id and i.status<>'excluded' order by w.id for update of w;
    if exists(select 1 from public.workforce_payment_holds h join public.workforce_payroll_items i on i.workforce_id=h.workforce_id and i.company_id=h.company_id where i.payroll_run_id=r.id and i.status<>'excluded' and h.status<>'released' and daterange(h.period_start,h.period_end,'[]') && daterange(r.period_start,r.period_end,'[]')) then raise exception 'An Ops payment hold is active. Resolve it or exclude the associate from the draft'; end if;
  else
    if new.status not in ('processing','processed') or old.status=new.status then return new; end if;
    select i.workforce_id,l.payroll_run_id into person,run_id from public.workforce_payroll_finance_links l join public.workforce_payroll_items i on i.id=l.payroll_item_id where l.company_id=new.company_id and l.payment_request_id=new.id;
    if person is null then return new; end if;
    select * into r from public.workforce_payroll_runs where id=run_id and company_id=new.company_id;
    perform 1 from public.workforce where id=person and company_id=new.company_id for update;
    if exists(select 1 from public.workforce_payment_holds h where h.company_id=new.company_id and h.workforce_id=person and h.status<>'released' and daterange(h.period_start,h.period_end,'[]') && daterange(r.period_start,r.period_end,'[]')) then raise exception 'An Ops payment hold is active. Do not send this payment to the bank'; end if;
  end if;
  return new;
end $$;
create trigger workforce_payment_hold_gate before update of status on public.workforce_payroll_runs for each row execute function public.workforce_payment_hold_gate();
create trigger workforce_payment_hold_gate before update of status on public.payment_requests for each row execute function public.workforce_payment_hold_gate();
revoke all on function public.workforce_manage_payment_hold(uuid,uuid,uuid,uuid,text,jsonb,uuid[],boolean),public.workforce_payment_hold_gate() from public,anon,authenticated;
grant execute on function public.workforce_manage_payment_hold(uuid,uuid,uuid,uuid,text,jsonb,uuid[],boolean),public.workforce_payment_hold_gate() to service_role;
commit;
