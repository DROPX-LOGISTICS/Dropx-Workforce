import {AssociateJourney} from "./associate-journey";
import {hasPermission,type AuthorizationContext} from '@/lib/authorization';
import {loadWorkforceJoining} from '@/lib/workforce-joining-data';
import {isBiometricDay} from '@/lib/workforce-joining';
import {AssociateRegistrationDetails} from './associate-registration-details';
import {AssociatePaymentStages,type PersonalMapping,type StagePaymentMethod} from './associate-payment-stages';
import {supabaseAdmin} from '@/lib/supabase-admin';
import {requireCompanyId} from '@/lib/company-scope';
import {readAllRows} from '@/lib/supabase-pagination';
import {workforceToday} from '@/lib/workforce-earnings';
import {componentRuleLabel,type PaymentComponentRule} from '@/lib/payment-component-rules';
import {ProviderMappingPageContent} from './provider-mapping-page-content';
import {WorkforceAssociateEarnings} from './workforce-associate-earnings';
import './workforce-simple-review.css';

export async function WorkforceAssociateSetup({auth,id,dateOfJoin,tab,section='profile',from,to}:{auth:AuthorizationContext;id:string;dateOfJoin:string|null;tab:string;section?:string;from?:string;to?:string}){
 if(section==='payments'&&!hasPermission(auth,'provider_mapping','access'))return <p>Your role does not have access to payment terms. Contact the Workforce team responsible for ID and rates.</p>;
 if(section==='exit')return <p>Record the last working day, complete clearance and reconcile the final Finance-paid payout before deactivation.</p>;
 if(section==='earnings')return hasPermission(auth,'workforce_earnings','access')?<WorkforceAssociateEarnings auth={auth} id={id} tab={tab} from={from} to={to}/>:<p>You do not have earnings access.</p>;
 const today=workforceToday();
 const data=await loadWorkforceJoining(auth,{to:today,workforceId:id,evidence:section==='profile'});
 const person=data.profiles.find(p=>p.id===id);if(!person)return null;
 if(['journey','activation','training'].includes(section))return <AssociateJourney auth={auth} id={id} data={data}/>;
 const company=requireCompanyId(auth);
 const [history,methodRows,sourceRows]=section==='payments'?await Promise.all([
  readAllRows(supabaseAdmin!.from('field_executive_provider_mappings').select('id,provider_member_id,effective_from,effective_to,payment_method_id,payment_values,pay_type,reason,updated_at').eq('company_id',company).eq('workforce_id',id).neq('status','cancelled').order('effective_from',{ascending:false}).order('id')),
  readAllRows(supabaseAdmin!.from('payment_methods').select('id,code,name,payment_method_components(payment_field_id,component_code,label,sort_order),workforce_payment_method_designations(designation_id)').eq('company_id',company).eq('is_active',true).order('name')),
  readAllRows(supabaseAdmin!.from('workforce_payment_method_component_sources').select('payment_method_id,payment_field_id,source_of_truth,calculation_basis,source_metric,minimum_units').eq('company_id',company))
 ]):[{data:[],error:null},{data:[],error:null},{data:[],error:null}];
 if(history.error||methodRows.error||sourceRows.error)throw new Error('Payment methods or history could not load.');
 const sourceByComponent=new Map((sourceRows.data||[]).map(row=>[`${row.payment_method_id}:${row.payment_field_id}`,row]));
 type MethodComponent={payment_field_id:string;component_code:string;label:string;sort_order:number};
 const methods=(methodRows.data||[]).flatMap(row=>(row.workforce_payment_method_designations||[]).some((rule:{designation_id:string})=>rule.designation_id===person.designation_id)?[{id:row.id,code:row.code,name:row.name,components:((row.payment_method_components||[]) as MethodComponent[]).slice().sort((a,b)=>a.sort_order-b.sort_order).map(component=>{const source=sourceByComponent.get(`${row.id}:${component.payment_field_id}`);return {code:component.component_code,label:component.label,ruleLabel:source?componentRuleLabel({sourceOfTruth:source.source_of_truth as PaymentComponentRule['sourceOfTruth'],calculationBasis:source.calculation_basis as PaymentComponentRule['calculationBasis'],sourceMetric:source.source_metric as PaymentComponentRule['sourceMetric'],minimumUnits:source.minimum_units}):'Earning rule required'};})}]:[]) as StagePaymentMethod[];
 const biometric=data.attendance.filter(d=>isBiometricDay(d,person.location_id));
 return <section className="wf-simple-setup">
  {section==='profile'?<>
  <AssociateRegistrationDetails auth={auth} id={id}/>
  <header><h3>Biometric attendance</h3><p>ID: <strong>{person.biometric_id||'Enrol at station on day one'}</strong> · {new Set(biometric.map(d=>d.punch_date)).size} punched days since {dateOfJoin||'joining date not set'}</p></header>
  <details><summary>View daily punches ({data.attendance.length})</summary><div className="table-wrap"><table><thead><tr><th>Date</th><th>In / out (IST)</th><th>Minutes</th><th>Attendance</th></tr></thead><tbody>{data.attendance.map(d=><tr key={d.id}><td>{d.punch_date}</td><td>{[d.in_time,d.out_time].map(v=>v?new Date(v).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'}):'Missing').join(' – ')}</td><td>{d.work_minutes??'—'}</td><td>{d.flagged?'Flagged — review':isBiometricDay(d,person.location_id)?'Biometric · '+d.status:'Review source / station'}</td></tr>)}</tbody></table>{!data.attendance.length?<p>No punches found for this identity and joining period.</p>:null}</div></details>

  </>:null}
  {section==='payments'?<>
  <header><h3>Payment configuration</h3><p>View existing rates and effective dates. Changes apply only to this associate.</p></header>
  <AssociatePaymentStages id={id} tab={tab} rows={(history.data||[]) as PersonalMapping[]} methods={methods} canEdit={hasPermission(auth,'provider_mapping','edit')&&!auth.readOnly}/>
  {hasPermission(auth,'provider_mapping','access')?<section><h3>Provider ID & rate mapping</h3><ProviderMappingPageContent embedded workforceId={id}/></section>:null}

  </>:null}

 </section>;
}
