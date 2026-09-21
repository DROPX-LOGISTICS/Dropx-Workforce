import Link from 'next/link';
import {AppShell} from '@/components/app-shell';
import {SearchableSelect} from '@/components/searchable-select';
import {requirePagePermission} from '@/lib/authorization';
import {requireCompanyId} from '@/lib/company-scope';
import {supabaseAdmin} from '@/lib/supabase-admin';
import {readAllRows} from '@/lib/supabase-pagination';
import {workforceClassification} from '@/lib/workforce-classification';
import {reconcilePaymentLedger,type LedgerItem,type LedgerLink,type LedgerAdjustment,type LedgerBucket} from '@/lib/workforce-payment-ledger';
import styles from '@/components/workforce-mileage-desk.module.css';
import {loadRecordedExitChecks} from '@/lib/workforce-exit-recorded-loader';
import {WorkforceExitReadiness} from '@/components/workforce-exit-readiness';
import type {RecordedExitChecks} from '@/lib/workforce-exit-recorded-checks';
export const dynamic='force-dynamic';
type Person={id:string;full_name:string;dropx_id:string|null;location_id:string;onboarding_status:string;lifecycle_status:string|null;designation_id:string|null;designation:string|null};
type Search={person?:string;status?:string;sort?:string;page?:string;claim_page?:string};
type Hold={id:string;period_start:string;period_end:string;status:string;reason:string;reference:string;requested_at:string};
type Window={id:string;window_start:string;window_end:string;settlements:{status:string}[]};
const relation=<T,>(v:T|T[]|null):T|null=>Array.isArray(v)?v[0]??null:v;
const money=(n:unknown)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(Number(n));
const labels:Record<LedgerBucket,string>={paid:'Paid · reconciled',awaiting_finance:'Awaiting Finance',payment_attention:'Finance action needed',held:'Held / excluded',provisional:'Draft / under review',evidence_gap:'Evidence missing',cancelled:'Cancelled'};
export default async function PaymentLedgerPage({searchParams:params={}}:{searchParams?:Search}){
 const auth=await requirePagePermission('workforce_payroll','access'),company=requireCompanyId(auth);
 let error='',people:Person[]=[],selected:Person|undefined,ledger:ReturnType<typeof reconcilePaymentLedger>|null=null,holds:Hold[]=[],windows:Window[]=[];
 let exitChecks:RecordedExitChecks|null=null,exitCheckError='';
 const stationNames=new Map<string,string>();
 if(auth.hasAllLocationAccess){try{
  if(!supabaseAdmin)throw new Error('Database is unavailable.');
  const [persons,stations,eligible]=await Promise.all([
   readAllRows(supabaseAdmin.from('workforce').select('id,full_name,dropx_id,location_id,onboarding_status,lifecycle_status,designation_id,designation').eq('company_id',company).is('deleted_at',null).neq('migration_state','reclassified').order('full_name').order('id')),
   readAllRows(supabaseAdmin.from('stations').select('id,station_code').eq('company_id',company).order('id')),workforceClassification(company)]);
  if(persons.error||stations.error)throw new Error('Associate and station scope could not be loaded.');
  people=(persons.data??[]).filter(eligible) as Person[];for(const s of stations.data??[])stationNames.set(s.id,s.station_code);
  selected=people.find(p=>p.id===params.person);
  if(params.person&&!selected)throw new Error('Choose a canonical Workforce associate within your company.');
  if(selected){
   const [items,adjustments,holdRows,windowRows]=await Promise.all([
    readAllRows(supabaseAdmin.from('workforce_payroll_items').select('id,company_id,workforce_id,payroll_run_id,station_code,status,gross_amount,deduction_amount,net_amount,run:workforce_payroll_runs(id,company_id,run_number,period_start,period_end,status,created_at)').eq('company_id',company).eq('workforce_id',selected.id).order('id')),
    readAllRows(supabaseAdmin.from('workforce_adjustments').select('id,company_id,workforce_id,status,adjustment_type,category,amount,effective_date,payroll_run_id,reason,requested_at').eq('company_id',company).eq('workforce_id',selected.id).order('effective_date',{ascending:false}).order('id')),
    readAllRows(supabaseAdmin.from('workforce_payment_holds').select('id,period_start,period_end,status,reason,reference,requested_at').eq('company_id',company).eq('workforce_id',selected.id).neq('status','released').order('id')),
    readAllRows(supabaseAdmin.from('workforce_pooled_agreements').select('id,window_start,window_end,settlements:workforce_pooled_settlements(status)').eq('company_id',company).eq('workforce_id',selected.id).order('window_end').order('id'))]);
   if([items,adjustments,holdRows,windowRows].some(r=>r.error))throw new Error('A required payroll, claim, hold or agreement history could not be loaded. No partial balance is shown.');
   const rows=(items.data??[]).map(i=>({...i,run:relation(i.run)})) as LedgerItem[],links:LedgerLink[]=[];
   for(let n=0;n<rows.length;n+=100){const r=await readAllRows(supabaseAdmin.from('workforce_payroll_finance_links').select('company_id,payroll_item_id,payroll_run_id,payment_request_id,payment:payment_requests(id,company_id,status,amount,utr_cin,processed_at,request_no)').eq('company_id',company).in('payroll_item_id',rows.slice(n,n+100).map(i=>i.id)).order('payroll_item_id'));if(r.error)throw new Error('Finance evidence could not be loaded. No partial balance is shown.');links.push(...(r.data??[]).map(l=>({...l,payment:relation(l.payment)})) as LedgerLink[]);}
   ledger=reconcilePaymentLedger(company,selected.id,rows,links,(adjustments.data??[]) as LedgerAdjustment[]);holds=holdRows.data??[];windows=(windowRows.data??[]).filter(w=>!(w.settlements??[]).some((s:{status:string})=>s.status==='approved')) as Window[];
   try{exitChecks=await loadRecordedExitChecks(company,selected.id,null);}catch{exitCheckError='Recorded exit readiness could not be verified. Payroll history below remains read-only; do not clear the exit.';}
  }
 }catch(e){error=e instanceof Error?e.message:'Payment history is unavailable.';ledger=null;}}
 const filtered=ledger?.rows.filter(r=>!params.status||r.bucket===params.status).sort((a,b)=>(params.sort==='oldest'?1:-1)*a.run!.period_end.localeCompare(b.run!.period_end))??[];
 const pages=Math.max(1,Math.ceil(filtered.length/25)),page=Math.min(pages,Math.max(1,Number.parseInt(params.page??'1',10)||1)),shown=filtered.slice((page-1)*25,page*25);
 const claimPages=Math.max(1,Math.ceil((ledger?.claims.length??0)/25)),claimPage=Math.min(claimPages,Math.max(1,Number.parseInt(params.claim_page??'1',10)||1));
 const href=(n:number,claim=false)=>{const q=new URLSearchParams({person:params.person??'',status:params.status??'',sort:params.sort??'newest',page:String(claim?page:n),claim_page:String(claim?n:claimPage)});return '/delivery-network/payment-ledger?'+q;};
 return <AppShell active="Associate Payment Ledger" pageCode="workforce_payroll"><div className={styles.desk}>
  <header className={styles.header}><h1>Associate payment ledger</h1><p>Recorded payroll and Finance outcomes across all stored periods, including exited associates. Check unpaid requests, held snapshots and unposted adjustments without counting the same earning twice.</p></header>
  {!auth.hasAllLocationAccess?<section className={styles.panel}><h2>Central payroll access required</h2><p>This cross-station financial history requires all-location payroll access. Your scoped live-earnings desk remains available.</p><Link href="/delivery-network/earnings">Open scoped earnings</Link></section>:<>
   {error?<p role="alert" className={styles.notice+' '+styles.error}>{error}</p>:null}
   <section className={styles.panel}><form method="get" className={styles.filters}><label>Associate / DropX ID<SearchableSelect name="person" defaultValue={selected?.id??''} required placeholder="Search name, ID or station" options={people.map(p=>({value:p.id,label:(p.dropx_id??'ID pending')+' · '+p.full_name,helper:[stationNames.get(p.location_id),p.lifecycle_status??p.onboarding_status].filter(Boolean).join(' · ')}))}/></label><button className="button secondary" disabled={!people.length}>Open payment history</button></form><p>This view is read-only. It cannot approve, hold, waive, pay or close an exit.</p></section>
   {ledger&&selected?<>
    {exitChecks?<WorkforceExitReadiness checks={exitChecks} workforceId={selected.id}/>:<p role="alert" className={styles.notice+' '+styles.error}>{exitCheckError}</p>}
    <section className={styles.notice}><strong>{selected.dropx_id??'ID pending'} · {selected.full_name}</strong><p>{stationNames.get(selected.location_id)} · {selected.lifecycle_status??selected.onboarding_status}</p><p><strong>Coverage:</strong> all recorded payroll items and adjustments for this associate, not uncalculated work. Unimported delivery records, uncalculated training days, unreviewed claims and unclosed pooled windows are not a verified zero balance.</p><Link href="/delivery-network/earnings">Review live earning sources</Link> · <Link href="/delivery-network/joining">Training evidence</Link> · <Link href="/delivery-network/lifecycle">Exit review</Link></section>
    <section className={styles.panel}><h2>Separate balances · never added together automatically</h2><dl className={styles.facts}>
     <div><dt>Finance-paid with individual evidence</dt><dd>{money(ledger.summary.paid)}</dd></div><div><dt>Confirmed · awaiting Finance</dt><dd>{money(ledger.summary.awaitingFinance)}</dd></div><div><dt>Returned / rejected payment requests</dt><dd>{money(ledger.summary.paymentAttention)}</dd></div><div><dt>Held / excluded recorded net</dt><dd>{money(ledger.summary.held)}</dd></div><div><dt>Draft / review · not confirmed</dt><dd>{money(ledger.summary.provisional)}</dd></div><div><dt>Approved additions not yet in payroll</dt><dd>{money(ledger.summary.approvedUnpostedAdditions)}</dd></div><div><dt>Approved deductions not yet in payroll</dt><dd>{money(ledger.summary.approvedUnpostedDeductions)}</dd></div><div><dt>Claims awaiting review</dt><dd>{ledger.summary.pendingClaims}</dd></div>
    </dl>{ledger.summary.evidenceGaps||ledger.summary.unlinkedPostedClaims?<p role="alert" className={styles.error+' '+styles.notice}>{ledger.summary.evidenceGaps} payroll evidence gaps and {ledger.summary.unlinkedPostedClaims} adjustment-link gaps. These are not counted as either paid or safely payable again.</p>:null}</section>
    <section className={styles.panel}><h2>Open holds &amp; pooled windows</h2>{!holds.length&&!windows.length?<p>No active holds or unapproved pooled windows recorded. This alone does not clear an exit.</p>:null}{holds.map(h=><article key={h.id} className={styles.claim}><h3>{h.reference} · {h.status}</h3><p>{h.period_start} → {h.period_end}<br/>{h.reason}</p><Link href="/delivery-network/payment-holds">Open hold review</Link></article>)}{windows.map(w=><p key={w.id}>Unsettled pooled window: {w.window_start} → {w.window_end} · <Link href={'/delivery-network/pooled-settlements?agreement='+w.id}>Review reconciliation</Link></p>)}</section>
    <section className={styles.panel}><h2>Payroll &amp; Finance history</h2><form key={`${selected.id}:${params.status??''}:${params.sort??'newest'}`} method="get" className={styles.filters}><input type="hidden" name="person" value={selected.id}/><label>Status<select name="status" defaultValue={params.status??''}><option value="">All statuses</option>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>Sort<select name="sort" defaultValue={params.sort??'newest'}><option value="newest">Latest period first</option><option value="oldest">Earliest period first</option></select></label><button className="button secondary">Apply</button><Link href={'/delivery-network/payment-ledger?person='+selected.id}>Reset filters</Link></form><small>{filtered.length} matching recorded payroll items · {ledger.rows.length} total · times in IST</small>
     <div className={styles.claims}>{shown.map(r=><article key={r.id} className={styles.claim}><div className={styles.claimHead}><div><h3>{r.run!.run_number} · {money(r.net)}</h3><small>{r.station_code} · {r.run!.period_start} → {r.run!.period_end}</small></div><span className={styles.badge}>{labels[r.bucket]}</span></div><p>{r.note}</p><dl className={styles.facts}><div><dt>Frozen gross / deductions</dt><dd>{money(r.gross_amount)} / {money(r.deduction_amount)}</dd></div><div><dt>Payroll run / item state</dt><dd>{r.run!.status} / {r.status}</dd></div><div><dt>Finance request</dt><dd>{r.payment?`${r.payment.requestNo??'Recorded request'} · ${r.payment.status}`:'No linked individual request'}</dd></div><div><dt>Payment evidence</dt><dd>{r.payment?.reference??'No bank reference'}<br/>{r.payment?.processedAt?new Date(r.payment.processedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})+' IST':'Not processed'}</dd></div></dl><Link href={'/delivery-network/payroll/'+r.payroll_run_id}>Open original payroll</Link></article>)}</div>{!shown.length?<p>No payroll items match this view. This does not mean there are no uncalculated earnings.</p>:null}{pages>1?<nav className={styles.pages} aria-label="Payment ledger pages">{page>1?<Link href={href(page-1)}>Previous</Link>:null}<span>Page {page} of {pages}</span>{page<pages?<Link href={href(page+1)}>Next</Link>:null}</nav>:null}
    </section>
    <section className={styles.panel}><h2>Adjustment history · {ledger.claims.length}</h2><p>Posted adjustments are already inside payroll. They are never added a second time to the balances above.</p>{!ledger.claims.length?<p>No adjustments recorded.</p>:<div className={styles.table}><table><thead><tr><th>Date / type</th><th>Amount / state</th><th>Reason</th><th>Reconciliation</th></tr></thead><tbody>{ledger.claims.slice((claimPage-1)*25,claimPage*25).map(a=><tr key={a.id}><td>{a.effective_date}<br/>{a.adjustment_type} · {a.category}</td><td>{money(a.amount)}<br/>{a.status}</td><td>{a.reason}</td><td>{a.note}</td></tr>)}</tbody></table></div>}{claimPages>1?<nav className={styles.pages} aria-label="Adjustment history pages">{claimPage>1?<Link href={href(claimPage-1,true)}>Previous claims</Link>:null}<span>Page {claimPage} of {claimPages}</span>{claimPage<claimPages?<Link href={href(claimPage+1,true)}>Next claims</Link>:null}</nav>:null}<Link href="/delivery-network/adjustments">Open adjustment review</Link></section>
   </>:!error?<p>Select an associate to load the complete recorded history.</p>:null}
  </>}
 </div></AppShell>;
}
