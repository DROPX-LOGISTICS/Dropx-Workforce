import { AlertTriangle,ArrowRight,CheckCircle2,Clock3,Mail,Plus,Search,ShieldCheck,Users } from 'lucide-react';
import { WorkforceOnboardingShell } from '@/components/workforce-onboarding-shell';
import { WorkforceLiveRefresh } from '@/components/workforce-live-refresh';
import { SubmitButton } from '@/components/submit-button';
import { requirePagePermission,hasPermission } from '@/lib/authorization';
import { requireCompanyId } from '@/lib/company-scope';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { filterOnboardingLocations } from '@/lib/onboarding-location-access';
import { canOnboardDesignation } from '@/lib/designation-onboarding-access';
import { updateAmazonPilot } from './actions';
import { AmazonPilotInviteForm } from './amazon-pilot-invite-form';
import styles from './pilot.module.css';

export const dynamic='force-dynamic';
const path='/delivery-network/amazon-pilot';
const format=(value:string|null|undefined)=>value?new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'}).format(new Date(value)):'Not yet';

type Candidate={id:string;station_id:string;designation_id:string;full_name:string;mobile:string;biometric_id:string;reported_on:string;alias_email:string;inbox_status:'reserved'|'routed'|'receiving'|'route_failed'|'suspended';routing_error:string|null;last_message_at:string|null;status:'ready'|'queued'|'sent'|'failed'|'email_received'|'closed';duplicate_identity_detected:boolean;duplicate_identity_summary:string|null;invitation_request_id:string|null;closed_at:string|null;close_reason:string|null;created_at:string;updated_at:string};
type Invitation={id:string;email_pilot_candidate_id:string;status:string;completed_at:string|null;external_reference:string|null;error_message:string|null;requested_at:string};
type Message={candidate_id:string;sender:string;subject:string;preview:string;action_url:string|null;received_at:string};

const labels:Record<Candidate['status'],string>={ready:'Email ready',queued:'Invitation queued',sent:'Invitation sent',failed:'Needs attention',email_received:'Amazon email received',closed:'Closed'};

export default async function AmazonPilotPage({searchParams={}}:{searchParams?:Record<string,string|undefined>}){
 const auth=await requirePagePermission('delivery_associates','access'),company=requireCompanyId(auth),db=supabaseAdmin;
 if(!db)throw new Error('Database unavailable.');
 const candidateQuery=auth.hasAllLocationAccess
  ?db.from('workforce_amazon_email_pilot_candidates').select('*').eq('company_id',company)
  :db.from('workforce_amazon_email_pilot_candidates').select('*').eq('company_id',company).in('station_id',auth.locationScopeIds.length?auth.locationScopeIds:['00000000-0000-0000-0000-000000000000']);
 const [stationResult,roleResult,candidateResult,settingsResult]=await Promise.all([
  db.from('stations').select('id,station_code,station_name,is_active,hide_from_location_list').eq('company_id',company).order('station_code'),
  db.from('designations').select('id,name,onboarding_role_ids,category:designation_categories!designations_designation_category_id_fkey(people_module)').eq('company_id',company).eq('is_active',true).order('name'),
  candidateQuery.order('created_at',{ascending:false}).limit(200),
  db.from('workforce_amazon_station_settings').select('station_id,associate_email_pattern').eq('company_id',company).eq('invitation_enabled',true)
 ]);
 const stations=filterOnboardingLocations(stationResult.data??[],auth),allowed=new Set(stations.map(station=>station.id)),stationById=new Map(stations.map(station=>[station.id,station]));
 const candidates=((candidateResult.data??[]) as Candidate[]).filter(candidate=>auth.hasAllLocationAccess||allowed.has(candidate.station_id));
 const ids=candidates.map(candidate=>candidate.id);
 const [inviteResult,messageResult]=ids.length?await Promise.all([
  db.from('workforce_amazon_invitation_requests').select('id,email_pilot_candidate_id,status,completed_at,external_reference,error_message,requested_at').eq('company_id',company).in('email_pilot_candidate_id',ids).order('requested_at',{ascending:false}),
  db.from('workforce_amazon_email_pilot_messages').select('candidate_id,sender,subject,preview,action_url,received_at').eq('company_id',company).in('candidate_id',ids).order('received_at',{ascending:false})
 ]):[{data:[],error:null},{data:[],error:null}];
 const invitations=new Map<string,Invitation>();(inviteResult.data??[]).forEach(row=>{if(row.email_pilot_candidate_id&&!invitations.has(row.email_pilot_candidate_id))invitations.set(row.email_pilot_candidate_id,row as Invitation);});
 const messages=new Map<string,Message>();(messageResult.data??[]).forEach(row=>{if(!messages.has(row.candidate_id))messages.set(row.candidate_id,row as Message);});
 const roles=(roleResult.data??[]).filter(role=>{const category=Array.isArray(role.category)?role.category[0]:role.category;return category?.people_module==='delivery_network'&&canOnboardDesignation(role,auth);});
 const configured=new Set((settingsResult.data??[]).filter(setting=>setting.associate_email_pattern).map(setting=>setting.station_id));
 const invitationStations=stations.filter(station=>station.is_active);
 const q=(searchParams.q??'').toLowerCase(),statusFilter=searchParams.status??'',stationFilter=searchParams.station??'';
 const shown=candidates.filter(candidate=>(!statusFilter||candidate.status===statusFilter)&&(!stationFilter||candidate.station_id===stationFilter)&&(!q||`${candidate.full_name} ${candidate.mobile} ${candidate.alias_email} ${candidate.biometric_id}`.toLowerCase().includes(q)));
 const selected=candidates.find(candidate=>candidate.id===searchParams.candidate),selectedInvite=selected?invitations.get(selected.id):undefined,selectedMessage=selected?messages.get(selected.id):undefined;
 const canAdd=hasPermission(auth,'delivery_associates','add')&&!auth.readOnly,canEdit=hasPermission(auth,'delivery_associates','edit')&&!auth.readOnly;
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const error=candidateResult.error||inviteResult.error||messageResult.error?'Pilot records could not be loaded. Refresh after the database release completes.':stationResult.error||roleResult.error||settingsResult.error?'Onboarding configuration could not be loaded.':searchParams.error;
 const open=candidates.filter(candidate=>!candidate.closed_at),attention=open.filter(candidate=>candidate.status==='failed'||candidate.inbox_status==='route_failed').length;

 return <WorkforceOnboardingShell active="onboarding"><main className={styles.page}>
  <header className={styles.hero}>
   <div><div className={styles.eyebrow}><span/> AMAZON EMAIL PILOT</div><h1>Invite &amp; track</h1><p>Two-station beta. Candidate data stays outside the canonical Workforce registry.</p></div>
   <div className={styles.heroActions}><WorkforceLiveRefresh seconds={30} refreshedAt={new Date().toISOString()}/>{canAdd?<a className={styles.primary} href={`${path}?new=1#arrival`}><Plus size={17}/> New pilot</a>:null}</div>
  </header>
  {error?<div className={styles.error} role="alert">{String(error)}</div>:null}
  {searchParams.notice?<div className={styles.notice} role="status">{searchParams.notice}</div>:null}
  <section className={styles.stats} aria-label="Pilot overview">{[
   {label:'Open pilots',value:open.length,icon:Users,filter:''},
   {label:'Queued',value:open.filter(candidate=>candidate.status==='queued').length,icon:Clock3,filter:'queued'},
   {label:'Invitation sent',value:open.filter(candidate=>candidate.status==='sent').length,icon:CheckCircle2,filter:'sent'},
   {label:'Needs attention',value:attention,icon:AlertTriangle,filter:'failed'}
  ].map(item=><a href={`${path}?status=${item.filter}`} key={item.label}><item.icon size={20}/><strong>{item.value}</strong><span>{item.label}</span></a>)}</section>
  {searchParams.new==='1'&&canAdd?<section className={styles.panel} id="arrival">
   <header><div><small>ISOLATED BETA</small><h2>Create email &amp; invite</h2><p>A unique inbound email is generated from the station master. No Workforce profile, pay mapping or DropX One account is created.</p></div></header>
   <AmazonPilotInviteForm path={path} today={today} stations={invitationStations.map(station=>({id:station.id,label:`${station.station_code} · ${station.station_name}`,configured:configured.has(station.id)}))} roles={roles.map(role=>({id:role.id,label:role.name}))}/>
  </section>:null}
  <section className={styles.panel}>
   <header><div><small>LIVE PILOT QUEUE</small><h2>Candidates</h2></div><span className={styles.count}>{shown.length} records</span></header>
   <form className={styles.filters} action={path}><label><Search size={16}/><input name="q" defaultValue={searchParams.q} placeholder="Search name, mobile, email or biometric ID" aria-label="Search candidates"/></label><select name="status" defaultValue={statusFilter} aria-label="Filter status"><option value="">All statuses</option>{Object.entries(labels).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select><select name="station" defaultValue={stationFilter} aria-label="Filter station"><option value="">All stations</option>{stations.map(station=><option value={station.id} key={station.id}>{station.station_code}</option>)}</select><button className={styles.secondary}>Apply</button></form>
   {!shown.length?<div className={styles.empty}><Mail size={30}/><h3>{candidates.length?'No matching candidates':'Pilot is ready'}</h3><p>{candidates.length?'Try another search or filter.':'Add the first real associate after configuring the two pilot stations.'}</p>{!candidates.length&&canAdd?<a className={styles.primary} href={`${path}?new=1#arrival`}>Start first pilot <ArrowRight size={16}/></a>:null}</div>:<div className={styles.tableWrap}><table><thead><tr><th>Candidate</th><th>Station</th><th>Backend email</th><th>Status</th><th/></tr></thead><tbody>{shown.map(candidate=>{const invitation=invitations.get(candidate.id);return <tr key={candidate.id}><td><strong>{candidate.full_name}</strong><small>{candidate.mobile} · Bio {candidate.biometric_id}</small></td><td><strong>{stationById.get(candidate.station_id)?.station_code}</strong><small>{candidate.reported_on}</small></td><td><strong>{candidate.alias_email}</strong><small>Inbox {candidate.inbox_status.replaceAll('_',' ')}</small></td><td><span className={styles.badge} data-stage={candidate.status}>{labels[candidate.status]}</span><small>{invitation?.error_message||format(invitation?.completed_at||candidate.updated_at)}</small></td><td><a className={styles.open} href={`${path}?candidate=${candidate.id}#candidate`}>View <ArrowRight size={16}/></a></td></tr>;})}</tbody></table></div>}
  </section>
  {selected?<section className={styles.detail} id="candidate">
   <div className={styles.panel}><header><div><small>PILOT CANDIDATE</small><h2>{selected.full_name}</h2><p>{stationById.get(selected.station_id)?.station_code} · {selected.mobile}</p></div><span className={styles.badge} data-stage={selected.status}>{labels[selected.status]}</span></header>
    <div className={styles.detailBody}>
     {selected.duplicate_identity_detected?<div className={styles.identityWarning}><AlertTriangle size={19}/><div><strong>Existing DropX identity flagged</strong><p>{selected.duplicate_identity_summary||'Review before later promotion to the canonical Workforce registry.'}</p></div></div>:null}
     <div className={styles.identityGrid}><div><span>Backend Amazon email</span><strong title={selected.alias_email}>{selected.alias_email}</strong></div><div><span>Biometric ID</span><strong>{selected.biometric_id}</strong></div><div><span>Inbox</span><strong>{selected.inbox_status.replaceAll('_',' ')}</strong></div><div><span>Canonical Workforce profile</span><strong>Not created</strong></div></div>
     {selected.routing_error?<p className={styles.error}>{selected.routing_error}</p>:null}
     {selectedMessage?<div className={styles.current}><Mail size={20}/><div><small>LATEST AMAZON EMAIL · {format(selectedMessage.received_at)}</small><h3>{selectedMessage.subject||'Amazon onboarding email'}</h3><p>{selectedMessage.preview}</p>{selectedMessage.action_url?<a className={styles.open} href={selectedMessage.action_url} target="_blank" rel="noreferrer">Open Amazon action <ArrowRight size={15}/></a>:null}</div></div>:null}
    </div>
   </div>
   <aside className={styles.panel}><header><div><small>AMAZON INVITATION</small><h2>{selectedInvite?.status?selectedInvite.status.replaceAll('_',' '):'Ready'}</h2></div></header><div className={styles.detailBody}>
    <div className={styles.quickFact}><span>Email</span><strong>{selected.alias_email}</strong></div>
    <div className={styles.quickFact}><span>Requested</span><strong>{format(selectedInvite?.requested_at)}</strong></div>
    <div className={styles.quickFact}><span>Completed</span><strong>{format(selectedInvite?.completed_at)}</strong></div>
    {selectedInvite?.error_message?<p className={styles.error}>{selectedInvite.error_message}</p>:null}
    {canEdit&&!selected.closed_at?<><form action={updateAmazonPilot} className={styles.sideForm}><input type="hidden" name="candidate_id" value={selected.id}/><input type="hidden" name="action" value="queue"/><SubmitButton className={styles.primary} pendingText="Checking…">{selected.status==='failed'?'Retry invitation':'Check invitation queue'}</SubmitButton><small>Sent requests are retained; this does not create duplicates.</small></form><details className={styles.sideForm}><summary>Close pilot</summary><form action={updateAmazonPilot}><input type="hidden" name="candidate_id" value={selected.id}/><input type="hidden" name="action" value="close"/><label>Reason<textarea name="notes" required minLength={5} maxLength={1000}/></label><SubmitButton className={styles.secondary} pendingText="Closing…">Close pilot</SubmitButton></form></details></>:selected.closed_at?<div className={styles.quickFact}><span>Closed</span><strong>{selected.close_reason}</strong></div>:null}
   </div></aside>
  </section>:null}
  <footer className={styles.pageFooter}><ShieldCheck size={14}/><span>Beta candidates, aliases and inbound email are isolated from canonical Workforce and payroll.</span><span>Amazon and IDfy workers remain unchanged.</span></footer>
 </main></WorkforceOnboardingShell>;
}
