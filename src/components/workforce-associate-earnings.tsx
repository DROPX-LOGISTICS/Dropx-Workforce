import type {AuthorizationContext} from '@/lib/authorization';
import {loadWorkforceEarnings,workforceEarningsDateRange} from '@/lib/workforce-earnings';

export async function WorkforceAssociateEarnings({auth,id,tab,from,to}:{auth:AuthorizationContext;id:string;tab:string;from?:string;to?:string}){
 const period=workforceEarningsDateRange({from,to});
 const snapshot=await loadWorkforceEarnings(auth,period.from,period.to);
 const summary=snapshot.summaries.find(row=>row.workforceId===id);
 const lines=snapshot.lines.filter(row=>row.workforceId===id).sort((a,b)=>b.workDate.localeCompare(a.workDate));
 const money=(n:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(n);
 return <section className="wf-simple-setup">
  <form method="get" className="wf-range-bar"><input type="hidden" name="tab" value={tab}/><input type="hidden" name="person" value={id}/><input type="hidden" name="section" value="earnings"/><label>From<input type="date" name="from" defaultValue={period.from}/></label><label>Through<input type="date" name="to" defaultValue={period.to}/></label><button>Apply period</button></form>
  <p>Live estimate · final deductions and payment status are confirmed in the payout.</p>
  {snapshot.warnings.length?<p role="alert">{snapshot.warnings.join(' ')}</p>:null}
  <div className="wf-profile-progress"><div><small>Base pay</small><strong>{money(summary?.baseAmount??0)}</strong></div><div><small>Incentives & additions</small><strong>{money((summary?.incentiveAmount??0)+(summary?.earningAdjustments??0))}</strong></div><div><small>Deductions</small><strong>{money(summary?.deductions??0)}</strong></div><div><small>Net estimate</small><strong>{money(summary?.netAmount??0)}</strong></div></div>
  {summary?.holdReasons.length?<p role="status">On hold: {summary.holdReasons.join(' · ')}</p>:null}
  <div className="table-wrap"><table><caption>Daily activity & payment</caption><thead><tr><th>Date</th><th>Provider ID</th><th>Delivery</th><th>C-return</th><th>MFN</th><th>MFN return</th><th>Payment</th></tr></thead><tbody>{lines.map(line=><tr key={line.key}><td>{line.workDate}</td><td>{line.providerMemberId||'Biometric training'}<small>{line.providerMemberName}</small></td><td>{line.totalDelivery}</td><td>{line.customerReturn}</td><td>{line.mfn}</td><td>{line.mfnReturn}</td><td>{money(line.netAmount)}<small>{line.status.replaceAll('_',' ')}</small>{line.adjustmentAmount?<small>{line.holdReasons.join(' · ')}</small>:null}</td></tr>)}{!lines.length?<tr><td colSpan={7}>No earnings recorded for this period.</td></tr>:null}</tbody></table></div>
 </section>;
}
