export type LedgerPayment={id:string;company_id:string;status:string;amount:number|string;utr_cin:string|null;processed_at:string|null;request_no:string|null};
export type LedgerLink={company_id:string;payroll_item_id:string;payroll_run_id:string;payment_request_id:string;payment:LedgerPayment|null};
export type LedgerItem={id:string;company_id:string;workforce_id:string;payroll_run_id:string;station_code:string;status:string;gross_amount:number|string;deduction_amount:number|string;net_amount:number|string;run:{id:string;company_id:string;run_number:string;period_start:string;period_end:string;status:string;created_at:string}|null};
export type LedgerAdjustment={id:string;company_id:string;workforce_id:string;status:string;adjustment_type:string;category:string;amount:number|string;effective_date:string;payroll_run_id:string|null;reason:string;requested_at:string};
export type LedgerBucket='paid'|'awaiting_finance'|'payment_attention'|'held'|'provisional'|'evidence_gap'|'cancelled';
const cents=(value:number|string)=>{const n=Number(value),v=Math.round(n*100);if(!Number.isFinite(n)||!Number.isSafeInteger(v)||Math.abs(n*100-v)>0.0001)throw new Error('Invalid recorded financial amount.');return v;};
/** Recorded payroll ledger, not a reconstruction of uncalculated shipment/training earnings. */
export function reconcilePaymentLedger(company:string,person:string,items:LedgerItem[],links:LedgerLink[],adjustments:LedgerAdjustment[]){
 const itemIds=new Set<string>(),byItem=new Map<string,LedgerLink>(),requestIds=new Set<string>();
 for(const item of items){if(item.company_id!==company||item.workforce_id!==person||!item.run||item.run.company_id!==company||item.run.id!==item.payroll_run_id||itemIds.has(item.id))throw new Error('Payroll history could not be reconciled within this associate’s scope.');itemIds.add(item.id);}
 for(const link of links){if(link.company_id!==company||!itemIds.has(link.payroll_item_id)||byItem.has(link.payroll_item_id)||requestIds.has(link.payment_request_id))throw new Error('Duplicate or out-of-scope Finance evidence.');byItem.set(link.payroll_item_id,link);requestIds.add(link.payment_request_id);}
 const summary={paid:0,awaitingFinance:0,paymentAttention:0,held:0,provisional:0,evidenceGaps:0,approvedUnpostedAdditions:0,approvedUnpostedDeductions:0,pendingClaims:0,unlinkedPostedClaims:0};
 const rows=items.map(item=>{
  const net=cents(item.net_amount),gross=cents(item.gross_amount),deduction=cents(item.deduction_amount),link=byItem.get(item.id),payment=link?.payment??null;
  let bucket:LedgerBucket='evidence_gap',note='Recorded payroll has no reconciled individual Finance outcome. Do not pay again without checking.';
  const financeValid=Boolean(link&&link.payroll_run_id===item.payroll_run_id&&payment&&payment.id===link.payment_request_id&&payment.company_id===company&&cents(payment.amount)===net);
  if(payment&&payment.company_id!==company)throw new Error('Finance evidence is outside this company.');
  if(item.run!.status==='cancelled'){bucket='cancelled';note='Cancelled payroll; excluded from all balances.';}
  else if(['draft','review'].includes(item.run!.status)){bucket='provisional';note='Not confirmed. This is not an approved payable balance.';summary.provisional+=net;}
  else if(!['approved','paid'].includes(item.run!.status)){summary.evidenceGaps++;}
  else if(net>0&&financeValid&&payment?.status==='processed'&&item.status==='paid'&&payment.utr_cin?.trim()&&payment.processed_at&&Number.isFinite(Date.parse(payment.processed_at))){bucket='paid';note='Individual Finance payment is processed and reconciled.';summary.paid+=net;}
  else if(payment?.status==='processed'||item.status==='paid'){summary.evidenceGaps++;}
  else if(['hold','excluded'].includes(item.status)||net<=0){bucket='held';note='Held, excluded or non-positive net. Review the source; this is not a waiver.';summary.held+=net;}
  else if(financeValid&&item.status==='ready'&&['pending','approved','processing'].includes(payment!.status)){bucket='awaiting_finance';note=payment!.status==='processing'?'In Finance processing; do not issue a duplicate payment.':'Confirmed payroll awaits Finance approval or processing.';summary.awaitingFinance+=net;}
  else if(financeValid&&item.status==='ready'&&['returned','rejected','cancelled'].includes(payment!.status)){bucket='payment_attention';note='Finance returned, rejected or cancelled the request. Resolve through the original payment trail.';summary.paymentAttention+=net;}
  else summary.evidenceGaps++;
  if(gross-deduction!==net&&bucket!=='cancelled')throw new Error('Recorded payroll totals do not reconcile.');
  return {...item,net:net/100,bucket,note,payment:payment?{requestNo:payment.request_no,status:payment.status,reference:payment.utr_cin,processedAt:payment.processed_at}:null};
 });
 const seenAdjustments=new Set<string>();
 const claims=adjustments.map(a=>{
  if(a.company_id!==company||a.workforce_id!==person||seenAdjustments.has(a.id)||!['earning','deduction'].includes(a.adjustment_type)||!['draft','pending','approved','rejected','posted','cancelled'].includes(a.status))throw new Error('Adjustment history could not be reconciled within this associate’s scope.');
  seenAdjustments.add(a.id);const value=cents(a.amount);if(value<=0)throw new Error('Invalid adjustment amount.');
  let note='Not included in the confirmed payroll balances above.';
  if(a.status==='approved'&&!a.payroll_run_id){if(a.adjustment_type==='earning')summary.approvedUnpostedAdditions+=value;else summary.approvedUnpostedDeductions+=value;note='Approved but not yet in a payroll snapshot. Recalculate the correct open period.';}
  else if(['draft','pending'].includes(a.status)){summary.pendingClaims++;note='Awaiting review; not an approved earning or deduction.';}
  else if(a.status==='posted'){const found=rows.find(r=>r.payroll_run_id===a.payroll_run_id&&r.bucket!=='cancelled');if(!found){summary.unlinkedPostedClaims++;note='Posted claim has no matching non-cancelled payroll item. Reconcile before issuing payment.';}else note='Already included in payroll. Never add this amount to payroll totals again.';}
  else if(a.status==='approved'){summary.unlinkedPostedClaims++;note='Approved claim has an unexpected payroll link. Review its evidence.';}
  else note='Rejected or cancelled; does not affect payable totals.';
  return {...a,amount:value/100,note};
 });
 for(const key of ['paid','awaitingFinance','paymentAttention','held','provisional','approvedUnpostedAdditions','approvedUnpostedDeductions'] as const)summary[key]/=100;
 return {summary,rows,claims};
}
