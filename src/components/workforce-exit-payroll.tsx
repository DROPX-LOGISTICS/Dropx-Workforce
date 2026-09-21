import {supabaseAdmin} from '@/lib/supabase-admin';
import {readAllRows} from '@/lib/supabase-pagination';
import {PendingLink} from './pending-link';
import {loadRecordedExitChecks} from '@/lib/workforce-exit-recorded-loader';
import {recordedExitBlockers} from '@/lib/workforce-exit-recorded-checks';
import {WorkforceExitReadiness} from './workforce-exit-readiness';
import {requirePagePermission} from '@/lib/authorization';
import {requireCompanyId} from '@/lib/company-scope';

export async function WorkforceExitPayroll({companyId,workforceId,lastDay}:{companyId:string;workforceId:string;lastDay:string}){
  if(!supabaseAdmin)return <p role="alert">Finance records are unavailable. Settlement cannot be completed.</p>;
  const authorization=await requirePagePermission('people_review','access');
  if(requireCompanyId(authorization)!==companyId)return <p role="alert">This exit is outside your company scope.</p>;
  let evidence;
  try{evidence=await Promise.all([
    loadRecordedExitChecks(companyId,workforceId,authorization.hasAllLocationAccess?null:authorization.locationScopeIds),
    readAllRows(supabaseAdmin.from('workforce_payroll_items').select('id,payroll_run_id,status,net_amount,run:workforce_payroll_runs(run_number,period_start,period_end,status)').eq('company_id',companyId).eq('workforce_id',workforceId).order('created_at',{ascending:false}).order('id')),
  ]);}catch{return <p role="alert">Recorded exit checks could not be verified. Retry before closing this exit.</p>;}
  const [checks,result]=evidence;
  if(result.error)return <p role="alert">The payroll ledger could not be verified. Please retry before closing this exit.</p>;
  const rows=(result.data??[]).map(row=>({...row,run:Array.isArray(row.run)?row.run[0]:row.run})).filter(row=>row.run&&row.run.status!=='cancelled');
  const eligible=rows.filter(row=>row.status==='paid'&&row.run.period_start<=lastDay&&row.run.period_end>=lastDay);
  const unpaid=rows.filter(row=>row.status!=='paid');
  const money=(n:unknown)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(Number(n));
  return <div className="workforce-exit-finance">
    <WorkforceExitReadiness checks={checks} workforceId={workforceId}/>
    <h4>Reconcile—not pay again</h4><p>Complete the final payroll through Finance first. Amount, payment date and bank reference come from that payment; this action creates no new payment.</p>
    {unpaid.length?<p role="alert">{unpaid.length} unresolved payroll item(s). Held and excluded items also require a decision before this exit can close.</p>:null}
    <div className="table-wrap"><table><thead><tr><th>Payroll</th><th>Period</th><th>Net amount</th><th>Status</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td><PendingLink href={`/delivery-network/payroll/${row.payroll_run_id}`}>{row.run.run_number}</PendingLink></td><td>{row.run.period_start} — {row.run.period_end}</td><td>{money(row.net_amount)}</td><td>{row.status}</td></tr>)}{!rows.length?<tr><td colSpan={4}>No payroll records. Prepare the final earnings review first.</td></tr>:null}</tbody></table></div>
    <label>Final Finance-paid payroll<select name="payroll_item_id" required disabled={!eligible.length||recordedExitBlockers(checks).length>0} defaultValue=""><option value="">Choose final payroll covering {lastDay}</option>{eligible.map(row=><option key={row.id} value={row.id}>{row.run.run_number} · {money(row.net_amount)}</option>)}</select></label>
    {!eligible.length?<p>There is no paid final payroll covering the last working day. <PendingLink href="/delivery-network/payroll">Open payroll</PendingLink>.</p>:null}
    <label>Final review note<textarea name="review_note" required minLength={10} maxLength={2000} placeholder="Record the periods checked, late imports, expenses, recoveries and handover review."/></label>
    <label><input type="checkbox" name="sources_reviewed" value="true" required/>All work periods, source imports and outstanding claims have been reviewed. Final-period earnings will also be compared with the paid snapshot.</label>
  </div>;
}
