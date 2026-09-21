begin;
-- Recorded-history preflight only. An empty ledger is NOT a no-dues certificate.
create function public.workforce_exit_recorded_checks(p_company uuid,p_workforce uuid,p_locations uuid[])
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare w public.workforce; total_items bigint; unresolved_items bigint; unposted bigint; broken_posted bigint; holds bigint; windows bigint;
begin
 select * into w from public.workforce where company_id=p_company and id=p_workforce and deleted_at is null and migration_state<>'reclassified';
 if not found then raise exception 'Choose a canonical Workforce associate';end if;
 if p_locations is not null and (w.location_id is null or not(w.location_id=any(p_locations))) then raise exception 'Associate is outside your station scope';end if;
 select count(*),count(*) filter(where not (
   r.status in('approved','paid') and i.status='paid' and i.net_amount>0
   and i.net_amount::text not in('NaN','Infinity','-Infinity')
   and i.gross_amount::text not in('NaN','Infinity','-Infinity') and i.deduction_amount::text not in('NaN','Infinity','-Infinity')
   and i.gross_amount-i.deduction_amount=i.net_amount
   and exists(select 1 from public.workforce_payroll_finance_links l join public.payment_requests p on p.id=l.payment_request_id and p.company_id=l.company_id
     where l.company_id=i.company_id and l.payroll_item_id=i.id and l.payroll_run_id=i.payroll_run_id
       and p.status='processed' and p.amount=i.net_amount and nullif(btrim(p.utr_cin),'') is not null and p.processed_at is not null and isfinite(p.processed_at))
 ) is true) into total_items,unresolved_items
 from public.workforce_payroll_items i left join public.workforce_payroll_runs r on r.id=i.payroll_run_id and r.company_id=i.company_id
 where i.company_id=p_company and i.workforce_id=p_workforce and coalesce(r.status,'missing')<>'cancelled';
 select count(*) filter(where a.status in('draft','pending','approved')),
 count(*) filter(where a.status='posted' and 1<>(select count(*) from public.workforce_payroll_lines l
   join public.workforce_payroll_items i on i.id=l.payroll_item_id and i.company_id=l.company_id and i.payroll_run_id=l.payroll_run_id
   join public.workforce_payroll_runs r on r.id=i.payroll_run_id and r.company_id=i.company_id
   where l.company_id=a.company_id and l.workforce_id=a.workforce_id and i.workforce_id=a.workforce_id
     and l.payroll_run_id=a.payroll_run_id and l.source_type='adjustment' and l.source_id=a.id
     and l.work_date=a.effective_date and l.base_amount=0 and l.incentive_amount=0
     and l.adjustment_amount=(case when a.adjustment_type='deduction' then -a.amount else a.amount end)
     and l.net_amount=l.adjustment_amount and r.status in('approved','paid') and i.status='paid'))
 into unposted,broken_posted from public.workforce_adjustments a where a.company_id=p_company and a.workforce_id=p_workforce;
 select count(*) into holds from public.workforce_payment_holds where company_id=p_company and workforce_id=p_workforce and status<>'released';
 select count(*) into windows from public.workforce_pooled_agreements a where a.company_id=p_company and a.workforce_id=p_workforce
   and not exists(select 1 from public.workforce_pooled_settlements s where s.company_id=a.company_id and s.agreement_id=a.id and s.status='approved');
 return jsonb_build_object('payroll_items',total_items,'unreconciled_payroll',unresolved_items,'unposted_adjustments',unposted,
   'unreconciled_posted_adjustments',broken_posted,'active_holds',holds,'unsettled_windows',windows);
end $$;
revoke all on function public.workforce_exit_recorded_checks(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.workforce_exit_recorded_checks(uuid,uuid,uuid[]) to service_role;

-- A final-period payment cannot hide an earlier unproven payment or orphan claim.
-- Existing reconcile RPC already locks the case/run/associate; do not reorder those locks.
create function public.workforce_exit_recorded_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare evidence jsonb;
begin
 if new.profile_type='workforce' and new.status='settled' and old.status is distinct from new.status then
  evidence:=public.workforce_exit_recorded_checks(new.company_id,new.profile_id,null);
  if (evidence->>'payroll_items')::bigint=0 then raise exception 'No recorded payroll is not proof of no dues. Complete the earnings and Finance review before closing the exit';end if;
  if (evidence->>'unreconciled_payroll')::bigint>0 then raise exception 'Reconcile individual Finance evidence for every recorded payroll period before closing the exit';end if;
  if (evidence->>'unposted_adjustments')::bigint>0 or (evidence->>'unreconciled_posted_adjustments')::bigint>0 then raise exception 'Reconcile outstanding adjustments and their exact paid payroll lines before closing the exit';end if;
  if (evidence->>'active_holds')::bigint>0 or (evidence->>'unsettled_windows')::bigint>0 then raise exception 'Resolve active holds and accepted pooled windows before closing the exit';end if;
 end if;
 return new;
end $$;
create trigger workforce_exit_recorded_guard before update of status on public.workforce_lifecycle_cases for each row execute function public.workforce_exit_recorded_guard();
revoke all on function public.workforce_exit_recorded_guard() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
