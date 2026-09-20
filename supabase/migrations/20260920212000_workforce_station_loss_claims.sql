begin;
create table public.workforce_station_loss_claims (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 workforce_id uuid not null references public.workforce(id),station_id uuid not null references public.stations(id),
 adjustment_id uuid not null unique references public.workforce_adjustments(id),
 incident_date date not null,reference text not null check(length(reference) between 3 and 200),
 reported_by uuid not null references auth.users(id),reported_at timestamptz not null default now(),
 unique(company_id,workforce_id,reference)
);
create index workforce_station_loss_scope_idx on public.workforce_station_loss_claims(company_id,station_id,incident_date desc);
alter table public.workforce_station_loss_claims enable row level security;
revoke all on public.workforce_station_loss_claims from public,anon,authenticated;
grant select on public.workforce_station_loss_claims to service_role;

create function public.workforce_submit_station_loss(p_company uuid,p_actor uuid,p_workforce uuid,p_station uuid,p_amount numeric,p_date date,p_posting_date date,p_reference text,p_reason text,p_category text,p_locations uuid[])
returns uuid language plpgsql security definer set search_path='' as $$
declare w public.workforce; existing public.workforce_station_loss_claims; a public.workforce_adjustments; adjustment uuid; claim uuid;
begin
 if p_actor is null then raise exception 'Reporter is required'; end if;
 if p_station is null or (p_locations is not null and not(p_station=any(p_locations))) then raise exception 'Station is outside your scope'; end if;
 if not exists(select 1 from public.stations where company_id=p_company and id=p_station) then raise exception 'Choose a company station'; end if;
 select * into w from public.workforce where id=p_workforce and company_id=p_company and deleted_at is null and migration_state<>'reclassified' for update;
 if not found or w.location_id is distinct from p_station then raise exception 'Choose a canonical Workforce associate at this station'; end if;
 if not exists(select 1 from public.designations d join public.designation_categories c on c.id=d.designation_category_id
   where d.company_id=p_company and c.company_id=p_company and c.people_module='delivery_network'
   and ((w.designation_id is not null and d.id=w.designation_id) or (w.designation_id is null and nullif(btrim(w.designation),'') is not null and lower(btrim(w.designation)) in (lower(btrim(d.code)),lower(btrim(d.name)))))) then raise exception 'Workforce designation master must classify this associate'; end if;
 if p_amount is null or p_amount<=0 or p_amount::text in ('NaN','Infinity','-Infinity') or round(p_amount,2)<>p_amount then raise exception 'Loss amount must be positive with at most two decimals'; end if;
 if p_date is null or p_date>(now() at time zone 'Asia/Kolkata')::date then raise exception 'Choose the actual incident date, not a future date'; end if;
 if p_posting_date is null or p_posting_date<p_date then raise exception 'Payroll posting date cannot precede the incident'; end if;
 if exists(select 1 from public.workforce_payroll_items i join public.workforce_payroll_runs r on r.id=i.payroll_run_id and r.company_id=i.company_id where i.company_id=p_company and i.workforce_id=p_workforce and r.status in ('approved','paid') and p_posting_date between r.period_start and r.period_end) then raise exception 'That payroll period is already confirmed. Choose a date in the next open payroll period'; end if;
 if p_category not in ('cash_recovery','asset_recovery','other') then raise exception 'Choose a loss category'; end if;
 p_reference:=upper(btrim(p_reference));p_reason:=btrim(p_reason);
 if length(coalesce(p_reference,'')) not between 3 and 200 or length(coalesce(p_reason,'')) not between 10 and 2000 then raise exception 'Provide a unique incident reference and documented reason'; end if;
 select * into existing from public.workforce_station_loss_claims where company_id=p_company and workforce_id=p_workforce and reference=p_reference;
 if found then
   select * into a from public.workforce_adjustments where id=existing.adjustment_id and company_id=p_company;
   if existing.station_id<>p_station or existing.incident_date<>p_date or a.amount<>p_amount or a.category<>p_category or a.reason<>p_reason then raise exception 'This incident reference already exists with different details. Review the original claim'; end if;
   return existing.id;
 end if;
 insert into public.workforce_adjustments(company_id,workforce_id,adjustment_type,category,amount,effective_date,reason,external_reference,status,requested_by)
   values(p_company,p_workforce,'deduction',p_category,p_amount,p_posting_date,p_reason,'OPS-LOSS:'||p_reference,'pending',p_actor) returning id into adjustment;
 insert into public.workforce_station_loss_claims(company_id,workforce_id,station_id,adjustment_id,incident_date,reference,reported_by)
   values(p_company,p_workforce,p_station,adjustment,p_date,p_reference,p_actor) returning id into claim;
 return claim;
end $$;
create function public.workforce_station_loss_review_gate() returns trigger language plpgsql security definer set search_path='' as $$
declare claim public.workforce_station_loss_claims;
begin
 select * into claim from public.workforce_station_loss_claims where adjustment_id=old.id;
 if not found then return new; end if;
 if new.company_id<>old.company_id or new.workforce_id<>old.workforce_id or new.amount<>old.amount or new.category<>old.category or new.adjustment_type<>'deduction' or new.external_reference is distinct from old.external_reference or new.requested_by is distinct from old.requested_by or new.reason<>old.reason then raise exception 'The submitted station loss is immutable; reject it and record a corrected claim'; end if;
 if old.status not in ('pending','draft') and new.effective_date<>old.effective_date then raise exception 'Reviewed loss posting dates are frozen'; end if;
 if new.status='approved' and old.status in ('pending','draft') then
   perform 1 from public.workforce where id=new.workforce_id and company_id=new.company_id for update;
   if new.effective_date<claim.incident_date then raise exception 'Posting date cannot precede the incident'; end if;
   if exists(select 1 from public.workforce_payroll_items i join public.workforce_payroll_runs r on r.id=i.payroll_run_id and r.company_id=i.company_id where i.company_id=new.company_id and i.workforce_id=new.workforce_id and r.status in ('approved','paid') and new.effective_date between r.period_start and r.period_end) then raise exception 'Choose a posting date in an open payroll period'; end if;
 end if;
 return new;
end $$;
create trigger workforce_station_loss_review_gate before update on public.workforce_adjustments for each row execute function public.workforce_station_loss_review_gate();
create function public.workforce_station_loss_payroll_gate() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status in ('review','approved') and new.status<>old.status then
   perform 1 from public.workforce w join public.workforce_payroll_items i on i.workforce_id=w.id and i.company_id=w.company_id where i.payroll_run_id=new.id and i.status<>'excluded' order by w.id for update of w;
   if exists(select 1 from public.workforce_adjustments a join public.workforce_station_loss_claims c on c.adjustment_id=a.id join public.workforce_payroll_items i on i.workforce_id=a.workforce_id and i.company_id=a.company_id where i.payroll_run_id=new.id and i.status<>'excluded' and a.status='approved' and a.payroll_run_id is null and a.effective_date between new.period_start and new.period_end) then raise exception 'An approved station loss is missing from this snapshot. Return to draft and recalculate payroll'; end if;
 end if;
 return new;
end $$;
create trigger workforce_station_loss_payroll_gate before update of status on public.workforce_payroll_runs for each row execute function public.workforce_station_loss_payroll_gate();
revoke all on function public.workforce_submit_station_loss(uuid,uuid,uuid,uuid,numeric,date,date,text,text,text,uuid[]),public.workforce_station_loss_review_gate(),public.workforce_station_loss_payroll_gate() from public,anon,authenticated;
grant execute on function public.workforce_submit_station_loss(uuid,uuid,uuid,uuid,numeric,date,date,text,text,text,uuid[]) to service_role;
commit;
