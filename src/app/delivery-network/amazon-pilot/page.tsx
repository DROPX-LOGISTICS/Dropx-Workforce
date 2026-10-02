import { ArrowRight,CheckCircle2,Clock3,Fingerprint,Plus,RefreshCw,Search,ShieldCheck,Smartphone,Users } from 'lucide-react';
import { WorkforceOnboardingShell } from '@/components/workforce-onboarding-shell';
import { WorkforceLiveRefresh } from '@/components/workforce-live-refresh';
import { SubmitButton } from '@/components/submit-button';
import { requirePagePermission,hasPermission } from '@/lib/authorization';
import { requireCompanyId } from '@/lib/company-scope';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { filterOnboardingLocations } from '@/lib/onboarding-location-access';
import { canOnboardDesignation } from '@/lib/designation-onboarding-access';
import { pilotStatus,pilotStages,type Pilot } from '@/lib/amazon-pilot';
import { createAmazonPilot,updateAmazonPilot } from './actions';
import styles from './pilot.module.css';
export const dynamic='force-dynamic';
const path='/delivery-network/amazon-pilot';
const format=(v:string|null|undefined)=>v?new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'}).format(new Date(v)):'Awaiting first sync';
type Person={id:string;full_name:string;mobile:string;email:string;dropx_id:string|null;biometric_id:string|null};
export default async function AmazonPilotPage({searchParams={}}:{searchParams?:Record<string,string|undefined>}){
 const auth=await requirePagePermission('delivery_associates','access'),company=requireCompanyId(auth),db=supabaseAdmin;
 if(!db)throw new Error('Database unavailable.');
 const [stationResult,roleResult,pilotResult,invitationSettings]=await Promise.all([
  db.from('stations').select('id,station_code,station_name,is_active,hide_from_location_list').eq('company_id',company).order('station_code'),
  db.from('designations').select('id,name,onboarding_role_ids,category:designation_categories!designations_designation_category_id_fkey(people_module)').eq('company_id',company).eq('is_active',true).order('name'),
  (auth.hasAllLocationAccess?db.from('workforce_amazon_pilots').select('*').eq('company_id',company):db.from('workforce_amazon_pilots').select('*').eq('company_id',company).in('station_id',auth.locationScopeIds.length?auth.locationScopeIds:['00000000-0000-0000-0000-000000000000'])).order('created_at',{ascending:false}).limit(500),
  db.from('workforce_amazon_station_settings').select('station_id').eq('company_id',company).eq('invitation_enabled',true)
 ]);
 const stations=filterOnboardingLocations(stationResult.data??[],auth),allowed=new Set(stations.map(s=>s.id));
 const invitationStations=stations.filter(s=>s.is_active&&(invitationSettings.data??[]).some(config=>config.station_id===s.id));
 const rows=((pilotResult.data??[]) as Pilot[]).filter(p=>auth.hasAllLocationAccess||allowed.has(p.station_id));
 const ids=rows.map(p=>p.workforce_id);
 const peopleResult=ids.length?await db.from('workforce').select('id,full_name,mobile,email,dropx_id,biometric_id').eq('company_id',company).in('id',ids):{data:[],error:null};
 const people=new Map((peopleResult.data??[]).map(p=>[p.id,p as Person]));
 const roles=(roleResult.data??[]).filter(r=>{const c=Array.isArray(r.category)?r.category[0]:r.category;return c?.people_module==='delivery_network'&&canOnboardDesignation(r,auth);});
 const counts=new Map<string,number>();rows.forEach(p=>{const s=pilotStatus(p).stage;counts.set(s,(counts.get(s)??0)+1);});
 const query=(searchParams.q??'').toLowerCase(),stage=searchParams.stage??'',stationFilter=searchParams.station??'';
 const filtered=rows.filter(p=>{const w=people.get(p.workforce_id);return (!stage||(stage==='scc_available'?['scc_available','delivery_started'].includes(pilotStatus(p).stage):pilotStatus(p).stage===stage))&&(!stationFilter||p.station_id===stationFilter)&&(!query||`${w?.full_name} ${w?.mobile} ${w?.email} ${w?.dropx_id}`.toLowerCase().includes(query));});
 const selected=rows.find(p=>p.workforce_id===searchParams.id),person=selected?people.get(selected.workforce_id):null,status=selected?pilotStatus(selected):null;
 const canAdd=hasPermission(auth,'delivery_associates','add')&&!auth.readOnly,canEdit=hasPermission(auth,'delivery_associates','edit')&&!auth.readOnly;
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const error=pilotResult.error||peopleResult.error?'Onboarding records could not be loaded. Please refresh.':stationResult.error||roleResult.error||invitationSettings.error?'Onboarding configuration could not be loaded.':searchParams.error;
 return <WorkforceOnboardingShell active="onboarding"><main className={styles.page}>
  <header className={styles.hero}>
   <div><div className={styles.eyebrow}><span/> AMAZON · DELIVERY ASSOCIATES</div><h1>Amazon onboarding</h1><p>Invite an associate. Follow registration, activation and their first delivery.</p></div>
   <div className={styles.heroActions}><WorkforceLiveRefresh seconds={30} refreshedAt={new Date().toISOString()}/>{canAdd?<a className={styles.primary} href={`${path}?new=1#arrival`}><Plus size={17}/> Invite associate</a>:null}</div>
  </header>
  {error?<div className={styles.error} role="alert">{String(error)}</div>:null}
  {searchParams.notice?<div className={styles.notice} role="status">{searchParams.notice}</div>:null}
  <section className={styles.stats} aria-label="Onboarding overview">{[
   {label:'Associates onboarding',value:rows.filter(p=>!p.closed_at).length,icon:Users,filter:''},
   {label:'Registration pending',value:counts.get('registration_pending')??0,icon:Smartphone,filter:'registration_pending'},
   {label:'Under verification',value:counts.get('verification_pending')??0,icon:Clock3,filter:'verification_pending'},
   {label:'Available in SCC',value:(counts.get('scc_available')??0)+(counts.get('delivery_started')??0),icon:CheckCircle2,filter:'scc_available'}
  ].map(item=><a href={`${path}?stage=${item.filter}`} key={item.label}><item.icon size={20}/><strong>{item.value}</strong><span>{item.label}</span></a>)}</section>
  {searchParams.new==='1'&&canAdd?<section className={styles.panel} id="arrival">
   <header><div><small>NEW ASSOCIATE</small><h2>Send an invitation</h2><p>Amazon LSC email invitation and DropX WhatsApp welcome are requested together.</p></div></header>
   <form action={createAmazonPilot} className={styles.form}>
    <label>Full name<input name="full_name" required minLength={2} maxLength={120} autoComplete="name"/></label>
    <label>Mobile number<input name="mobile" required inputMode="tel" pattern="[0-9]{10}" maxLength={10} placeholder="10-digit mobile"/></label>
    <label>Amazon email<input name="email" type="email" required maxLength={180}/></label>
    <label>Station<select name="station_id" required defaultValue=""><option value="" disabled>Select station</option>{invitationStations.map(s=><option key={s.id} value={s.id}>{s.station_code} · {s.station_name}</option>)}</select></label>
    <label>Designation<select name="designation_id" required defaultValue=""><option value="" disabled>Select designation</option>{roles.map(r=><option value={r.id} key={r.id}>{r.name}</option>)}</select></label>
    <label>Reported on<input type="date" name="reported_on" defaultValue={today} max={today} required/></label>
    <div className={styles.formHelp}><Fingerprint size={20}/><p>A biometric enrolment ID is included in the welcome. The associate can register as soon as the Amazon invitation arrives.</p></div>
    <footer><SubmitButton className={styles.primary} pendingText="Requesting invitations…">Send invitations</SubmitButton><a href={path}>Cancel</a></footer>
   </form>
  </section>:null}
  <section className={styles.panel}>
   <header><div><small>LIVE OVERVIEW</small><h2>Associates</h2></div><span className={styles.count}>{filtered.length} associates</span></header>
   <form className={styles.filters} action={path}><label><Search size={16}/><input name="q" defaultValue={searchParams.q} placeholder="Search name, Driver ID or mobile" aria-label="Search associates"/></label><select name="stage" defaultValue={stage} aria-label="Filter stage"><option value="">All stages</option>{Object.entries(pilotStages).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select><select name="station" defaultValue={stationFilter} aria-label="Filter station"><option value="">All stations</option>{stations.map(s=><option value={s.id} key={s.id}>{s.station_code}</option>)}</select><button className={styles.secondary}>Apply</button></form>
   {!filtered.length?<div className={styles.empty}><Users size={30}/><h3>{rows.length?'No matching associates':'Your next associate starts here'}</h3><p>{rows.length?'Try another name, station or stage.':'Send their Amazon invitation and track each pending registration step in one place.'}</p>{!rows.length&&canAdd?<a className={styles.primary} href={`${path}?new=1#arrival`}>Invite first associate <ArrowRight size={16}/></a>:null}</div>:<div className={styles.tableWrap}><table><thead><tr><th>Associate</th><th>Station</th><th>DA In-App Onboarding</th><th>Last checked</th><th/></tr></thead><tbody>{filtered.map(p=>{const w=people.get(p.workforce_id),s=pilotStatus(p);return <tr key={p.workforce_id}><td><strong>{w?.full_name??'Associate'}</strong><small>Driver ID: {w?.dropx_id||'Pending'}</small><small>{w?.email}</small></td><td><strong>{stations.find(x=>x.id===p.station_id)?.station_code}</strong></td><td><span className={styles.badge} data-stage={s.stage}>{s.label}</span><small>{s.owner}{s.stale?' · Report may be outdated':''}{p.sync_error?' · Sync needs attention':''}</small></td><td><small>{format(p.last_checked_at)}</small></td><td><a className={styles.open} href={`${path}?id=${p.workforce_id}#associate`}>View <ArrowRight size={16}/></a></td></tr>;})}</tbody></table></div>}
  </section>
  {selected&&person&&status?<section className={styles.detail} id="associate">
   <div className={styles.panel}><header><div><small>ASSOCIATE DETAILS</small><h2>{person.full_name}</h2><p>{person.email} · {person.mobile}</p></div>{canEdit&&!selected.closed_at?<form action={updateAmazonPilot}><input type="hidden" name="id" value={selected.workforce_id}/><input type="hidden" name="action" value="refresh"/><SubmitButton className={styles.secondary} pendingText="Checking…"><RefreshCw size={15}/> Check sources</SubmitButton></form>:null}</header>
    <div className={styles.detailBody}><div className={styles.current}><Smartphone size={24}/><div><small>ALSO VISIBLE TO THE ASSOCIATE IN DROPX ONE</small><h3>{status.label}</h3><p>{status.instruction}</p><span>Next action: {status.owner}</span></div></div>
     <div className={styles.biometric}><Fingerprint size={22}/><div><strong>Driver ID: {person.dropx_id||'Pending'}</strong><p>Biometric enrolment ID: <b>{person.biometric_id||'Pending'}</b>.</p></div></div>
     {selected.sync_error?<p className={styles.error}>{selected.sync_error}</p>:null}{status.stale?<p className={styles.notice}>The onboarding report is older than 48 hours. This status reflects the latest available report.</p>:null}
     <div className={styles.evidence}><h3>Connected Amazon identifiers</h3>{[['LSC provider / report account ID',selected.evidence.providerId],['LSC transporter / SCC Driver ID',selected.evidence.transporterId],['Amazon shipment provider ID',selected.evidence.employeeId]].map(([label,id])=><div key={label}><span>{label}</span><code>{id||'Awaiting source evidence'}</code></div>)}<p>Source report: {selected.evidence.reportDate||'Not received'} · SCC observed: {format(selected.evidence.sccAt)}</p></div>
    </div>
   </div>
   <aside className={styles.panel}><header><div><small>AMAZON INVITATION</small><h2>{selected.evidence.invitationStatus==='sent'?'Invitation sent':selected.evidence.invitationStatus==='failed'?'Needs attention':'Invitation requested'}</h2></div></header><div className={styles.detailBody}>
    <p className={styles.footnote}>The associate can open the Amazon email invitation and complete registration immediately. Submitted details proceed through Amazon verification.</p>
    {selected.evidence.invitationError?<p className={styles.error}>{selected.evidence.invitationError}</p>:null}
    {canEdit&&!selected.closed_at?<><form action={updateAmazonPilot} className={styles.sideForm}><input type="hidden" name="id" value={selected.workforce_id}/><input type="hidden" name="action" value="queue"/><SubmitButton className={styles.secondary} pendingText="Checking…">Check invitation queue</SubmitButton><small>A sent invitation is retained without creating a duplicate.</small></form><details className={styles.sideForm}><summary>Close onboarding</summary><form action={updateAmazonPilot}><input type="hidden" name="id" value={selected.workforce_id}/><input type="hidden" name="action" value="close"/><label>Reason<textarea name="notes" required minLength={5} maxLength={1000}/></label><SubmitButton className={styles.secondary} pendingText="Closing…">Close onboarding</SubmitButton></form></details></>:null}
   </div></aside>
  </section>:null}
  <footer className={styles.pageFooter}><ShieldCheck size={14}/><span>New onboarding is tracked separately. Current payroll stays protected.</span><span>Source sync every 10 minutes · Screen refresh every 30 seconds</span></footer>
 </main></WorkforceOnboardingShell>;
}
