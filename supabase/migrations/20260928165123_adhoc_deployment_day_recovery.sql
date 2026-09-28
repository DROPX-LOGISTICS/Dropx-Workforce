begin;
-- No payments, rates, mappings or historical payroll are changed by this release.
-- Multiple requests for one provider/day reference the same deduction receipt.
alter table public.payment_requests drop constraint if exists payment_requests_adhoc_adjustment_id_key;
create index if not exists payment_requests_adhoc_adjustment_lookup on public.payment_requests(adhoc_adjustment_id) where adhoc_adjustment_id is not null;
-- Service-only receipt ledger: one processed request may share one day deduction.
create table public.workforce_adhoc_recoveries (
  payment_request_id uuid primary key references public.payment_requests(id),
  company_id uuid not null references public.companies(id),
  state text not null check(state in ('pending_mapping','pending_date','pending_source','pending_rate','applied','zero','error')),
  reason text not null,
  adjustment_id uuid references public.workforce_adjustments(id),
  workforce_id uuid references public.workforce(id),
  deployment_date date,
  recovery_key text,
  source_hash text,
  calculation jsonb not null default '{}',
  checked_at timestamptz not null default now(),
  check(state <> 'applied' or adjustment_id is not null)
);
alter table public.workforce_adhoc_recoveries enable row level security;
revoke all on public.workforce_adhoc_recoveries from public,anon,authenticated;
grant select,insert,update on public.workforce_adhoc_recoveries to service_role;
create index workforce_adhoc_recovery_company on public.workforce_adhoc_recoveries(company_id,state);
create index workforce_adhoc_recovery_adjustment on public.workforce_adhoc_recoveries(adjustment_id) where adjustment_id is not null;
create index workforce_adhoc_recovery_worker on public.workforce_adhoc_recoveries(workforce_id) where workforce_id is not null;

-- Preserve all identity, paid-amount and delete guards; replace ONLY cash recovery.
-- Fail closed if another release changed the expected function structure.
do $migration$
declare body text; start_pos integer; end_pos integer;
begin
  body:=pg_get_functiondef('public.payment_adhoc_da_guard()'::regprocedure);
  start_pos:=strpos(body, '  if lower(new.status) in (''processed'',''paid'') and new.adhoc_adjustment_id is null then');
  end_pos:=strpos(body, '  return new;'||chr(10)||'end');
  if start_pos=0 or end_pos<=start_pos or strpos(body,'System recovery of Finance-processed payment')=0 then
    raise exception 'Adhoc guard differs from the verified reference-only version; review migration';
  end if;
  body:=substr(body,1,start_pos-1)||$replacement$
  -- Payment is never contingent on a mapping, shipment import or rate card.
  -- The Workforce worker resolves the actual deployment day asynchronously.
  if lower(new.status) in ('processed','paid') and new.adhoc_adjustment_id is null then
    -- Shares the existing payroll-confirmation lock, but never requires mapping.
    perform 1 from public.workforce where company_id=new.company_id order by id for update;
    new.adhoc_recovery_checked_at:=now();
    select r.adjustment_id,r.workforce_id into new.adhoc_adjustment_id,new.adhoc_workforce_id
    from public.workforce_adhoc_recoveries r
    where r.payment_request_id=new.id and r.company_id=new.company_id and r.state='applied';
  end if;
$replacement$||substr(body,end_pos);
  execute body;
end $migration$;

-- A single consistent snapshot feeds the same TypeScript calculator as payroll.
-- No browser-supplied Workforce identity or deduction amount is accepted.
create function public.workforce_adhoc_recovery_context(p_request uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.payment_requests; day_text text; day_value date; station_code_value text;
  member text; members text[]; result jsonb; source_input jsonb;
begin
  select * into r from public.payment_requests where id=p_request;
  if not found or r.source_system is distinct from 'OPS_ADHOC_DA' or lower(r.status) not in ('processed','paid') or r.adhoc_adjustment_id is not null then return null; end if;
  select s.station_code into station_code_value from public.stations s where s.company_id=r.company_id and s.id=r.location_id;
  select case when count(distinct a.answer_value)=1 then min(a.answer_value) end into day_text
  from public.payment_request_answers a join public.payment_head_questions q on q.id=a.question_id and q.company_id=a.company_id
  where a.company_id=r.company_id and a.payment_request_id=r.id and q.payment_head_id=r.payment_head_id
    and q.answer_type='date' and lower(btrim(q.question_text))='deployment date';
  begin
    if day_text ~ '^\d{4}-\d{2}-\d{2}$' then day_value:=day_text::date; end if;
  exception when invalid_datetime_format or datetime_field_overflow then day_value:=null;
  end;
  member:=nullif(btrim(r.adhoc_provider_employee_id),'');
  if member is null and day_value is not null then
    select array_agg(distinct btrim(s.provider_employee_id)) into members from public.cps_shipment_daily s
    where s.company_id=r.company_id and s.station_code=station_code_value and lower(s.client)='amazon'
      and s.work_date=day_value and btrim(s.provider_employee_name)=btrim(r.adhoc_da_name)
      and nullif(btrim(s.provider_employee_id),'') is not null;
    if cardinality(members)=1 then member:=members[1]; end if;
  end if;
  if member ~* '^[0-9]+([.][0-9]+)?e[+-]?[0-9]+$' then member:=null; end if;
  select jsonb_build_object(
    'from',day_value,'to',day_value,'adjustments','[]'::jsonb,'campaigns','[]'::jsonb,
    'shipments',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from public.cps_shipment_daily s where s.company_id=r.company_id and lower(s.client)='amazon' and s.work_date=day_value),'[]'),
    'mappings',coalesce((select jsonb_agg(to_jsonb(m) order by m.id) from public.field_executive_provider_mappings m where m.company_id=r.company_id and m.status<>'cancelled' and m.effective_from<=day_value and (m.effective_to is null or m.effective_to>=day_value)),'[]'),
    'workforce',coalesce((select jsonb_agg(to_jsonb(w) order by w.id) from (
      select w.id,w.full_name,w.dropx_id,w.designation_id,w.location_id,w.source_profile_type,w.source_profile_id,w.onboarding_status,w.lifecycle_status,w.is_active,w.last_working_date,
        'redacted'::text bank_account_no,'redacted'::text ifsc_code
      from public.workforce w where w.company_id=r.company_id and w.deleted_at is null and w.migration_state is distinct from 'reclassified'
    ) w),'[]'),
    'providers',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'code',p.code,'name',p.name) order by p.id) from public.providers p where p.company_id=r.company_id),'[]'),
    'stations',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'station_code',s.station_code) order by s.id) from public.stations s where s.company_id=r.company_id),'[]'),
    'rateCards',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.workforce_rate_cards c where c.company_id=r.company_id and c.status<>'draft' and c.effective_from<=day_value and (c.effective_to is null or c.effective_to>=day_value)),'[]')
  ) into source_input;
  result:=jsonb_build_object('requestId',r.id,'companyId',r.company_id,'stationId',r.location_id,'stationCode',station_code_value,'providerMemberId',member,
    'deploymentDate',day_value,'requestNo',r.request_no,'actor',r.updated_by,'input',source_input);
  return result||jsonb_build_object('hash',md5(result::text));
end $$;

-- Preserve the existing direct-allocation and posted-adjustment guard unchanged.
-- Unresolved recovery blocks payroll finalization, never the Adhoc payment.
create function public.workforce_adhoc_day_pending_gate() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.status in ('review','approved','paid') and new.status is distinct from old.status then
    perform 1 from public.workforce where company_id=new.company_id order by id for update;
    if exists(select 1 from public.payment_requests p
      left join public.workforce_adhoc_recoveries r on r.payment_request_id=p.id
      where p.company_id=new.company_id and p.source_system='OPS_ADHOC_DA' and lower(p.status) in ('processed','paid')
        and p.adhoc_adjustment_id is null and (coalesce(r.state,'pending_date') not in ('applied','zero')
          or (r.state='zero' and (public.workforce_adhoc_recovery_context(p.id)->>'hash') is distinct from r.source_hash))
        and (new.station_id is null or p.location_id=new.station_id)
        and (r.deployment_date is null or r.deployment_date<=new.period_end)) then
      raise exception 'Adhoc deployment-day recovery is awaiting mapping, source or rate reconciliation. Resolve it and recalculate payroll before confirmation; Adhoc payments remain available.';
    end if;
  end if;
  return new;
end $$;
create trigger workforce_adhoc_day_pending_gate before update of status on public.workforce_payroll_runs
for each row execute function public.workforce_adhoc_day_pending_gate();

create function public.workforce_adhoc_recovery_candidates() returns setof uuid
language sql security invoker set search_path='' as $$
  select p.id from public.payment_requests p left join public.workforce_adhoc_recoveries r on r.payment_request_id=p.id
  where p.source_system='OPS_ADHOC_DA' and lower(p.status) in ('processed','paid') and p.adhoc_adjustment_id is null
    and (r.state is null or r.state <> 'applied')
    and (r.checked_at is null or r.checked_at < now()-interval '5 minutes')
  order by r.checked_at nulls first,p.id limit 40;
$$;

create function public.workforce_finish_adhoc_recovery(p_request uuid,p_hash text,p_quote jsonb) returns text
language plpgsql security invoker set search_path='' set lock_timeout='2s' as $$
declare r public.payment_requests; ctx jsonb; worker uuid; adjustment uuid; recovery_key_value text;
  amount_value numeric; posting date; closed_end date; outcome text:=p_quote->>'state';
begin
  -- Payment row first, then canonical workers: same order as the payment guard.
  select * into r from public.payment_requests where id=p_request for update;
  if r.adhoc_adjustment_id is not null then return 'already_applied'; end if;
  perform 1 from public.workforce where company_id=r.company_id order by id for update;
  -- Serialize calculation with imports, dated mapping/rate edits and date answers.
  lock table public.cps_shipment_daily,public.field_executive_provider_mappings,public.workforce_rate_cards,public.payment_request_answers,public.payment_head_questions,public.providers,public.stations in share mode;
  ctx:=public.workforce_adhoc_recovery_context(p_request);
  if ctx is null or ctx->>'hash' is distinct from p_hash then return 'stale_retry'; end if;
  if outcome not in ('pending_mapping','pending_date','pending_source','pending_rate','applied','zero','error') then raise exception 'Invalid recovery state'; end if;
  worker:=nullif(p_quote->>'workforceId','')::uuid;
  posting:=(ctx->>'deploymentDate')::date;
  if outcome in ('applied','zero') then
    if worker is null or posting is null or ctx->>'providerMemberId' is null or not exists(select 1 from public.workforce w where w.id=worker and w.company_id=r.company_id and w.deleted_at is null) then raise exception 'Incomplete recovery identity'; end if;
    amount_value:=(p_quote->>'amount')::numeric;
    if amount_value is null or amount_value<0 or amount_value::text in ('NaN','Infinity','-Infinity') or (outcome='applied' and amount_value=0) then raise exception 'Invalid recovery amount'; end if;
    -- For daily MG, all provider IDs for the same associate share one day recovery.
    recovery_key_value:='OPS-ADHOC-DA:DAY:'||r.company_id||':'||case when p_quote->>'mode'='daily' then worker::text else r.location_id||':'||(ctx->>'providerMemberId') end||':'||posting;
    perform pg_advisory_xact_lock(hashtextextended(recovery_key_value,0));
    select a.id into adjustment from public.workforce_adjustments a where a.company_id=r.company_id and a.external_reference=recovery_key_value and a.workforce_id=worker;
    if adjustment is null and exists(select 1 from public.workforce_adjustments a where a.company_id=r.company_id and a.external_reference=recovery_key_value) then
      raise exception 'Provider ownership changed after day recovery; reviewed correction required';
    end if;
    if adjustment is not null then outcome:='applied';
    elsif outcome='applied' then
      if r.updated_by is null then raise exception 'Missing payment processor audit identity'; end if;
      loop
        select max(x.period_end) into closed_end from public.workforce_payroll_runs x join public.workforce_payroll_items i on i.payroll_run_id=x.id and i.company_id=x.company_id
        where x.company_id=r.company_id and i.workforce_id=worker and i.status<>'excluded' and x.status in ('approved','paid') and posting between x.period_start and x.period_end;
        exit when closed_end is null; posting:=closed_end+1;
      end loop;
      insert into public.workforce_adjustments(company_id,workforce_id,adjustment_type,category,amount,effective_date,reason,external_reference,status,requested_by,reviewed_by,reviewed_at,review_remarks)
      values(r.company_id,worker,'deduction','cash_recovery',amount_value,posting,
        'Adhoc deployment-day payout exclusion: '||r.request_no||' / '||(ctx->>'deploymentDate')||' / '||(ctx->>'providerMemberId'),
        recovery_key_value,'approved',null,r.updated_by,now(),'Day earnings already covered by Adhoc; replaces cash-amount recovery. '||(p_quote->>'reason')) returning id into adjustment;
    end if;
  end if;
  insert into public.workforce_adhoc_recoveries(payment_request_id,company_id,state,reason,adjustment_id,workforce_id,deployment_date,recovery_key,source_hash,calculation,checked_at)
  values(r.id,r.company_id,outcome,coalesce(p_quote->>'reason','Awaiting reconciliation'),adjustment,worker,(ctx->>'deploymentDate')::date,recovery_key_value,p_hash,p_quote,now())
  on conflict(payment_request_id) do update set state=excluded.state,reason=excluded.reason,adjustment_id=excluded.adjustment_id,workforce_id=excluded.workforce_id,
    deployment_date=excluded.deployment_date,recovery_key=excluded.recovery_key,source_hash=excluded.source_hash,calculation=excluded.calculation,checked_at=excluded.checked_at;
  -- The existing guard attaches only a service-created, company-scoped receipt.
  update public.payment_requests set adhoc_recovery_checked_at=now() where id=r.id;
  return outcome;
end $$;

revoke all on function public.workforce_adhoc_recovery_context(uuid),public.workforce_adhoc_recovery_candidates(),public.workforce_finish_adhoc_recovery(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.workforce_adhoc_day_pending_gate() from public,anon,authenticated;
grant execute on function public.workforce_adhoc_day_pending_gate() to service_role;
grant execute on function public.workforce_adhoc_recovery_context(uuid),public.workforce_adhoc_recovery_candidates(),public.workforce_finish_adhoc_recovery(uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
