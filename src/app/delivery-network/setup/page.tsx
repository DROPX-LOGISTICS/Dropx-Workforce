import Link from 'next/link';
import {redirect} from 'next/navigation';
import {AppShell} from '@/components/app-shell';
import {PageHead} from '@/components/page-head';
import {isCompanyOwner,requirePagePermission} from '@/lib/authorization';
import {requireCompanyId} from '@/lib/company-scope';
import {supabaseAdmin} from '@/lib/supabase-admin';
import {readAllRows} from '@/lib/supabase-pagination';
import {workforceToday} from '@/lib/workforce-earnings';
import {loadWorkforceJoining} from '@/lib/workforce-joining-data';
import styles from './page.module.css';

export const dynamic='force-dynamic';
export default async function WorkforceSetup({searchParams:params={}}:{searchParams?:{q?:string;view?:string}}){
 const auth=await requirePagePermission('people_review','access');
 if(!isCompanyOwner(auth))redirect('/unauthorized?page=people_review');
 const company=requireCompanyId(auth),today=workforceToday();
 let data:Awaited<ReturnType<typeof loadWorkforceJoining>>|null=null;
 let error='',calendars:{station_id:string;anchor_date:string}[]=[],defaults:{station_id:string}[]=[];
 let connection:{enabled:boolean}|null=null,sync:{status:string;last_success_at:string|null}|null=null;
 try{
  if(!supabaseAdmin)throw new Error('Database is unavailable.');
  const results=await Promise.all([
   loadWorkforceJoining(auth,{to:today,evidence:false}),
   readAllRows(supabaseAdmin.from('workforce_payroll_calendars').select('station_id,anchor_date').eq('company_id',company).eq('is_active',true).order('id')),
   readAllRows(supabaseAdmin.from('workforce_amazon_station_settings').select('station_id').eq('company_id',company).order('station_id')),
   supabaseAdmin.from('workforce_amazon_connections').select('enabled').eq('company_id',company).maybeSingle(),
   supabaseAdmin.from('workforce_amazon_sync_state').select('status,last_success_at').eq('company_id',company).maybeSingle()
  ]);
  if(results.slice(1).some(result=>'error' in result&&result.error))throw new Error('Configuration could not be fully checked. Retry before relying on these totals.');
  [data]=results;calendars=results[1].data??[];defaults=results[2].data??[];connection=results[3].data;sync=results[4].data;
 }catch(e){error=e instanceof Error?e.message:'Unable to check setup.';}
 const rows=(data?.stations??[]).map(station=>{
  const people=data!.profiles.filter(person=>person.location_id===station.id&&person.is_active&&!['offboarded','archived'].includes(person.lifecycle_status??''));
  const policy=data!.policies.some(p=>p.station_id===station.id&&p.is_active&&p.effective_from<=today&&(!p.effective_to||p.effective_to>=today));
  const calendar=calendars.some(row=>row.station_id===station.id&&row.anchor_date<=today);
  const amazon=defaults.some(row=>row.station_id===station.id);
  return {...station,people:people.length,policy,calendar,amazon,missing:Number(!policy)+Number(!calendar)+Number(!amazon)};
 });
 const visible=rows.filter(row=>(!params.q||row.station_code.toLowerCase().includes(params.q.trim().toLowerCase()))&&(params.view!=='staffed'||row.people>0)&&(params.view!=='gaps'||row.missing>0));
 return <AppShell active="Setup Checklist" pageCode="people_review"><div className={styles.desk}>
  <PageHead eyebrow="Owner workspace · Configuration" title="Workforce setup checklist" subtitle="Station settings, connection health and the route from joining to Finance. This is configuration visibility—not a guarantee that every associate is pay-ready."/>
  {error?<p role="alert" className={styles.error}>{error}</p>:<>
   <section className={styles.stats}><article><small>Stations in scope</small><strong>{rows.length}</strong></article><article><small>With current profiles</small><strong>{rows.filter(row=>row.people>0).length}</strong></article><article><small>All three masters present</small><strong>{rows.filter(row=>!row.missing).length}</strong><small>Still review individual agreements and rates</small></article></section>
   <section className={styles.card}><header><div><h2>Station masters</h2><p>Training applies only to agreed pre-mapping days. A missing calendar does not prevent a manually selected payroll period. Amazon defaults apply only to Amazon operations.</p></div></header>
    <form method="get" className={styles.filters}><label>Station<input name="q" defaultValue={params.q??''} placeholder="Search station code"/></label><label>View<select name="view" defaultValue={params.view??'all'}><option value="all">All stations</option><option value="staffed">With current profiles</option><option value="gaps">Missing a master</option></select></label><button className="button secondary">Apply</button></form>
    <div className={styles.table}><table><thead><tr><th>Station</th><th>Current profiles</th><th>Training terms</th><th>Payroll calendar</th><th>Amazon defaults</th></tr></thead><tbody>{visible.map(row=><tr key={row.id}><th>{row.station_code}</th><td>{row.people}</td><td><Link href="/delivery-network/training-policies">{row.policy?'Available today':'Configure if training'}</Link></td><td><Link href="/delivery-network/payroll-calendars">{row.calendar?'Available today':'Manual dates / configure'}</Link></td><td><Link href={`/delivery-network/amazon-onboarding-settings?station=${row.id}`}>{row.amazon?'Saved · verify with Amazon':'Configure if Amazon'}</Link></td></tr>)}{!visible.length?<tr><td colSpan={5}>No stations match this view.</td></tr>:null}</tbody></table></div>
   </section>
   <section className={styles.grid}><article className={styles.card}><header><h2>Amazon connection</h2></header><div className={styles.body}><p>{!connection?.enabled?'Not configured or paused.':sync?.status==='ok'?'Last scan completed.':'Enabled · verification or worker check required.'}</p><p>Last complete scan: {sync?.last_success_at?new Date(sync.last_success_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})+' IST':'Not verified yet'}</p><p>Your browser login is not the worker login. Passwords stay in the encrypted connection; OTP and CAPTCHA require an operator.</p><Link href="/settings/amazon-onboarding">Manage connection →</Link></div></article>
    <article className={styles.card}><header><h2>Payroll to Finance</h2></header><div className={styles.body}><p>Review earnings → resolve holds and claims → confirm payroll → Finance approval → Federal Bank processing → individual payment reconciliation.</p><p>Before the first real run, Finance must configure the agreed payroll payment head, approval and processing roles. This checklist does not verify bank access or assign approvers.</p><Link href="/delivery-network/payroll">Review payroll →</Link></div></article></section>
  </>}
  <section className={styles.card}><header><h2>Operating desks</h2></header><div className={styles.links}><Link href="/delivery-network/joining">Joining & training</Link><Link href="/delivery-network/rate-mapping">Provider ID & effective rates</Link><Link href="/delivery-network/earnings">Earnings & exceptions</Link><Link href="/delivery-network/payment-holds">Payment holds</Link><Link href="/delivery-network/adjustments">Claim review</Link><Link href="/delivery-network/lifecycle?tab=exits">Exits & Finance reconciliation</Link></div></section>
 </div></AppShell>;
}
