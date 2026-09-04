begin;

-- Server-only operations: callers authorize product/page/station scope before RPC.
-- SECURITY INVOKER and explicit EXECUTE grants keep these unavailable to Data API clients.
alter table public.workforce_payroll_runs add column if not exists payment_reference text;
alter table public.workforce_payroll_runs add column if not exists payment_date date;

create or replace function public.workforce_refresh_payroll_totals(p_company uuid, p_run uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.workforce_payroll_runs where id=p_run and company_id=p_company for update;
  update public.workforce_payroll_runs r set
    worker_count=x.workers, shipment_count=x.shipments, base_amount=x.base,
    incentive_amount=x.incentive, adjustment_amount=x.additions, deduction_amount=x.deductions,
    net_amount=x.net, ready_count=x.ready, hold_count=x.holds, updated_at=now()
  from (select count(*)::int workers,
    coalesce(sum(shipment_count) filter(where status<>'excluded'),0) shipments,
    coalesce(sum(base_amount) filter(where status<>'excluded'),0) base,
    coalesce(sum(incentive_amount) filter(where status<>'excluded'),0) incentive,
    coalesce(sum(adjustment_amount) filter(where status<>'excluded'),0) additions,
    coalesce(sum(deduction_amount) filter(where status<>'excluded'),0) deductions,
    coalesce(sum(net_amount) filter(where status in ('ready','paid')),0) net,
    count(*) filter(where status in ('ready','paid'))::int ready,
    count(*) filter(where status='hold')::int holds
    from public.workforce_payroll_items where company_id=p_company and payroll_run_id=p_run) x
  where r.company_id=p_company and r.id=p_run;
end $$;

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
    insert into public.workforce_payroll_runs(id,company_id,run_number,period_start,period_end,status,created_by)
    values(v_id,p_company,p_run->>'run_number',(p_run->>'period_start')::date,(p_run->>'period_end')::date,'draft',p_actor);
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

create or replace function public.workforce_change_payroll_state(
  p_company uuid,p_run uuid,p_actor uuid,p_action text,p_owner boolean,p_remarks text,p_reference text,p_payment_date date
) returns void language plpgsql security invoker set search_path = '' as $$
declare r public.workforce_payroll_runs; v_next text;
begin
  select * into r from public.workforce_payroll_runs where id=p_run and company_id=p_company for update;
  if not found then raise exception 'Payroll was not found'; end if;
  if p_actor is null then raise exception 'Actor is required'; end if;
  if p_action in ('approve','paid','cancel','return') and p_owner is not true then raise exception 'Owner approval is required'; end if;
  if p_action='submit' then
    if r.status<>'draft' or r.hold_count>0 or r.exception_count>0 then raise exception 'Submit a clean draft with no holds or source exceptions'; end if;
    v_next:='review';
    update public.workforce_payroll_runs set submitted_by=p_actor,submitted_at=now() where id=p_run;
  elsif p_action='approve' then
    if r.status<>'review' or r.submitted_by=p_actor then raise exception 'Another owner must approve a submitted payroll'; end if;
    v_next:='approved';
    update public.workforce_payroll_runs set approved_by=p_actor,approved_at=now(),approval_remarks=p_remarks where id=p_run;
  elsif p_action='paid' then
    if r.status='paid' and r.payment_reference=p_reference and r.payment_date=p_payment_date then return; end if;
    if r.status<>'approved' then raise exception 'Only approved payroll can be marked paid'; end if;
    if nullif(btrim(p_reference),'') is null or p_payment_date is null or p_payment_date>(now() at time zone 'Asia/Kolkata')::date then raise exception 'A payment reference and valid payment date are required'; end if;
    v_next:='paid';
    update public.workforce_payroll_items set status='paid',updated_at=now() where company_id=p_company and payroll_run_id=p_run and status='ready';
    update public.workforce_payroll_runs set paid_by=p_actor,paid_at=now(),payment_reference=p_reference,payment_date=p_payment_date where id=p_run;
  elsif p_action='cancel' then
    if r.status='cancelled' then return; end if;
    if r.status not in ('draft','review') then raise exception 'Approved payroll cannot be cancelled'; end if;
    v_next:='cancelled';
    update public.workforce_adjustments set status='approved',payroll_run_id=null,updated_at=now() where company_id=p_company and payroll_run_id=p_run and status='posted';
  elsif p_action='return' then
    if r.status<>'review' or nullif(btrim(p_remarks),'') is null then raise exception 'Return a reviewed payroll with a correction reason'; end if;
    v_next:='draft';
    update public.workforce_payroll_runs set status='draft',submitted_by=null,submitted_at=null where id=p_run;
  else raise exception 'Invalid payroll action'; end if;
  update public.workforce_payroll_runs set status=v_next,updated_at=now() where id=p_run;
  insert into public.workforce_payroll_events(company_id,payroll_run_id,event_code,from_status,to_status,actor_user_id,remarks)
    values(p_company,p_run,'run_'||v_next,r.status,v_next,p_actor,p_remarks);
end $$;

create or replace function public.workforce_set_payroll_item(p_company uuid,p_run uuid,p_item uuid,p_actor uuid,p_disposition text)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_status text; i public.workforce_payroll_items;
begin
  select status into v_status from public.workforce_payroll_runs where company_id=p_company and id=p_run for update;
  if v_status is distinct from 'draft' then raise exception 'Items can only change in a draft payroll'; end if;
  select * into i from public.workforce_payroll_items where company_id=p_company and payroll_run_id=p_run and id=p_item for update;
  if not found or p_disposition not in ('exclude','restore') then raise exception 'Invalid payroll item action'; end if;
  update public.workforce_payroll_items set status=case when p_disposition='exclude' then 'excluded' when jsonb_array_length(i.hold_reasons)>0 then 'hold' else 'ready' end,updated_at=now() where id=p_item;
  perform public.workforce_refresh_payroll_totals(p_company,p_run);
  insert into public.workforce_payroll_events(company_id,payroll_run_id,event_code,actor_user_id,metadata)
    values(p_company,p_run,'item_'||p_disposition,p_actor,jsonb_build_object('itemId',p_item));
end $$;

create or replace function public.workforce_save_mapping(p_company uuid,p_actor uuid,p_workforce uuid,p_mapping uuid,p_dropx text,p_payload jsonb,p_locations uuid[])
returns void language plpgsql security invoker set search_path = '' as $$
declare w public.workforce; m public.field_executive_provider_mappings; v_old public.field_executive_provider_mappings;
begin
  select * into w from public.workforce where company_id=p_company and id=p_workforce and deleted_at is null and migration_state<>'reclassified' for update;
  if not found then raise exception 'Workforce profile was not found'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_company::text || (p_payload->>'provider_id') || (p_payload->>'provider_member_id'),0));
  m:=jsonb_populate_record(null::public.field_executive_provider_mappings,p_payload);
  if p_locations is not null and (w.location_id is null or m.station_id is null or not(w.location_id=any(p_locations)) or not(m.station_id=any(p_locations))) then raise exception 'Mapping is outside your station scope'; end if;
  if not exists(select 1 from public.stations where company_id=p_company and id=m.station_id and provider_id=m.provider_id) then raise exception 'Provider and station do not match'; end if;
  if p_mapping is not null then
    select * into v_old from public.field_executive_provider_mappings where company_id=p_company and id=p_mapping for update;
    if not found or v_old.workforce_id is distinct from p_workforce then raise exception 'Mapping does not belong to this associate'; end if;
    if p_locations is not null and v_old.station_id is not null and not(v_old.station_id=any(p_locations)) then raise exception 'Existing mapping is outside your station scope'; end if;
    if m.effective_from<v_old.effective_from then raise exception 'A mapping version cannot start before its existing period'; end if;
    if m.effective_from>v_old.effective_from then
      update public.field_executive_provider_mappings set effective_to=m.effective_from-1,status='closed',updated_at=now() where id=p_mapping;
      p_mapping:=null;
    end if;
  end if;
  if exists(select 1 from public.field_executive_provider_mappings x where x.company_id=p_company and x.provider_id=m.provider_id
    and x.provider_member_id=m.provider_member_id and x.station_id=m.station_id and x.status<>'cancelled'
    and x.id<>coalesce(p_mapping,'00000000-0000-0000-0000-000000000000'::uuid)
    and daterange(x.effective_from,x.effective_to,'[]') && daterange(m.effective_from,m.effective_to,'[]')) then raise exception 'Provider ID already has an overlapping mapping'; end if;
  if p_mapping is null then
    insert into public.field_executive_provider_mappings(company_id,workforce_id,provider_id,station_id,provider_member_id,effective_from,effective_to,payment_method_id,payment_values,pay_type,status,created_by)
      values(p_company,p_workforce,m.provider_id,m.station_id,m.provider_member_id,m.effective_from,m.effective_to,m.payment_method_id,m.payment_values,m.pay_type,m.status,p_actor);
  else
    update public.field_executive_provider_mappings set provider_id=m.provider_id,station_id=m.station_id,provider_member_id=m.provider_member_id,
      effective_to=m.effective_to,payment_method_id=m.payment_method_id,payment_values=m.payment_values,pay_type=m.pay_type,
      delivery_rate=null,pickup_rate=null,mfn_rate=null,mfn_return_rate=null,guarantee_amount=null,guarantee_schedule=null,fuel_rate=null,reason=null,
      status=m.status,updated_at=now() where id=p_mapping;
  end if;
  update public.workforce set dropx_id=p_dropx,location_id=m.station_id,updated_at=now() where id=p_workforce;
end $$;

create or replace function public.workforce_assign_shift(p_company uuid,p_actor uuid,p_workforce uuid,p_shift uuid,p_from date,p_to date,p_notes text,p_locations uuid[])
returns uuid language plpgsql security invoker set search_path = '' as $$
declare w public.workforce; v_id uuid;
begin
  select * into w from public.workforce where company_id=p_company and id=p_workforce and deleted_at is null and migration_state<>'reclassified' for update;
  if not found or not w.is_active or w.onboarding_status<>'active' then raise exception 'Choose an activated Workforce associate'; end if;
  if p_locations is not null and (w.location_id is null or not(w.location_id=any(p_locations))) then raise exception 'Associate is outside your station scope'; end if;
  if p_from is null or p_to is null or p_to<p_from or p_to>p_from+92 then raise exception 'Choose a roster period of at most 93 days'; end if;
  if not exists(select 1 from public.hr_shifts where id=p_shift and company_id=p_company and is_active) then raise exception 'Choose an active company shift'; end if;
  if exists(select 1 from public.hr_contractor_shift_assignments where workforce_id=p_workforce and company_id=p_company and daterange(effective_from,effective_to,'[]') && daterange(p_from,p_to,'[]')) then raise exception 'This associate already has a shift in the selected period'; end if;
  insert into public.hr_contractor_shift_assignments(company_id,workforce_id,shift_id,effective_from,effective_to,notes,created_by)
    values(p_company,p_workforce,p_shift,p_from,p_to,p_notes,p_actor) returning id into v_id;
  return v_id;
end $$;

create or replace function public.workforce_complete_settlement(
 p_company uuid,p_case uuid,p_actor uuid,p_status text,p_gross numeric,p_deductions numeric,p_reference text,p_payment_date date,p_checklist jsonb,p_locations uuid[]
) returns void language plpgsql security invoker set search_path = '' as $$
declare c public.workforce_lifecycle_cases; v_date date; v_table text; v_changed int;
begin
 select * into c from public.workforce_lifecycle_cases where id=p_case and company_id=p_company for update;
 if not found then raise exception 'Exit case was not found'; end if;
 if p_locations is not null and (c.profile_location_id is null or not(c.profile_location_id=any(p_locations))) then raise exception 'Exit is outside your station scope'; end if;
 if c.status='settled' then return; end if;
 if c.status<>'settlement_pending' then raise exception 'Exit is not awaiting settlement'; end if;
 if p_status not in ('paid','waived') or p_actor is null then raise exception 'Choose a settlement outcome'; end if;
 if p_gross is null or p_deductions is null or p_gross<0 or p_deductions<0 or p_gross::text in ('NaN','Infinity','-Infinity') or p_deductions::text in ('NaN','Infinity','-Infinity') then raise exception 'Settlement amounts must be finite and nonnegative'; end if;
 if nullif(btrim(p_reference),'') is null then raise exception 'Record the payment reference or waiver reason'; end if;
 if p_status='paid' and (p_payment_date is null or p_payment_date>(now() at time zone 'Asia/Kolkata')::date) then raise exception 'Record a valid payment date'; end if;
 v_date:=coalesce(c.approved_effective_date,c.requested_effective_date);
 if v_date>(now() at time zone 'Asia/Kolkata')::date then raise exception 'Complete deactivation on or after the approved last working date'; end if;
 if exists(select 1 from public.workforce_exit_checklist_master m where m.company_id=p_company and m.is_active and m.is_required
   and not exists(select 1 from jsonb_array_elements(p_checklist) x where (x->>'checklist_item_id')::uuid=m.id and x->>'status'='completed')) then raise exception 'Complete every required exit check'; end if;
 insert into public.workforce_exit_checklist_results(company_id,lifecycle_case_id,checklist_item_id,status,completed_by,completed_at)
 select p_company,p_case,(x->>'checklist_item_id')::uuid,x->>'status',p_actor,now() from jsonb_array_elements(p_checklist) x
 on conflict(lifecycle_case_id,checklist_item_id) do update set status=excluded.status,completed_by=excluded.completed_by,completed_at=excluded.completed_at,updated_at=now();
 insert into public.workforce_final_settlements(company_id,lifecycle_case_id,status,gross_amount,deduction_amount,payment_reference,payment_date,approved_by,approved_at,paid_by,paid_at)
 values(p_company,p_case,p_status,p_gross,p_deductions,p_reference,p_payment_date,p_actor,now(),case when p_status='paid' then p_actor end,case when p_status='paid' then now() end)
 on conflict(lifecycle_case_id) do update set status=excluded.status,gross_amount=excluded.gross_amount,deduction_amount=excluded.deduction_amount,payment_reference=excluded.payment_reference,payment_date=excluded.payment_date,approved_by=p_actor,approved_at=now(),paid_by=excluded.paid_by,paid_at=excluded.paid_at,updated_at=now();
 v_table:=case c.profile_type when 'workforce' then 'workforce' when 'vendor' then 'vendors' when 'worker' then 'workers' else null end;
 if v_table is null then raise exception 'Exit requires a canonical Workforce or operations profile'; end if;
 execute format('update public.%I set onboarding_status=''cancelled'',lifecycle_status=''exited'',last_working_date=$1,deactivated_at=now(),deactivated_by=$2,is_active=false,updated_at=now() where company_id=$3 and id=$4',v_table) using v_date,p_actor,p_company,c.profile_id;
 get diagnostics v_changed = row_count;
 if v_changed<>1 then raise exception 'Exit profile was not found'; end if;
 update public.biometric_enrolments set status='Inactive',effective_to=v_date,updated_at=now() where company_id=p_company and profile_type=c.profile_type and account_id=c.profile_id and effective_to is null;
 update public.workforce_lifecycle_cases set status='settled',updated_at=now() where id=p_case;
 insert into public.workforce_lifecycle_events(company_id,lifecycle_case_id,profile_type,profile_id,event_code,from_status,to_status,actor_user_id,source_portal,remarks)
 values(p_company,p_case,c.profile_type,c.profile_id,'exit_settled_and_deactivated',c.status,'settled',p_actor,'workforce',p_reference);
end $$;
revoke all on function public.workforce_complete_settlement(uuid,uuid,uuid,text,numeric,numeric,text,date,jsonb,uuid[]) from public,anon,authenticated;
grant execute on function public.workforce_complete_settlement(uuid,uuid,uuid,text,numeric,numeric,text,date,jsonb,uuid[]) to service_role;

revoke all on function public.workforce_refresh_payroll_totals(uuid,uuid) from public,anon,authenticated;
revoke all on function public.workforce_save_payroll_snapshot(uuid,uuid,jsonb,jsonb,jsonb,uuid[]) from public,anon,authenticated;
revoke all on function public.workforce_change_payroll_state(uuid,uuid,uuid,text,boolean,text,text,date) from public,anon,authenticated;
revoke all on function public.workforce_set_payroll_item(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.workforce_save_mapping(uuid,uuid,uuid,uuid,text,jsonb,uuid[]) from public,anon,authenticated;
revoke all on function public.workforce_assign_shift(uuid,uuid,uuid,uuid,date,date,text,uuid[]) from public,anon,authenticated;
grant execute on function public.workforce_refresh_payroll_totals(uuid,uuid) to service_role;
grant execute on function public.workforce_save_payroll_snapshot(uuid,uuid,jsonb,jsonb,jsonb,uuid[]) to service_role;
grant execute on function public.workforce_change_payroll_state(uuid,uuid,uuid,text,boolean,text,text,date) to service_role;
grant execute on function public.workforce_set_payroll_item(uuid,uuid,uuid,uuid,text) to service_role;
grant execute on function public.workforce_save_mapping(uuid,uuid,uuid,uuid,text,jsonb,uuid[]) to service_role;
grant execute on function public.workforce_assign_shift(uuid,uuid,uuid,uuid,date,date,text,uuid[]) to service_role;

notify pgrst, 'reload schema';
commit;
