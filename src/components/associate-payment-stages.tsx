'use client';
import {useMemo,useState} from 'react';
import {savePersonalPaymentStage} from '@/app/delivery-network/lifecycle/terms-actions';
import {componentRuleLabel,storedComponentRules} from '@/lib/payment-component-rules';
import {SubmitButton} from './submit-button';
export type PersonalMapping={id:string;provider_member_id:string;effective_from:string;effective_to:string|null;payment_method_id:string|null;payment_values:Record<string,unknown>|null;pay_type:string;reason:string|null;updated_at:string|null};
export type StagePaymentMethod={id:string;code:string;name:string;components:Array<{code:string;label:string;ruleLabel:string}>};
function mappingRules(row:PersonalMapping,configured?:StagePaymentMethod){
 const stored=Object.values(storedComponentRules(row.payment_values));
 if(stored.length)return stored.map(componentRuleLabel).join(' · ');
 if(configured?.components.length)return configured.components.map(component=>component.ruleLabel).join(' · ');
 return String(row.payment_values?.DROPX_SOURCE_OF_TRUTH||'Legacy');
}
export function AssociatePaymentStages({id,tab,rows,methods,canEdit}:{id:string;tab:string;rows:PersonalMapping[];methods:StagePaymentMethod[];canEdit:boolean}){
 const firstEligibleMethodId=methods.some(method=>method.id===rows[0]?.payment_method_id)?rows[0]?.payment_method_id||'':methods[0]?.id||'';
 const [mappingId,setMappingId]=useState(rows[0]?.id||''),[mode,setMode]=useState('next'),[methodId,setMethodId]=useState(firstEligibleMethodId),[values,setValues]=useState<Record<string,string>>({});
 const selected=rows.find(m=>m.id===mappingId),method=methods.find(m=>m.id===methodId);const visibleValues=useMemo(()=>Object.fromEntries((method?.components||[]).map(component=>[component.code,values[component.code]??(mode==='edit'?String(selected?.payment_values?.[component.code]??''):'')])),[method,values,mode,selected]);
 return <section><h3>Payment stages</h3><p className="subtle">Only methods enabled for this associate’s designation are available. Each component carries its own earning evidence and the effective period preserves history.</p><div className="table-wrap"><table><thead><tr><th>Provider ID</th><th>From</th><th>Through</th><th>Payment method</th><th>Earning rules</th><th>Terms</th></tr></thead><tbody>{rows.map(row=>{const configured=methods.find(item=>item.id===row.payment_method_id);return <tr key={row.id}><td>{row.provider_member_id}</td><td>{row.effective_from}</td><td>{row.effective_to||'Ongoing'}</td><td>{configured?.name||row.pay_type.replaceAll('_',' ')}</td><td>{mappingRules(row,configured)}</td><td>{Object.entries(row.payment_values||{}).filter(([key])=>!key.startsWith('DROPX_')).map(([key,value])=>`${key.replaceAll('_',' ')}: ₹${String(value)}`).join(' · ')}{row.reason?<small>{row.reason}</small>:null}</td></tr>})}</tbody></table></div>
 {!rows.length?<p>Map the provider ID first, then add effective-dated payment stages.</p>:!methods.length?<p role="alert">Configure every component earning rule in Payment Methods before adding a stage.</p>:canEdit?<details><summary>Add or change payment stage</summary><form action={savePersonalPaymentStage} className="wf-simple-fields" key={mappingId+mode+methodId}>
  <input name="workforce_id" type="hidden" value={id}/><input name="tab" type="hidden" value={tab}/><input name="expected_updated_at" type="hidden" value={selected?.updated_at||''}/><input name="payment_values_json" type="hidden" value={JSON.stringify(visibleValues)}/>
  <label>Existing ID / stage<select name="mapping_id" value={mappingId} onChange={event=>{setMappingId(event.target.value);setValues({});}}>{rows.map(row=><option key={row.id} value={row.id}>{row.provider_member_id} · {row.effective_from} – {row.effective_to||'ongoing'}</option>)}</select></label>
  <label>Action<select name="mode" value={mode} onChange={event=>{setMode(event.target.value);setValues({});}}><option value="next">Add next payment stage</option><option value="edit">Correct this stage</option></select></label>
  <label>Payment method<select name="payment_method_id" value={methodId} onChange={event=>{setMethodId(event.target.value);setValues({});}}>{methods.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
  <label>Effective from<input name="effective_from" type="date" required min={selected?.effective_from} defaultValue={mode==='edit'?selected?.effective_from:undefined} readOnly={mode==='edit'}/></label>
  <label>Effective through<input name="effective_to" type="date" defaultValue={mode==='edit'?selected?.effective_to||'':undefined}/><small>Optional. Adding the next contiguous stage closes the earlier stage.</small></label>
  {(method?.components||[]).map(component=><label key={component.code}>{component.label}<input required type="number" min="0" step="0.01" max="1000000" value={visibleValues[component.code]||''} onChange={event=>setValues(current=>({...current,[component.code]:event.target.value}))}/><small>{component.ruleLabel}</small></label>)}
  <label>Agreed terms / change reason<input name="reason" required minLength={10} maxLength={1000}/></label><SubmitButton pendingText="Saving" confirmMessage="Save this associate’s dated payment terms? Earlier paid periods remain locked.">Save payment stage</SubmitButton>
 </form></details>:null}</section>;
}
