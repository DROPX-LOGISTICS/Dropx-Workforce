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
import './workforce-simple-review.css';

export async function WorkforceAssociateSetup({auth,id,dateOfJoin,tab,section='profile'}:{auth:AuthorizationContext;id:string;dateOfJoin:string|null;tab:string;section?:string}){
 const today=workforceToday();
 const data=await loadWorkforceJoining(auth,{to:today,workforceId:id});
 const person=data.profiles.find(p=>p.id===id);if(!person)return null;
 const plan=data.plans.find(p=>p.workforce_id===id)??null;
 const defaults=data.policies.filter(p=>p.station_id===person.location_id&&p.is_active).sort((a,b)=>b.effective_from.localeCompare(a.effective_from))[0];
 const days=plan?trainingEntitlements(person,plan,data.mappings,data.attendance,plan.eligible_from,today):[];
 const editable=hasPermission(auth,'people_review','edit')&&!auth.readOnly;
 const history=await readAllRows(supabaseAdmin!.from('field_executive_provider_mappings').select('id,provider_member_id,effective_from,effective_to,payment_values,pay_type,reason,updated_at').eq('company_id',requireCompanyId(auth)).eq('workforce_id',id).neq('status','cancelled').order('effective_from',{ascending:false}).order('id'));
 if(history.error)throw new Error('Payment history could not load.');
 const biometric=data.attendance.filter(d=>isBiometricDay(d,person.location_id));
 return <section className="wf-simple-setup">
  <a href="/delivery-network/associates">← Workforce register</a>
  <nav className="workforce-lifecycle-tabs" aria-label="Associate profile sections">{[['profile','Profile & attendance'],['payments','Payment configuration']].map(([key,label])=><a className={section===key?'active':''} aria-current={section===key?'page':undefined} key={key} href={`?tab=${tab}&person=${id}&section=${key}`}>{label}</a>)}</nav>
  {section!=='payments'?<>
  <AssociateRegistrationDetails auth={auth} id={id}/>
  <header><h3>Biometric attendance</h3><p>ID: <strong>{person.biometric_id||'Enrol at station on day one'}</strong> · {new Set(biometric.map(d=>d.punch_date)).size} punched days since {dateOfJoin||'joining date not set'}</p></header>
  <details><summary>View daily punches ({data.attendance.length})</summary><div className="table-wrap"><table><thead><tr><th>Date</th><th>In / out (IST)</th><th>Minutes</th><th>Attendance</th></tr></thead><tbody>{data.attendance.map(d=><tr key={d.id}><td>{d.punch_date}</td><td>{[d.in_time,d.out_time].map(v=>v?new Date(v).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'}):'Missing').join(' – ')}</td><td>{d.work_minutes??'—'}</td><td>{d.flagged?'Flagged — review':isBiometricDay(d,person.location_id)?'Biometric · '+d.status:'Review source / station'}</td></tr>)}</tbody></table>{!data.attendance.length?<p>No punches found for this identity and joining period.</p>:null}</div></details>
  <p><a href={`?tab=${tab}&person=${id}&section=payments`}>Configure training, provider ID & payment stages →</a></p>
  </>:<>
  <header><h3>Payment configuration</h3><p>View existing rates and effective dates. Changes apply only to this associate.</p></header>
  <AssociatePaymentStages id={id} tab={tab} rows={(history.data||[]) as PersonalMapping[]} canEdit={hasPermission(auth,'provider_mapping','edit')&&!auth.readOnly}/>
  {hasPermission(auth,'provider_mapping','access')?<details open><summary>Configure provider ID & payment method</summary><ProviderMappingPageContent embedded workforceId={id}/></details>:null}
  <details><summary>Training pay & Amazon progress</summary>
  <p>Biometric ID: <strong>{person.biometric_id||'Enrol at station on day one'}</strong></p>
  {['approved','active'].includes(person.onboarding_status||'')?<>
   <form action={saveReviewTerms} className="wf-simple-fields">
    <input name="workforce_id" type="hidden" value={id}/><input name="version" type="hidden" value={plan?.version??0}/><input name="tab" type="hidden" value={tab}/>
    <label>Joining type<select name="mode" defaultValue={plan?.mode??'training'} disabled={!editable}><option value="training">Training before own ID</option><option value="direct">Direct joining · no training</option></select></label>
    <label>Attendance / training from<input name="eligible_from" type="date" required defaultValue={plan?.eligible_from??dateOfJoin??''} disabled={!editable}/></label>
    <label>Training through<input name="training_completed_on" type="date" max={today} defaultValue={plan?.training_completed_on??''} disabled={!editable}/><small>Leave blank until mapped. Own-ID effective date ends training.</small></label>
    <label>Training pay / day (₹)<input name="daily_rate" type="number" min="0.01" step="0.01" defaultValue={plan?.daily_rate??defaults?.daily_rate??''} disabled={!editable}/></label>
    <label>Minimum biometric minutes<input name="minimum_minutes" type="number" min="1" max="1440" defaultValue={plan?.minimum_minutes??defaults?.minimum_minutes??''} disabled={!editable}/></label>
    <label>Amazon ID progress<select name="provider_stage" defaultValue={plan?.provider_stage??'not_started'} disabled={!editable}>{Object.entries(providerStages).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <label>Provider reference<input name="provider_reference" defaultValue={plan?.provider_reference??''} disabled={!editable}/></label>
    <label>Agreed terms / change reason<input name="terms_reference" required minLength={3} maxLength={1000} defaultValue={plan?.terms_reference??defaults?.policy_reference??''} disabled={!editable}/></label>
    {editable?<SubmitButton pendingText="Saving">Save training & progress</SubmitButton>:null}
   </form>
   <details><summary>Biometric training: {days.filter(d=>!d.holds.length).length} payable days · ₹{days.filter(d=>!d.holds.length).reduce((n,d)=>n+d.amount,0).toLocaleString('en-IN')}</summary><div className="table-wrap"><table><thead><tr><th>Date</th><th>Minutes</th><th>Payment</th><th>Status</th></tr></thead><tbody>{days.map(d=><tr key={d.attendance.id}><td>{d.attendance.punch_date}</td><td>{d.attendance.work_minutes}</td><td>₹{d.amount}</td><td>{d.holds.join(' · ')||'Payable'}</td></tr>)}</tbody></table>{!days.length?<p>No eligible biometric attendance recorded yet.</p>:null}</div></details>
  </>:<p>Approve the submitted registration below, then configure training and map the provider ID here.</p>}
  </details>
  <details><summary>Detailed Amazon checklist</summary><a href={`/delivery-network/joining?person=${id}`}>Open checklist and follow-up history</a></details>
  </>}
 </section>;
}
