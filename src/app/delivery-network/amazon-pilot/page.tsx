import { ArrowRight,CheckCircle2,Clock3,Plus,RefreshCw,Search,ShieldCheck,Smartphone,Users } from 'lucide-react';
import { WorkforceOnboardingShell } from '@/components/workforce-onboarding-shell';
import { WorkforceLiveRefresh } from '@/components/workforce-live-refresh';
import { SubmitButton } from '@/components/submit-button';
import { requirePagePermission,hasPermission } from '@/lib/authorization';
import { requireCompanyId } from '@/lib/company-scope';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { filterOnboardingLocations } from '@/lib/onboarding-location-access';
import { canOnboardDesignation } from '@/lib/designation-onboarding-access';
import { pilotStatus,pilotStages,withLiveAmazonEvidence,type InvitationSnapshot,type Pilot,type PortalSnapshot } from '@/lib/amazon-pilot';
import { updateAmazonPilot } from './actions';
import { AmazonPilotInviteForm } from './amazon-pilot-invite-form';
import styles from './pilot.module.css';
export const dynamic='force-dynamic';
const path='/delivery-network/amazon-pilot';
const format=(v:string|null|undefined)=>v?new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'}).format(new Date(v)):'Awaiting first sync';
type Person={id:string;full_name:string;mobile:string;email:string;biometric_id:string|null};
type Alias={workforce_id:string;alias_email:string;status:string;last_message_at:string|null;routing_error:string|null;routing_rule_id:string|null};
type AliasMessage={workforce_id:string;sender:string;subject:string;action_url:string|null;received_at:string};
async function overlayLiveEvidence(company:string,rows:Pilot[]){
 if(!supabaseAdmin||!rows.length)return rows;
 const ids=rows.map(row=>row.workforce_id),chunks:Array<string[]>=[];
 for(let offset=0;offset<ids.length;offset+=80)chunks.push(ids.slice(offset,offset+80));
 const [invitationResults,portalResults]=await Promise.all([
  Promise.all(chunks.map(chunk=>supabaseAdmin!.from('workforce_amazon_invitation_requests').select('workforce_id,status,external_reference,completed_at,error_message,requested_at').eq('company_id',company).in('workforce_id',chunk).order('requested_at',{ascending:false}))),
  Promise.all(chunks.map(chunk=>supabaseAdmin!.from('workforce_amazon_portal_links').select('workforce_id,amazon_provider_id,transporter_id').eq('company_id',company).in('workforce_id',chunk)))
 ]);
 const invitations=new Map<string,InvitationSnapshot>(),portals=new Map<string,PortalSnapshot>();
 invitationResults.flatMap(result=>result.data??[]).forEach(row=>{if(!invitations.has(row.workforce_id))invitations.set(row.workforce_id,row);});
 portalResults.flatMap(result=>result.data??[]).forEach(row=>portals.set(row.workforce_id,row));
 return rows.map(row=>({...row,evidence:withLiveAmazonEvidence(row.evidence,invitations.get(row.workforce_id),portals.get(row.workforce_id))}));
}
export default async function AmazonPilotPage({searchParams={}}:{searchParams?:Record<string,string|undefined>}){
 const auth=await requirePagePermission('delivery_associates','access'),company=requireCompanyId(auth),db=supabaseAdmin;
 if(!db)throw new Error('Database unavailable.');
 const [stationResult,roleResult,pilotResult,invitationSettings,exitReasonsResult]=await Promise.all([
  db.from('stations').select('id,station_code,station_name,is_active,hide_from_location_list').eq('company_id',company).order('station_code'),
  db.from('designations').select('id,name,onboarding_role_ids,category:designation_categories!designations_designation_category_id_fkey(people_module)').eq('company_id',company).eq('is_active',true).order('name'),
  (auth.hasAllLocationAccess?db.from('workforce_amazon_pilots').select('*').eq('company_id',company):db.from('workforce_amazon_pilots').select('*').eq('company_id',company).in('station_id',auth.locationScopeIds.length?auth.locationScopeIds:['00000000-0000-0000-0000-000000000000'])).order('created_at',{ascending:false}).limit(500),
  db.from('workforce_amazon_station_settings').select('station_id').eq('company_id',company).eq('invitation_enabled',true),
  db.from('workforce_onboarding_exit_reasons').select('id,label').eq('company_id',company).eq('client_code','AMAZON')
 ]);
 const stations=filterOnboardingLocations(stationResult.data??[],auth),allowed=new Set(stations.map(s=>s.id));
 const invitationStations=stations.filter(s=>s.is_active&&(invitationSettings.data??[]).some(config=>config.station_id===s.id));
 let rows=await overlayLiveEvidence(company,((pilotResult.data??[]) as Pilot[]).filter(p=>auth.hasAllLocationAccess||allowed.has(p.station_id)));
 const requested=rows.find(row=>row.workforce_id===searchParams.id);
 if(requested){
  const live=await db.rpc('workforce_amazon_pilot_sources',{p_company:company,p_workforce:requested.workforce_id});
  if(!live.error&&live.data)rows=rows.map(row=>row.workforce_id===requested.workforce_id?{...row,evidence:live.data as Pilot['evidence']}:row);
 }
 const ids=rows.map(p=>p.workforce_id);
 const [peopleResult,aliasResult,emailMessageResult]=ids.length?await Promise.all([
  db.from('workforce').select('id,full_name,mobile,email,biometric_id').eq('company_id',company).in('id',ids),
  db.from('workforce_amazon_email_aliases').select('workforce_id,alias_email,status,last_message_at,routing_error,routing_rule_id').eq('company_id',company).in('workforce_id',ids),
  db.from('workforce_amazon_email_messages').select('workforce_id,sender,subject,action_url,received_at').eq('company_id',company).in('workforce_id',ids).order('received_at',{ascending:false})
 ]):[{data:[],error:null},{data:[],error:null},{data:[],error:null}];
 const people=new Map((peopleResult.data??[]).map(p=>[p.id,p as Person]));
 const aliases=new Map((aliasResult.data??[]).map(a=>[a.workforce_id,a as Alias]));
 const messages=new Map<string,AliasMessage>();(emailMessageResult.data??[]).forEach(message=>{if(!messages.has(message.workforce_id))messages.set(message.workforce_id,message as AliasMessage);});
 const exitReasons=new Map((exitReasonsResult.data??[]).map(reason=>[reason.id,reason.label]));
 const roles=(roleResult.data??[]).filter(r=>{const c=Array.isArray(r.category)?r.category[0]:r.category;return c?.people_module==='delivery_network'&&canOnboardDesignation(r,auth);});
 const counts=new Map<string,number>();rows.forEach(p=>{const s=pilotStatus(p).stage;counts.set(s,(counts.get(s)??0)+1);});
 const query=(searchParams.q??'').toLowerCase(),stage=searchParams.stage??'',stationFilter=searchParams.station??'';
 const filtered=rows.filter(p=>{const w=people.get(p.workforce_id),a=aliases.get(p.workforce_id);return (!stage||(stage==='scc_available'?['scc_available','delivery_started'].includes(pilotStatus(p).stage):pilotStatus(p).stage===stage))&&(!stationFilter||p.station_id===stationFilter)&&(!query||`${w?.full_name} ${w?.mobile} ${a?.alias_email??w?.email} ${p.evidence.employeeId??''}`.toLowerCase().includes(query));});
 const selected=rows.find(p=>p.workforce_id===searchParams.id),person=selected?people.get(selected.workforce_id):null,status=selected?pilotStatus(selected):null;
 const canAdd=hasPermission(auth,'delivery_associates','add')&&!auth.readOnly,canEdit=hasPermission(auth,'delivery_associates','edit')&&!auth.readOnly;
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const error=pilotResult.error||peopleResult.error||aliasResult.error||emailMessageResult.error?'Onboarding records could not be loaded. Please refresh.':stationResult.error||roleResult.error||invitationSettings.error||exitReasonsResult.error?'Onboarding configuration could not be loaded.':searchParams.error;
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
   <header><div><small>NEW ASSOCIATE</small><h2>Create email &amp; invite</h2><p>Reserve a unique backend email and send the Amazon invitation. The operational Driver ID appears later from LSC.</p></div></header>
   <AmazonPilotInviteForm path={path} today={today} stations={invitationStations.map(s=>({id:s.id,label:`${s.station_code} · ${s.station_name}`}))} roles={roles.map(r=>({id:r.id,label:r.name}))}/>
  </section>:null}
  <section className={styles.panel}>
   <header><div><small>LIVE OVERVIEW</small><h2>Associates</h2></div><span className={styles.count}>{filtered.length} associates</span></header>
   <form className={styles.filters} action={path}><label><Search size={16}/><input name="q" defaultValue={searchParams.q} placeholder="Search name, Driver ID or mobile" aria-label="Search associates"/></label><select name="stage" defaultValue={stage} aria-label="Filter stage"><option value="">All stages</option>{Object.entries(pilotStages).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select><select name="station" defaultValue={stationFilter} aria-label="Filter station"><option value="">All stations</option>{stations.map(s=><option value={s.id} key={s.id}>{s.station_code}</option>)}</select><button className={styles.secondary}>Apply</button></form>
   {!filtered.length?<div className={styles.empty}><Users size={30}/><h3>{rows.length?'No matching associates':'Your next associate starts here'}</h3><p>{rows.length?'Try another name, station or stage.':'Create their backend email, send the Amazon invitation and track each pending step in one place.'}</p>{!rows.length&&canAdd?<a className={styles.primary} href={`${path}?new=1#arrival`}>Invite first associate <ArrowRight size={16}/></a>:null}</div>:<div className={styles.tableWrap}><table><thead><tr><th>Associate</th><th>Station</th><th>DA In-App Onboarding</th><th>Last checked</th><th/></tr></thead><tbody>{filtered.map(p=>{const w=people.get(p.workforce_id),a=aliases.get(p.workforce_id),s=pilotStatus(p);return <tr key={p.workforce_id}><td><strong>{w?.full_name??'Associate'}</strong><small>Driver ID: {p.evidence.employeeId||'Awaiting LSC'}</small><small>{a?.alias_email??w?.email}</small></td><td><strong>{stations.find(x=>x.id===p.station_id)?.station_code}</strong></td><td><span className={styles.badge} data-stage={s.stage}>{s.label}</span><small>{p.closed_at&&p.exit_reason_id?exitReasons.get(p.exit_reason_id)??'Exit reason recorded':s.owner}{s.stale?' · Report may be outdated':''}{p.sync_error?' · Sync needs attention':''}</small></td><td><small>{format(p.exit_requested_at||p.last_checked_at)}</small></td><td><a className={styles.open} href={`${path}?id=${p.workforce_id}#associate`}>View <ArrowRight size={16}/></a></td></tr>;})}</tbody></table></div>}
  </section>
  {selected&&person&&status?<section className={styles.detail} id="associate">
   <div className={styles.panel}><header><div><small>ASSOCIATE</small><h2>{person.full_name}</h2><p>{stations.find(x=>x.id===selected.station_id)?.station_code} · {person.mobile}</p></div>{canEdit&&!selected.closed_at?<form action={updateAmazonPilot}><input type="hidden" name="id" value={selected.workforce_id}/><input type="hidden" name="action" value="refresh"/><SubmitButton className={styles.secondary} pendingText="Checking…"><RefreshCw size={15}/> Sync now</SubmitButton></form>:null}</header>
    <div className={styles.detailBody}><div className={styles.current}><Smartphone size={20}/><div><small>CURRENT STEP</small><h3>{status.label}</h3><p>{status.instruction}</p><span>{status.owner==='Associate'?'Associate action required':`Owner: ${status.owner}`}</span></div></div>
     <div className={styles.identityGrid}><div><span>LSC Driver ID</span><strong>{selected.evidence.employeeId||'Awaiting LSC'}</strong></div><div><span>Biometric ID · attendance only</span><strong>{person.biometric_id||'Pending'}</strong></div><div><span>Backend Amazon email</span><strong title={aliases.get(selected.workforce_id)?.alias_email||person.email}>{aliases.get(selected.workforce_id)?.alias_email||person.email}</strong></div><div><span>Amazon account</span><strong title={selected.evidence.providerId||''}>{selected.evidence.providerId?'Created':'Pending'}</strong></div></div>
     {selected.closed_at?<div className={styles.exitReview}><strong>Associate chose not to continue</strong><p>{selected.exit_reason_id?exitReasons.get(selected.exit_reason_id)??'Configured reason':'Reason not recorded'}{selected.exit_note?` · ${selected.exit_note}`:''}</p><small>Requested {format(selected.exit_requested_at)} through {selected.exit_requested_source==='associate'?'DropX One':'Workforce'}.</small></div>:null}
     {selected.sync_error?<p className={styles.error}>{selected.sync_error}</p>:null}{status.stale?<p className={styles.notice}>The onboarding report is older than 48 hours. This status reflects the latest available report.</p>:null}
     <details className={styles.evidence}><summary>Source evidence</summary><div className={styles.evidenceGrid}>{[['LSC Driver ID',selected.evidence.employeeId],['Transporter ID',selected.evidence.transporterId],['Amazon onboarding account',selected.evidence.providerId]].map(([label,id])=><div key={label}><span>{label}</span><code>{id||'Not received'}</code></div>)}</div><p>DA In-App report: {selected.evidence.reportDate||'Not received'} · SCC: {format(selected.evidence.sccAt)}</p></details>
    </div>
   </div>
   <aside className={styles.panel}><header><div><small>AMAZON INVITATION</small><h2>{selected.evidence.invitationStatus==='sent'?'Sent':selected.evidence.invitationStatus==='failed'?'Needs attention':'Queued'}</h2></div></header><div className={styles.detailBody}>
    <div className={styles.quickFact}><span>Backend email</span><strong>{aliases.get(selected.workforce_id)?.alias_email||person.email}</strong></div>
    <div className={styles.quickFact}><span>Inbox route</span><strong>{aliases.get(selected.workforce_id)?.status==='receiving'?'Receiving mail':aliases.get(selected.workforce_id)?.status==='routed'?'Ready':aliases.get(selected.workforce_id)?.status==='route_failed'?'Needs attention':'Reserved'}</strong>{aliases.get(selected.workforce_id)?.routing_error?<small>{aliases.get(selected.workforce_id)?.routing_error}</small>:null}</div>
    {messages.get(selected.workforce_id)?<div className={styles.quickFact}><span>Latest email · {format(messages.get(selected.workforce_id)?.received_at)}</span><strong>{messages.get(selected.workforce_id)?.subject||'Amazon onboarding email'}</strong>{messages.get(selected.workforce_id)?.action_url?<a className={styles.open} href={messages.get(selected.workforce_id)?.action_url??'#'} target="_blank" rel="noreferrer">Open Amazon action <ArrowRight size={15}/></a>:null}</div>:null}
    <div className={styles.quickFact}><span>Sent at</span><strong>{format(selected.evidence.invitationAt)}</strong></div>
    {selected.evidence.invitationError?<p className={styles.error}>{selected.evidence.invitationError}</p>:null}
    {canEdit&&selected.closed_at?<form action={updateAmazonPilot} className={styles.sideForm}><input type="hidden" name="id" value={selected.workforce_id}/><input type="hidden" name="action" value="reactivate"/><SubmitButton className={styles.primary} pendingText="Reactivating…">Reactivate onboarding</SubmitButton><small>Use this when the associate selected “not continuing” by mistake or returns to complete onboarding.</small></form>:canEdit?<><form action={updateAmazonPilot} className={styles.sideForm}><input type="hidden" name="id" value={selected.workforce_id}/><input type="hidden" name="action" value="queue"/><SubmitButton className={styles.secondary} pendingText="Checking…">Check invitation queue</SubmitButton><small>A sent invitation is retained without creating a duplicate.</small></form><details className={styles.sideForm}><summary>Close onboarding</summary><form action={updateAmazonPilot}><input type="hidden" name="id" value={selected.workforce_id}/><input type="hidden" name="action" value="close"/><label>Reason<textarea name="notes" required minLength={5} maxLength={1000}/></label><SubmitButton className={styles.secondary} pendingText="Closing…">Close onboarding</SubmitButton></form></details></>:null}
   </div></aside>
  </section>:null}
  <footer className={styles.pageFooter}><ShieldCheck size={14}/><span>Beta aliases and inbound mail are isolated from payroll.</span><span>Invitation status is live · DA report refreshes automatically</span></footer>
 </main></WorkforceOnboardingShell>;
}
