import {ArrowRight,UserRoundPlus} from 'lucide-react';
import {AppShell} from '@/components/app-shell';
import {PendingLink} from '@/components/pending-link';
import {WorkforceJourneySummary} from '@/components/workforce-journey-summary';
import {hasPermission,requirePagePermission} from '@/lib/authorization';
import {loadWorkforceLifecycle} from '@/lib/workforce-lifecycle-data';
import {requireCompanyId} from '@/lib/company-scope';
import {supabaseAdmin} from '@/lib/supabase-admin';
export const dynamic='force-dynamic';
export default async function WorkforceDashboard(){
 const auth=await requirePagePermission('delivery_associates','access');
 let data:Awaited<ReturnType<typeof loadWorkforceLifecycle>>|null=null,error='',unmapped:number|null=null;
 try{
  data=await loadWorkforceLifecycle(auth);
  if(supabaseAdmin&&hasPermission(auth,'provider_mapping','access')){
   const result=await supabaseAdmin.rpc('workforce_unmapped_provider_ids',{p_company:requireCompanyId(auth),p_locations:auth.hasAllLocationAccess?null:auth.locationScopeIds});
   if(result.error)throw new Error('Unmapped provider IDs could not load.');unmapped=(result.data??[]).length;
  }
 }catch(cause){error=cause instanceof Error?cause.message:'Workforce data could not load.';}
 const states=data?[...data.readiness.values()]:null;
 const pending=states?.filter(row=>!['active','closed'].includes(row.phase))||[],due=states?.filter(row=>row.due)||[];
 const priority=(data?.records||[]).filter(row=>{const state=data?.readiness.get(row.accountId);return state&&!['active','closed'].includes(state.phase);}).sort((a,b)=>Number(data?.readiness.get(b.accountId)?.due)-Number(data?.readiness.get(a.accountId)?.due)).slice(0,8);
 return <AppShell active="Workforce Dashboard" pageCode="delivery_associates">
  <section className="wf-command-header wf-dashboard-intro"><div className="wf-command-intro"><span className="wf-live-status"><i/>Workforce</span><h1>Today</h1><p>One register. Every associate’s next action.</p></div><div className="wf-command-actions"><PendingLink className="wf-command-secondary" href="/delivery-network/associates">Open associates</PendingLink>{hasPermission(auth,'delivery_associates','add')&&!auth.readOnly?<PendingLink className="wf-command-primary" href="/delivery-network/onboarding/associates"><UserRoundPlus size={16}/>Invite associate</PendingLink>:null}</div></section>
  {error?<div className="message-panel error" role="alert">{error}</div>:null}
  <section className="performance-summary-grid" aria-label="Workforce today"><article><span>Needs action</span><strong>{states?pending.length:'—'}</strong><PendingLink href="/delivery-network/associates?view=pending">Open queue</PendingLink></article><article><span>Overdue</span><strong>{states?due.length:'—'}</strong><PendingLink href="/delivery-network/associates?view=pending&due=1">Invitations & follow-ups</PendingLink></article><article><span>Active</span><strong>{states?states.filter(row=>row.phase==='active').length:'—'}</strong><PendingLink href="/delivery-network/associates?view=active">View associates</PendingLink></article>{hasPermission(auth,'provider_mapping','access')?<article><span>Unmapped provider IDs</span><strong>{unmapped??'—'}</strong><PendingLink href="/delivery-network/rate-mapping">Confirm an associate</PendingLink></article>:null}</section>
  <div className="wf-command-board"><WorkforceJourneySummary states={states}/><section className="wf-command-panel"><header><div><span>Next actions</span><h2>Start here</h2></div></header><div className="wf-desk-actions">{priority.map(person=>{const state=data!.readiness.get(person.accountId)!;const canReview=person.profileType==='workforce'&&hasPermission(auth,'people_review','access');return <PendingLink key={person.profileType+person.accountId} href={canReview?`/delivery-network/associates?view=pending&person=${person.accountId}&section=${state.section}`:'/delivery-network/associates?view=pending'}><div><strong>{person.name}</strong><small>{person.location} · {state.due?'Overdue · ':''}{state.label}</small></div><ArrowRight size={16}/></PendingLink>;})}{data&&!priority.length?<p style={{padding:16}}>No outstanding lifecycle actions in your stations.</p>:null}</div></section></div>
  <section className="wf-command-panel" style={{marginTop:16}}><header><h2>Daily operations</h2></header><div className="component-chip-list" style={{padding:16}}><PendingLink className="button secondary compact" href="/delivery-network/associates?view=referrals">Referred candidates</PendingLink>{[['workforce_activity','activity','Attendance & output'],['workforce_earnings','earnings','Earnings'],['workforce_payroll','payroll','Payouts'],['workforce_communications','communications','Messages'],['executive_id_onboarding','amazon-onboarding-settings?tab=reminders','Reminder setup & delivery']].filter(([code])=>hasPermission(auth,code,'access')).map(([code,path,label])=><PendingLink key={code} className="button secondary compact" href={'/delivery-network/'+path}>{label}</PendingLink>)}</div></section>
 </AppShell>;
}
