import {hasPermission,type AuthorizationContext} from '@/lib/authorization';
import {loadWorkforceJoining} from '@/lib/workforce-joining-data';
import {providerStages,isBiometricDay} from '@/lib/workforce-joining';
import {AssociateRegistrationDetails} from './associate-registration-details';
import {AssociatePaymentStages,type PersonalMapping,type StagePaymentMethod} from './associate-payment-stages';
import {supabaseAdmin} from '@/lib/supabase-admin';
import {requireCompanyId} from '@/lib/company-scope';
import {readAllRows} from '@/lib/supabase-pagination';
import {workforceToday} from '@/lib/workforce-earnings';
import {ProviderMappingPageContent} from './provider-mapping-page-content';
import {WorkforceAssociateEarnings} from './workforce-associate-earnings';
import './workforce-simple-review.css';

export async function WorkforceAssociateSetup({auth,id,dateOfJoin,tab,section='profile',from,to}:{auth:AuthorizationContext;id:string;dateOfJoin:string|null;tab:string;section?:string;from?:string;to?:string}){
 if(section==='exit')return <p>Record the last working day, complete clearance and reconcile the final Finance-paid payout before deactivation.</p>;
 if(section==='earnings')return hasPermission(auth,'workforce_earnings','access')?<WorkforceAssociateEarnings auth={auth} id={id} tab={tab} from={from} to={to}/>:<p>You do not have earnings access.</p>;
 const today=workforceToday();
 const data=await loadWorkforceJoining(auth,{to:today,workforceId:id});
 const person=data.profiles.find(p=>p.id===id);if(!person)return null;
 const plan=data.plans.find(p=>p.workforce_id===id)??null;
 const company=requireCompanyId(auth);
 const [history,methodRows,sourceRows]=section==='payments'?await Promise.all([
  readAllRows(supabaseAdmin!.from('field_executive_provider_mappings').select('id,provider_member_id,effective_from,effective_to,payment_method_id,payment_values,pay_type,reason,updated_at').eq('company_id',company).eq('workforce_id',id).neq('status','cancelled').order('effective_from',{ascending:false}).order('id')),
  readAllRows(supabaseAdmin!.from('payment_methods').select('id,code,name,payment_method_components(component_code,label,sort_order)').eq('company_id',company).eq('is_active',true).order('name')),
  readAllRows(supabaseAdmin!.from('workforce_payment_method_sources').select('payment_method_id,source_of_truth').eq('company_id',company))
 ]):[{data:[],error:null},{data:[],error:null},{data:[],error:null}];
 if(history.error||methodRows.error||sourceRows.error)throw new Error('Payment methods or history could not load.');
 const sourceByMethod=new Map((sourceRows.data||[]).map(row=>[row.payment_method_id,row.source_of_truth]));
 type MethodComponent={component_code:string;label:string;sort_order:number};
 const methods=(methodRows.data||[]).flatMap(row=>sourceByMethod.has(row.id)?[{id:row.id,code:row.code,name:row.name,sourceOfTruth:sourceByMethod.get(row.id)!,components:((row.payment_method_components||[]) as MethodComponent[]).slice().sort((a,b)=>a.sort_order-b.sort_order).map(component=>({code:component.component_code,label:component.label}))}]:[]) as StagePaymentMethod[];
 const biometric=data.attendance.filter(d=>isBiometricDay(d,person.location_id));
 return <section className="wf-simple-setup">
  {section==='profile'?<>
  <AssociateRegistrationDetails auth={auth} id={id}/>
  <header><h3>Biometric attendance</h3><p>ID: <strong>{person.biometric_id||'Enrol at station on day one'}</strong> · {new Set(biometric.map(d=>d.punch_date)).size} punched days since {dateOfJoin||'joining date not set'}</p></header>
  <details><summary>View daily punches ({data.attendance.length})</summary><div className="table-wrap"><table><thead><tr><th>Date</th><th>In / out (IST)</th><th>Minutes</th><th>Attendance</th></tr></thead><tbody>{data.attendance.map(d=><tr key={d.id}><td>{d.punch_date}</td><td>{[d.in_time,d.out_time].map(v=>v?new Date(v).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'}):'Missing').join(' – ')}</td><td>{d.work_minutes??'—'}</td><td>{d.flagged?'Flagged — review':isBiometricDay(d,person.location_id)?'Biometric · '+d.status:'Review source / station'}</td></tr>)}</tbody></table>{!data.attendance.length?<p>No punches found for this identity and joining period.</p>:null}</div></details>
  <p><a href="/delivery-network/id-onboarding?view=pending">Next: complete work setup →</a></p>
  </>:null}
  {section==='payments'?<>
  <header><h3>Payment configuration</h3><p>View existing rates and effective dates. Changes apply only to this associate.</p></header>
  <AssociatePaymentStages id={id} tab={tab} rows={(history.data||[]) as PersonalMapping[]} methods={methods} canEdit={hasPermission(auth,'provider_mapping','edit')&&!auth.readOnly}/>
  {hasPermission(auth,'provider_mapping','access')?<section><h3>Provider ID & rate mapping</h3><ProviderMappingPageContent embedded workforceId={id}/></section>:null}
  <p><a href="/delivery-network/id-onboarding?view=pending">View partner-account readiness</a></p>
  </>:null}
  {section==='training'||section==='activation'?<>
  <header><h3>Partner account setup</h3><p>Complete the account required by the assigned delivery partner. Amazon assignments use the invitation worker and DA In-App evidence; other partners follow their configured setup.</p></header>
  <p>Current stage: <strong>{providerStages[plan?.provider_stage as keyof typeof providerStages]||'Invitation not started'}</strong></p>
  <p>Account login: <strong>{plan?.contact_email||'Configure in the setup desk'}</strong></p>
  <p><a href={`/delivery-network/id-onboarding?view=pending&q=${encodeURIComponent(person.dropx_id||person.full_name)}`}>Open account tasks, imported evidence and exceptions →</a></p>
  <p><a href={`?tab=${tab}&person=${id}&section=payments`}>Next: confirm external ID and commercial terms →</a></p>
  </>:null}
 </section>;
}
