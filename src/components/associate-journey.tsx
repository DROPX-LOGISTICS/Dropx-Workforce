import {hasPermission,type AuthorizationContext} from '@/lib/authorization';
import {requireCompanyId} from '@/lib/company-scope';
import {supabaseAdmin} from '@/lib/supabase-admin';
import {loadPartnerOnboardingStates} from '@/lib/partner-onboarding';
import {lifecycleReadiness} from '@/lib/workforce-workbench';
import type {loadWorkforceJoining} from '@/lib/workforce-joining-data';
import {workforceToday} from '@/lib/workforce-earnings';
import {queueAmazonInvitation} from '@/app/delivery-network/id-onboarding/actions';
import {PartnerProgressNote} from './partner-progress-note';
import {PendingLink} from './pending-link';
import {SubmitButton} from './submit-button';
import {headers} from 'next/headers';
import './associate-workbench.css';
export async function AssociateJourney({auth,id,data}:{auth:AuthorizationContext;id:string;data:Awaited<ReturnType<typeof loadWorkforceJoining>>}){
 const person=data.profiles.find(row=>row.id===id);if(!person||!supabaseAdmin)return null;
 const partner=(await loadPartnerOnboardingStates(supabaseAdmin,requireCompanyId(auth),[id])).get(id);
 const ready=lifecycleReadiness(person,partner,data.mappings,workforceToday());
 const href=(section:string)=>{let query=new URLSearchParams({person:id});try{const ref=new URL(headers().get('referer')||'');if(ref.pathname==='/delivery-network/associates')query=new URLSearchParams(ref.search);}catch{}query.delete('error');query.delete('notice');query.set('person',id);query.set('section',section);return '?'+query;};
 const current=data.mappings.filter(row=>row.status!=='cancelled'&&row.effective_from<=workforceToday()&&(!row.effective_to||row.effective_to>=workforceToday())&&row.station_id===person.location_id);
 const canEdit=hasPermission(auth,'delivery_associates','edit')&&!auth.readOnly;
 const canInvite=hasPermission(auth,'executive_id_onboarding','edit')&&!auth.readOnly;
 const summary=ready.phase==='review'?'Registration submitted. Review the documents and configured approval checklist.':ready.phase==='registration'?'The associate must complete or correct their registration in DropX One.':ready.phase==='pay'?'Provider mapping is confirmed. Set the applicable payment components, amounts and effective dates.':ready.phase==='activation'?'Registration is approved. Review and activate this assignment after its required setup is complete.':ready.phase==='closed'?'This assignment is closed. Review exit and settlement records.':ready.phase==='active'?'The associate is active. Review attendance, earnings and future rate changes here.':partner?.instruction||'Review the outstanding requirement.';
 const company=requireCompanyId(auth);
 const [events,onboardingEvents,messages,invitation]=await Promise.all([
 supabaseAdmin.from('workforce_joining_events').select('id,event_code,actor_name,created_at').eq('company_id',company).eq('workforce_id',id).order('created_at',{ascending:false}).limit(12),
 supabaseAdmin.from('workforce_onboarding_events').select('id,event_code,source_portal,created_at').eq('company_id',company).eq('workforce_id',id).order('created_at',{ascending:false}).limit(12),
 supabaseAdmin.from('workforce_partner_reminder_events').select('id,stage_code,created_at,whatsapp_campaigns(status,sent_count,failed_count)').eq('company_id',company).eq('workforce_id',id).order('created_at',{ascending:false}).limit(12),
 supabaseAdmin.from('workforce_amazon_invitation_requests').select('status,requested_at,completed_at,error_message').eq('company_id',company).eq('workforce_id',id).order('requested_at',{ascending:false}).limit(1).maybeSingle()
 ]);
 const history=[...(events.data||[]).map(row=>({...row,who:row.actor_name})),...(onboardingEvents.data||[]).map(row=>({...row,who:row.source_portal}))].sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,15);
 return <>
  <section className="wf-journey-next"><header><strong>{ready.label}</strong>{ready.due?<span className="status">Due since {partner?.due_since}</span>:null}</header><p>{summary}</p>
   {ready.section!=='journey'&&(ready.section!=='payments'||hasPermission(auth,'provider_mapping','access'))?<PendingLink className="button compact" href={href(ready.section)}>{ready.phase==='review'?'Review registration':ready.phase==='mapping'?'Confirm ID & rates':ready.phase==='pay'?'Configure rates':ready.phase==='closed'?'Review exit':'Open registration'}</PendingLink>:null}
  </section>
  <dl className="wf-journey-evidence"><div><dt>Registration</dt><dd>{person.onboarding_status?.replaceAll('_',' ')||'Pending'}</dd></div><div><dt>Biometric ID</dt><dd>{person.biometric_id||'Enrol at station'}</dd></div><div><dt>Reported on</dt><dd>{partner?.reported_on||'Not recorded'}</dd></div><div><dt>Partner account</dt><dd>{partner?.label||'No partner workflow required'}</dd></div><div><dt>Provider mapping</dt><dd>{current.map(row=>row.provider_member_id).filter(Boolean).join(', ')||(partner?'Confirmation pending':'Not configured')}</dd></div><div><dt>Pay setup</dt><dd>{current.some(row=>row.payment_method_id)?'Effective rates configured':'Review applicable terms'}</dd></div></dl>
  {partner?<section className="wf-journey-details"><h3>{partner.provider_name} account</h3><p>{partner.instruction}</p>
   {partner.can_trigger&&canInvite?<form action={queueAmazonInvitation}><input type="hidden" name="return_to_register" value="1"/><input type="hidden" name="workforce_id" value={id}/><input type="hidden" name="amazon_email" value={person.email||''}/><SubmitButton className="button compact" pendingText="Queuing invitation…">{partner.invitation_status==='failed'?'Retry invitation':`Request ${partner.provider_name} ID`}</SubmitButton></form>:null}
   {invitation.data?<details><summary>Invitation request · {invitation.data.status}</summary><p>Requested {new Date(invitation.data.requested_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}</p>{invitation.data.error_message?<p role="alert">{invitation.data.error_message}</p>:null}</details>:null}
   <PartnerProgressNote state={partner} workforceId={id} canEdit={canEdit}/>
   {partner.transporter_id?<p>Imported transporter ID: <strong>{partner.transporter_id}</strong> · {partner.mapping_confirmed?'Mapping confirmed':'Evidence only; mapping requires confirmation'}</p>:null}
  </section>:null}
  <details className="wf-journey-details"><summary>Recent activity</summary>{events.error||onboardingEvents.error?<p>Activity could not load. Refresh to retry.</p>:history.length?<dl>{history.map(event=><div key={event.id}><dt>{event.event_code.replaceAll('_',' ')}</dt><dd>{event.who} · {new Date(event.created_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}</dd></div>)}</dl>:<p>No recorded lifecycle actions yet.</p>}</details>
  <details className="wf-journey-details"><summary>Associate follow-up messages</summary>{messages.error?<p>Message history could not load.</p>:messages.data?.length?<dl>{messages.data.map((message:any)=><div key={message.id}><dt>{message.stage_code.replaceAll('_',' ')}</dt><dd>{message.whatsapp_campaigns?.status||'Queued'} · {message.whatsapp_campaigns?.sent_count||0} sent · {message.whatsapp_campaigns?.failed_count||0} failed · {new Date(message.created_at).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata'})}</dd></div>)}</dl>:<p>No automatic follow-up messages recorded for this associate.</p>}</details>
 </>;
}
