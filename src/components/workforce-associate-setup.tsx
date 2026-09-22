import {hasPermission,type AuthorizationContext} from '@/lib/authorization';
import {loadWorkforceJoining} from '@/lib/workforce-joining-data';
import {trainingEntitlements,providerStages,isBiometricDay} from '@/lib/workforce-joining';
import {AssociateRegistrationDetails} from './associate-registration-details';
import {AssociatePaymentStages,type PersonalMapping} from './associate-payment-stages';
import {supabaseAdmin} from '@/lib/supabase-admin';
import {requireCompanyId} from '@/lib/company-scope';
import {readAllRows} from '@/lib/supabase-pagination';
import {workforceToday} from '@/lib/workforce-earnings';
import {saveReviewTerms} from '@/app/delivery-network/lifecycle/terms-actions';
import {ProviderMappingPageContent} from './provider-mapping-page-content';
import {SubmitButton} from './submit-button';
import {WorkforceTrainingModeFields} from './workforce-training-mode-fields';
import {WorkforceAssociateEarnings} from './workforce-associate-earnings';
import './workforce-simple-review.css';

export async function WorkforceAssociateSetup({auth,id,dateOfJoin,tab,section='profile',from,to}:{auth:AuthorizationContext;id:string;dateOfJoin:string|null;tab:string;section?:string;from?:string;to?:string}){
 if(section==='exit')return <p>Record the last working day, complete clearance and reconcile the final Finance-paid payout before deactivation.</p>;
 if(section==='earnings')return hasPermission(auth,'workforce_earnings','access')?<WorkforceAssociateEarnings auth={auth} id={id} tab={tab} from={from} to={to}/>:<p>You do not have earnings access.</p>;
 const today=workforceToday();
 const data=await loadWorkforceJoining(auth,{to:today,workforceId:id});
 const person=data.profiles.find(p=>p.id===id);if(!person)return null;
 const plan=data.plans.find(p=>p.workforce_id===id)??null;
 const defaults=data.policies.filter(p=>p.station_id===person.location_id&&p.is_active&&p.effective_from<=today&&(!p.effective_to||p.effective_to>=today)).sort((a,b)=>b.effective_from.localeCompare(a.effective_from))[0];
 const days=plan?trainingEntitlements(person,plan,data.mappings,data.attendance,plan.eligible_from,today):[];
 const editable=hasPermission(auth,'people_review','edit')&&!auth.readOnly;
 const history=section==='payments'?await readAllRows(supabaseAdmin!.from('field_executive_provider_mappings').select('id,provider_member_id,effective_from,effective_to,payment_values,pay_type,reason,updated_at').eq('company_id',requireCompanyId(auth)).eq('workforce_id',id).neq('status','cancelled').order('effective_from',{ascending:false}).order('id')):{data:[],error:null};
 if(history.error)throw new Error('Payment history could not load.');
 const biometric=data.attendance.filter(d=>isBiometricDay(d,person.location_id));
 return <section className="wf-simple-setup">
  {section==='profile'?<>
  <AssociateRegistrationDetails auth={auth} id={id}/>
  <header><h3>Biometric attendance</h3><p>ID: <strong>{person.biometric_id||'Enrol at station on day one'}</strong> · {new Set(biometric.map(d=>d.punch_date)).size} punched days since {dateOfJoin||'joining date not set'}</p></header>
  <details><summary>View daily punches ({data.attendance.length})</summary><div className="table-wrap"><table><thead><tr><th>Date</th><th>In / out (IST)</th><th>Minutes</th><th>Attendance</th></tr></thead><tbody>{data.attendance.map(d=><tr key={d.id}><td>{d.punch_date}</td><td>{[d.in_time,d.out_time].map(v=>v?new Date(v).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'}):'Missing').join(' – ')}</td><td>{d.work_minutes??'—'}</td><td>{d.flagged?'Flagged — review':isBiometricDay(d,person.location_id)?'Biometric · '+d.status:'Review source / station'}</td></tr>)}</tbody></table>{!data.attendance.length?<p>No punches found for this identity and joining period.</p>:null}</div></details>
  <p><a href={`?tab=${tab}&person=${id}&section=training`}>Next: training or direct joining →</a></p>
  </>:null}
  {section==='payments'?<>
  <header><h3>Payment configuration</h3><p>View existing rates and effective dates. Changes apply only to this associate.</p></header>
  <AssociatePaymentStages id={id} tab={tab} rows={(history.data||[]) as PersonalMapping[]} canEdit={hasPermission(auth,'provider_mapping','edit')&&!auth.readOnly}/>
  {hasPermission(auth,'provider_mapping','access')?<details open={!history.data?.length}><summary>{history.data?.length?'Change provider mapping / other pay methods':'Configure provider ID & payment method'}</summary><ProviderMappingPageContent embedded workforceId={id}/></details>:null}
  <p><a href={`?tab=${tab}&person=${id}&section=training`}>View or change training terms</a></p>
  </>:null}
  {section==='training'?<>
  <header><h3>Training & ID progress</h3><p>Use station biometrics. Skip training for direct joining.</p></header>
  <p>Biometric ID: <strong>{person.biometric_id||'Enrol at station on day one'}</strong></p>
  {['approved','active'].includes(person.onboarding_status||'')?<>
   <form action={saveReviewTerms} className="wf-simple-fields">
    <input name="workforce_id" type="hidden" value={id}/><input name="version" type="hidden" value={plan?.version??0}/><input name="tab" type="hidden" value={tab}/>
    <WorkforceTrainingModeFields mode={plan?.mode??'training'} from={plan?.eligible_from??dateOfJoin??''} through={plan?.training_completed_on??''} rate={plan?.daily_rate??defaults?.daily_rate??''} minutes={plan?.minimum_minutes??defaults?.minimum_minutes??''} today={today} disabled={!editable}/>
    <label>Amazon ID progress<select name="provider_stage" defaultValue={plan?.provider_stage??'not_started'} disabled={!editable}>{Object.entries(providerStages).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <label>Provider reference<input name="provider_reference" defaultValue={plan?.provider_reference??''} disabled={!editable}/></label>
    <label>Agreed terms / change reason<input name="terms_reference" required minLength={3} maxLength={1000} defaultValue={plan?.terms_reference??defaults?.policy_reference??''} disabled={!editable}/></label>
    {editable?<SubmitButton pendingText="Saving">Save training & progress</SubmitButton>:null}
   </form>
   <details><summary>Biometric training: {days.filter(d=>!d.holds.length).length} payable days · ₹{days.filter(d=>!d.holds.length).reduce((n,d)=>n+d.amount,0).toLocaleString('en-IN')}</summary><div className="table-wrap"><table><thead><tr><th>Date</th><th>Minutes</th><th>Payment</th><th>Status</th></tr></thead><tbody>{days.map(d=><tr key={d.attendance.id}><td>{d.attendance.punch_date}</td><td>{d.attendance.work_minutes}</td><td>₹{d.amount}</td><td>{d.holds.join(' · ')||'Payable'}</td></tr>)}</tbody></table>{!days.length?<p>No eligible biometric attendance recorded yet.</p>:null}</div></details>
  </>:<p><a href={`?tab=${tab}&person=${id}&section=profile`}>Review and approve registration</a> before setting training terms.</p>}
  <details><summary>Detailed Amazon checklist</summary><a href={`/delivery-network/joining?person=${id}`}>Open checklist and follow-up history</a></details>
  <p><a href={`?tab=${tab}&person=${id}&section=payments`}>Next: map provider ID & regular payment →</a></p>
  </>:null}
 </section>;
}
