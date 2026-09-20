begin;
-- Additive integration. No historical payroll or live payment is submitted by this migration.
alter table public.workforce_payroll_runs add column if not exists finance_payment_head_id uuid references public.payment_heads(id);
alter table public.workforce_payroll_runs add column if not exists finance_sent_at timestamptz;

create table public.workforce_payroll_finance_links (
  company_id uuid not null references public.companies(id),
  payroll_run_id uuid not null references public.workforce_payroll_runs(id),
  payroll_item_id uuid primary key references public.workforce_payroll_items(id),
  payment_request_id uuid not null unique references public.payment_requests(id),
  created_at timestamptz not null default now()
);
create index workforce_payroll_finance_run_idx on public.workforce_payroll_finance_links(company_id,payroll_run_id);
create unique index workforce_payment_source_once_idx on public.payment_requests(company_id,source_record_id) where source_system='WORKFORCE_PAYROLL';
alter table public.workforce_payroll_finance_links enable row level security;
revoke all on public.workforce_payroll_finance_links from public,anon,authenticated;
grant select,insert,update,delete on public.workforce_payroll_finance_links to service_role;

create function public.workforce_enqueue_finance(p_company uuid,p_run uuid,p_actor uuid)
returns integer language plpgsql security invoker set search_path='' as $$
declare r public.workforce_payroll_runs; h public.payment_heads; i public.workforce_payroll_items;
  station uuid; payment uuid; approval_roles uuid[]; final_roles uuid[]; n integer:=0;
begin
  select * into r from public.workforce_payroll_runs where company_id=p_company and id=p_run for update;
  if not found or r.status<>'approved' or p_actor is null then raise exception 'Confirm an approved payroll before sending to Finance'; end if;
  if r.finance_sent_at is not null then return 0; end if;
  select * into h from public.payment_heads where company_id=p_company and id=r.finance_payment_head_id and is_active;
  if not found then raise exception 'Select an active payroll payment head configured in Finance'; end if;
  final_roles:=case when cardinality(h.final_approval_role_ids)>0 then h.final_approval_role_ids else array_remove(array[h.final_approval_role_id],null) end;
  approval_roles:=case when cardinality(h.initial_approval_role_ids)>0 then h.initial_approval_role_ids when h.initial_approval_role_id is not null then array[h.initial_approval_role_id] else final_roles end;
  if cardinality(final_roles)=0 or coalesce(cardinality(h.payment_process_role_ids),0)=0 then raise exception 'Configure Finance final approval and payment processor roles for this payment head'; end if;
  if coalesce('account_transfer'=any(h.supported_payment_modes),false) is not true then raise exception 'Payroll requires a payment head that supports account transfer'; end if;
  if exists(select 1 from unnest(approval_roles||final_roles||h.payment_process_role_ids) role_id where not exists(select 1 from public.user_roles u where u.id=role_id and u.company_id=p_company)) then raise exception 'Payment roles must belong to this company'; end if;
  if r.hold_count>0 or r.exception_count>0 then raise exception 'Resolve payroll holds and exceptions first'; end if;
  for i in select * from public.workforce_payroll_items where company_id=p_company and payroll_run_id=p_run and status='ready' order by id for update loop
    if i.net_amount<0 then raise exception 'Negative payroll items require correction'; end if;
    if i.net_amount=0 then continue; end if;
    if nullif(btrim(i.bank_account_no),'') is null or nullif(btrim(i.ifsc_code),'') is null then raise exception 'A frozen payroll beneficiary is incomplete'; end if;
    select min(s.id::text)::uuid into station from public.stations s where s.company_id=p_company and s.station_code=i.station_code having count(*)=1;
    if station is null then raise exception 'Resolve the frozen payroll station before Finance handoff'; end if;
    payment:=gen_random_uuid();
    insert into public.payment_requests(id,company_id,request_no,location_id,location_code,station_code,payment_head_id,category,work_date,
      requested_for_name,amount,amount_requested,payment_mode,bank_account_no,ifsc,account_holder_name,beneficiary_account_no,beneficiary_account_number,beneficiary_ifsc,beneficiary_account_holder,
      remarks,status,approval_status,current_step,current_step_order,current_approver_role_id,current_approver_role_ids,final_approval_role_id,final_approval_role_ids,payment_process_role_ids,requested_by,
      source_type,source_id,source_system,source_record_id,details)
    values(payment,p_company,'WF'||upper(substr(replace(payment::text,'-',''),1,12)),station,i.station_code,i.station_code,h.id,'workforce_payroll',r.period_end,
      i.worker_name,i.net_amount,i.net_amount,'account_transfer',i.bank_account_no,i.ifsc_code,i.worker_name,i.bank_account_no,i.bank_account_no,i.ifsc_code,i.worker_name,
      r.run_number||' · '||i.dropx_id||' · '||r.period_start||' to '||r.period_end,'pending','PENDING','FINANCE',case when approval_roles=final_roles then 2 else 1 end,
      approval_roles[1],approval_roles,final_roles[1],final_roles,h.payment_process_role_ids,p_actor,
      'workforce_payroll',i.id,'WORKFORCE_PAYROLL',i.id::text,jsonb_build_object('payroll_run_id',r.id,'run_number',r.run_number,'dropx_id',i.dropx_id,'period_start',r.period_start,'period_end',r.period_end));
    insert into public.workforce_payroll_finance_links(company_id,payroll_run_id,payroll_item_id,payment_request_id) values(p_company,p_run,i.id,payment);
    n:=n+1;
  end loop;
  if n=0 then raise exception 'No positive ready payroll items are available for Finance'; end if;
  update public.workforce_payroll_runs set finance_sent_at=now() where id=p_run and company_id=p_company;
  insert into public.workforce_payroll_events(company_id,payroll_run_id,event_code,actor_user_id,remarks,metadata)
    values(p_company,p_run,'finance_submitted',p_actor,'Sent to Finance approval; no bank transfer has been made',jsonb_build_object('payment_requests',n));
  return n;
end $$;

create function public.workforce_finance_run_transition() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.status='approved' and old.status='review' then perform public.workforce_enqueue_finance(new.company_id,new.id,new.approved_by); end if;
  return new;
end $$;
create trigger workforce_finance_run_transition after update of status on public.workforce_payroll_runs for each row execute function public.workforce_finance_run_transition();

create function public.workforce_confirm_payroll(p_company uuid,p_run uuid,p_actor uuid,p_head uuid,p_owner boolean,p_remarks text)
returns void language plpgsql security invoker set search_path='' as $$
declare r public.workforce_payroll_runs;
begin
  select * into r from public.workforce_payroll_runs where company_id=p_company and id=p_run for update;
  if not found or p_owner is not true or p_actor is null then raise exception 'Owner confirmation is required'; end if;
  if r.status='approved' and r.finance_sent_at is not null then return; end if;
  if not exists(select 1 from public.payment_heads where id=p_head and company_id=p_company and is_active) then raise exception 'Select an active payroll payment head configured in Finance'; end if;
  if r.status='approved' and r.finance_sent_at is null then
    update public.workforce_payroll_runs set finance_payment_head_id=p_head where company_id=p_company and id=p_run;
    perform public.workforce_enqueue_finance(p_company,p_run,p_actor);
    return;
  end if;
  if r.status<>'review' or r.submitted_by=p_actor then raise exception 'Another owner must approve the reviewed payroll'; end if;
  update public.workforce_payroll_runs set finance_payment_head_id=p_head where company_id=p_company and id=p_run;
  perform public.workforce_change_payroll_state(p_company,p_run,p_actor,'approve',true,p_remarks,null,null);
end $$;

create function public.workforce_finance_payment_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare l public.workforce_payroll_finance_links; i public.workforce_payroll_items;
begin
  select * into l from public.workforce_payroll_finance_links where payment_request_id=old.id;
  if not found then if tg_op='DELETE' then return old; else return new; end if; end if;
  if tg_op='DELETE' then raise exception 'Linked payroll payments cannot be deleted'; end if;
  perform 1 from public.workforce_payroll_runs where id=l.payroll_run_id and company_id=l.company_id for update;
  select * into i from public.workforce_payroll_items where id=l.payroll_item_id and company_id=l.company_id;
  if new.company_id is distinct from old.company_id or new.source_id is distinct from old.source_id or new.source_type is distinct from old.source_type
    or new.source_system is distinct from old.source_system or new.source_record_id is distinct from old.source_record_id
    or new.amount is distinct from i.net_amount or new.amount_requested is distinct from i.net_amount
    or new.bank_account_no is distinct from i.bank_account_no or new.beneficiary_account_no is distinct from i.bank_account_no or new.beneficiary_account_number is distinct from i.bank_account_no
    or new.ifsc is distinct from i.ifsc_code or new.beneficiary_ifsc is distinct from i.ifsc_code
    or new.payment_mode is distinct from 'account_transfer' or new.account_holder_name is distinct from i.worker_name or new.beneficiary_account_holder is distinct from i.worker_name then
    raise exception 'Payroll beneficiary and amount are frozen; return the request for payroll correction instead';
  end if;
  if old.status='processed' and (new.status is distinct from old.status or new.utr_cin is distinct from old.utr_cin) then raise exception 'A paid payroll request needs a separately approved reversal'; end if;
  if new.status in ('processing','processed') and old.status not in ('approved','processing','processed') then raise exception 'Finance approval is required before payroll payment processing'; end if;
  if new.status='processed' and (nullif(btrim(new.utr_cin),'') is null or new.processed_at is null or new.updated_by is null) then raise exception 'A bank reference, payment time and Finance processor are required'; end if;
  return new;
end $$;
create trigger workforce_finance_payment_guard before update or delete on public.payment_requests for each row execute function public.workforce_finance_payment_guard();

create function public.workforce_finance_payment_sync() returns trigger language plpgsql security invoker set search_path='' as $$
declare l public.workforce_payroll_finance_links;
begin
  if new.status is not distinct from old.status then return new; end if;
  select * into l from public.workforce_payroll_finance_links where payment_request_id=new.id and company_id=new.company_id;
  if not found then return new; end if;
  insert into public.workforce_payroll_events(company_id,payroll_run_id,event_code,actor_user_id,remarks,metadata)
    values(l.company_id,l.payroll_run_id,'finance_'||new.status,new.updated_by,'Finance payment '||new.request_no||': '||new.status,
      jsonb_build_object('payroll_item_id',l.payroll_item_id,'payment_request_id',new.id,'payment_reference',new.utr_cin));
  if new.status='processed' then
    update public.workforce_payroll_items set status='paid',updated_at=now() where id=l.payroll_item_id and company_id=l.company_id;
    if not exists(select 1 from public.workforce_payroll_finance_links x join public.payment_requests p on p.id=x.payment_request_id where x.company_id=l.company_id and x.payroll_run_id=l.payroll_run_id and p.status<>'processed') then
      update public.workforce_payroll_runs set status='paid',paid_at=now(),paid_by=new.updated_by,payment_reference='Finance reconciled · see individual payment references',payment_date=(new.processed_at at time zone 'Asia/Kolkata')::date,updated_at=now() where id=l.payroll_run_id and company_id=l.company_id and status='approved';
    end if;
  end if;
  return new;
end $$;
create trigger workforce_finance_payment_sync after update of status on public.payment_requests for each row execute function public.workforce_finance_payment_sync();

create function public.workforce_finance_paid_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.status='paid' and old.status<>'paid' and (old.finance_sent_at is null or not exists(select 1 from public.workforce_payroll_finance_links where company_id=new.company_id and payroll_run_id=new.id) or exists(
    select 1 from public.workforce_payroll_finance_links l join public.payment_requests p on p.id=l.payment_request_id where l.company_id=new.company_id and l.payroll_run_id=new.id and p.status<>'processed')) then
    raise exception 'Finance must approve and reconcile every payment before payroll is marked paid';
  end if;
  return new;
end $$;
create trigger workforce_finance_paid_guard before update of status on public.workforce_payroll_runs for each row execute function public.workforce_finance_paid_guard();

revoke all on function public.workforce_enqueue_finance(uuid,uuid,uuid),public.workforce_confirm_payroll(uuid,uuid,uuid,uuid,boolean,text),public.workforce_finance_run_transition(),public.workforce_finance_payment_guard(),public.workforce_finance_payment_sync(),public.workforce_finance_paid_guard() from public,anon,authenticated;
grant execute on function public.workforce_enqueue_finance(uuid,uuid,uuid),public.workforce_confirm_payroll(uuid,uuid,uuid,uuid,boolean,text),public.workforce_finance_run_transition(),public.workforce_finance_payment_guard(),public.workforce_finance_payment_sync(),public.workforce_finance_paid_guard() to service_role;
commit;
