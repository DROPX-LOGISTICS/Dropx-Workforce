begin;
create function public.workforce_exit_effective_date_sync() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.profile_type='workforce' and new.status='settlement_pending' and old.status is distinct from new.status then
    update public.workforce set lifecycle_status='settlement_pending',last_working_date=coalesce(new.approved_effective_date,new.requested_effective_date),updated_at=now() where company_id=new.company_id and id=new.profile_id;
    if not found then raise exception 'Canonical Workforce exit profile was not found'; end if;
  end if;
  return new;
end $$;
create trigger workforce_exit_effective_date_sync after update of status on public.workforce_lifecycle_cases for each row execute function public.workforce_exit_effective_date_sync();
revoke all on function public.workforce_exit_effective_date_sync() from public,anon,authenticated;
-- Settlement is a reconciliation of a Finance payment, never another payment.
create table public.workforce_exit_payment_reconciliations (
  lifecycle_case_id uuid primary key references public.workforce_lifecycle_cases(id),
  company_id uuid not null references public.companies(id),
  workforce_id uuid not null references public.workforce(id),
  payroll_item_id uuid not null unique references public.workforce_payroll_items(id),
  payment_request_id uuid not null unique references public.payment_requests(id),
  reconciled_by uuid not null references auth.users(id),
  reconciled_at timestamptz not null default now(),
  review_note text not null check(length(review_note) between 10 and 2000)
);
create index workforce_exit_payment_company_idx on public.workforce_exit_payment_reconciliations(company_id,workforce_id);
alter table public.workforce_exit_payment_reconciliations enable row level security;
revoke all on public.workforce_exit_payment_reconciliations from public,anon,authenticated;
grant select on public.workforce_exit_payment_reconciliations to service_role;

create function public.workforce_exit_finance_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.workforce_lifecycle_cases; i public.workforce_payroll_items; p public.payment_requests;
begin
  select * into c from public.workforce_lifecycle_cases where id=new.lifecycle_case_id and company_id=new.company_id;
  if c.profile_type is distinct from 'workforce' then return new; end if;
  select pi.* into i from public.workforce_exit_payment_reconciliations x join public.workforce_payroll_items pi on pi.id=x.payroll_item_id and pi.company_id=x.company_id
    where x.lifecycle_case_id=c.id and x.company_id=c.company_id and x.workforce_id=c.profile_id;
  if not found then raise exception 'Reconcile final payroll with Finance before completing Workforce settlement; manual paid or waived amounts are not accepted'; end if;
  select pr.* into p from public.workforce_exit_payment_reconciliations x join public.payment_requests pr on pr.id=x.payment_request_id and pr.company_id=x.company_id where x.lifecycle_case_id=c.id;
  if p.status is distinct from 'processed' or i.status<>'paid' or new.status<>'paid' or new.gross_amount is distinct from i.gross_amount
    or new.deduction_amount is distinct from i.deduction_amount or new.payment_reference is distinct from p.utr_cin
    or new.payment_date is distinct from (p.processed_at at time zone 'Asia/Kolkata')::date then
    raise exception 'Settlement must match the paid Finance payroll item and bank reference';
  end if;
  return new;
end $$;
create trigger workforce_exit_finance_guard before insert or update on public.workforce_final_settlements for each row execute function public.workforce_exit_finance_guard();

create function public.workforce_reconcile_exit(p_company uuid,p_case uuid,p_item uuid,p_actor uuid,p_owner boolean,p_note text,p_checklist jsonb,p_locations uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare c public.workforce_lifecycle_cases; i public.workforce_payroll_items; r public.workforce_payroll_runs; p public.payment_requests; last_day date;
begin
  if p_actor is null or p_owner is not true then raise exception 'Owner reconciliation is required'; end if;
  select * into c from public.workforce_lifecycle_cases where company_id=p_company and id=p_case for update;
  if not found or c.profile_type<>'workforce' then raise exception 'Choose a canonical Workforce exit'; end if;
  if p_locations is not null and (c.profile_location_id is null or not(c.profile_location_id=any(p_locations))) then raise exception 'Exit is outside your station scope'; end if;
  if c.status='settled' and exists(select 1 from public.workforce_exit_payment_reconciliations where lifecycle_case_id=p_case and payroll_item_id=p_item and company_id=p_company) then return; end if;
  if c.status<>'settlement_pending' then raise exception 'Exit is not awaiting settlement'; end if;
  if length(coalesce(btrim(p_note),'')) not between 10 and 2000 then raise exception 'Record the final earnings and source review note'; end if;
  last_day:=coalesce(c.approved_effective_date,c.requested_effective_date);
  select * into i from public.workforce_payroll_items where company_id=p_company and id=p_item and workforce_id=c.profile_id;
  if not found or i.status<>'paid' or i.net_amount<=0 then raise exception 'Select this associate''s Finance-paid final payroll item'; end if;
  select * into r from public.workforce_payroll_runs where company_id=p_company and id=i.payroll_run_id for update;
  if r.status not in ('approved','paid') or last_day not between r.period_start and r.period_end then raise exception 'Final payroll must cover the approved last working day'; end if;
  perform 1 from public.workforce where company_id=p_company and id=c.profile_id for update;
  select pr.* into p from public.workforce_payroll_finance_links l join public.payment_requests pr on pr.id=l.payment_request_id and pr.company_id=l.company_id
    where l.company_id=p_company and l.payroll_item_id=i.id;
  if not found or p.status<>'processed' or nullif(btrim(p.utr_cin),'') is null or p.processed_at is null or p.amount is distinct from i.net_amount then raise exception 'Finance must reconcile the final payment first'; end if;
  if exists(select 1 from public.workforce_payment_holds where company_id=p_company and workforce_id=c.profile_id and status<>'released') then raise exception 'Resolve outstanding payment holds before closing the exit'; end if;
  if exists(select 1 from public.workforce_payroll_items pi join public.workforce_payroll_runs pr on pr.id=pi.payroll_run_id and pr.company_id=pi.company_id
    where pi.company_id=p_company and pi.workforce_id=c.profile_id and pr.status<>'cancelled' and pi.status<>'paid') then raise exception 'Resolve unpaid, held or excluded payroll items before closing the exit'; end if;
  if exists(select 1 from public.workforce_adjustments where company_id=p_company and workforce_id=c.profile_id and status in ('draft','pending','approved')) then raise exception 'Resolve unposted adjustments before closing the exit'; end if;
  insert into public.workforce_exit_payment_reconciliations(lifecycle_case_id,company_id,workforce_id,payroll_item_id,payment_request_id,reconciled_by,review_note)
    values(c.id,p_company,c.profile_id,i.id,p.id,p_actor,btrim(p_note));
  perform public.workforce_complete_settlement(p_company,p_case,p_actor,'paid',i.gross_amount,i.deduction_amount,p.utr_cin,(p.processed_at at time zone 'Asia/Kolkata')::date,p_checklist,p_locations);
end $$;
revoke all on function public.workforce_exit_finance_guard(),public.workforce_reconcile_exit(uuid,uuid,uuid,uuid,boolean,text,jsonb,uuid[]) from public,anon,authenticated;
grant execute on function public.workforce_reconcile_exit(uuid,uuid,uuid,uuid,boolean,text,jsonb,uuid[]) to service_role;
commit;
