'use client';
import {useState} from 'react';
import {savePersonalPaymentStage} from '@/app/delivery-network/lifecycle/terms-actions';
import {SubmitButton} from './submit-button';
export type PersonalMapping={id:string;provider_member_id:string;effective_from:string;effective_to:string|null;payment_values:Record<string,number|string>|null;pay_type:string;reason:string|null;updated_at:string|null};
export function AssociatePaymentStages({id,tab,rows,canEdit}:{id:string;tab:string;rows:PersonalMapping[];canEdit:boolean}){
 const [mappingId,setMappingId]=useState(rows[0]?.id||''),[mode,setMode]=useState('next'),[payType,setPayType]=useState('MG_PER_DAY');
 const selected=rows.find(m=>m.id===mappingId);
 return <section><h3>Payment stages</h3><p className="subtle">Training uses biometrics. After mapping: daily pay for a dated period, then per-activity rates. Existing paid periods stay locked.</p><div className="table-wrap"><table><thead><tr><th>Provider ID</th><th>From</th><th>Through</th><th>Payment terms</th></tr></thead><tbody>{rows.map(m=><tr key={m.id}><td>{m.provider_member_id}</td><td>{m.effective_from}</td><td>{m.effective_to||'Ongoing'}</td><td>{m.pay_type.replaceAll('_',' ')}<small>{Object.entries(m.payment_values||{}).filter(([k])=>!k.startsWith('DROPX_')).map(([k,v])=>k.replaceAll('_',' ')+': ₹'+v).join(' · ')}</small>{m.reason?<small>{m.reason}</small>:null}</td></tr>)}</tbody></table></div>
 {!rows.length?<p>Map the provider ID below to configure regular payment.</p>:canEdit?<details><summary>Add or change payment stage</summary><form action={savePersonalPaymentStage} className="wf-simple-fields" key={mappingId+mode+payType}>
 <input name="workforce_id" type="hidden" value={id}/><input name="tab" type="hidden" value={tab}/><input name="expected_updated_at" type="hidden" value={selected?.updated_at||''}/>
 <label>Existing ID / stage<select name="mapping_id" value={mappingId} onChange={e=>setMappingId(e.target.value)}>{rows.map(m=><option key={m.id} value={m.id}>{m.provider_member_id} · {m.effective_from} – {m.effective_to||'ongoing'}</option>)}</select></label>
 <label>Action<select name="mode" value={mode} onChange={e=>setMode(e.target.value)}><option value="next">Add next payment stage</option><option value="edit">Correct this stage</option></select></label>
 <label>Payment type<select name="pay_type" value={payType} onChange={e=>setPayType(e.target.value)}><option value="MG_PER_DAY">Agreed daily pay</option><option value="PER_PACKET">Per delivery / return</option></select></label>
 <label>Effective from<input name="effective_from" type="date" required min={selected?.effective_from} defaultValue={mode==='edit'?selected?.effective_from:undefined} readOnly={mode==='edit'}/></label>
 <label>Effective through<input name="effective_to" type="date" defaultValue={mode==='edit'?selected?.effective_to||'':undefined}/><small>Blank means ongoing. Add the next stage to end this one.</small></label>
 {(payType==='MG_PER_DAY'?[['MG_PER_DAY','Daily pay (₹)']]:[['DELIVERY','Delivery incl. SWA (₹)'],['CRETURN','C-return (₹)'],['SELLER_PICKUP','MFN / seller pickup (₹)'],['SLLLER_RETURN','MFN return (₹)']]).map(([key,label])=><label key={key}>{label}<input name={key} required type="number" min={payType==='MG_PER_DAY'?'0.01':'0'} step="0.01" max="1000000" defaultValue={mode==='edit'?selected?.payment_values?.[key]:undefined}/></label>)}
 <label>Agreed terms / change reason<input name="reason" required minLength={10} maxLength={1000}/></label><SubmitButton pendingText="Saving" confirmMessage="Save this associate’s dated payment terms? Previous periods are retained and payroll drafts must be recalculated.">Save payment stage</SubmitButton>
 </form></details>:null}</section>;
}
