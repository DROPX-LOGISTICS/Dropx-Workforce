const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const pooledValue=(f:FormData,k:string)=>String(f.get(k)??'').trim();
function id(f:FormData,k:string){const s=pooledValue(f,k);if(!uuid.test(s))throw new Error('Choose a valid '+k.replaceAll('_',' ')+'.');return s;}
function date(f:FormData,k:string){const s=pooledValue(f,k);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)throw new Error('Choose valid dates.');return s;}
function text(f:FormData,k:string,min:number,max:number){const s=pooledValue(f,k);if(s.length<min||s.length>max)throw new Error('Provide '+k.replaceAll('_',' ')+' ('+min+'–'+max+' characters).');return s;}
function amount(f:FormData,k:string,positive=false){const s=pooledValue(f,k);if(!/^\d+(\.\d{1,2})?$/.test(s)||Number(s)>1000000||(positive&&Number(s)<=0))throw new Error('Provide approved amounts with at most two decimals.');return Number(s);}
export function parsePooledPolicy(f:FormData){
 const formula=pooledValue(f,'formula'),packages=pooledValue(f,'packages_per_day');
 if(!['guarantee_plus_excess','pooled_floor'].includes(formula)||!/^\d+$/.test(packages)||Number(packages)>100000)throw new Error('Choose a formula and whole-number daily package allowance.');
 if(formula==='pooled_floor'&&Number(packages)!==0)throw new Error('The higher-of formula has no included package allowance. Enter 0.');
 const from=date(f,'effective_from'),to=date(f,'effective_to');if(to<from)throw new Error('Effective end cannot precede the start.');
 return {p_station:id(f,'station_id'),p_name:text(f,'name',3,120),p_formula:formula,p_guarantee:amount(f,'daily_guarantee',true),p_packages:Number(packages),p_rate:amount(f,'package_rate'),p_from:from,p_to:to,p_reference:text(f,'policy_reference',3,1000)};
}
export function parsePooledAgreement(f:FormData){
 const from=date(f,'window_start'),to=date(f,'window_end'),accepted=date(f,'accepted_on');if(to<from||accepted>from)throw new Error('Consent must be on or before the start of the agreed window.');
 return {p_policy:id(f,'policy_id'),p_workforce:id(f,'workforce_id'),p_from:from,p_to:to,p_accepted:accepted,p_reference:text(f,'acceptance_reference',3,1000)};
}
export function parsePooledSubmission(f:FormData){
 const fingerprint=pooledValue(f,'fingerprint');if(!/^[0-9a-f]{32}$/.test(fingerprint)||pooledValue(f,'source_complete')!=='yes')throw new Error('Refresh the calculation and confirm that all delivery source data has been imported.');
 return {p_agreement:id(f,'agreement_id'),p_posting:date(f,'posting_date'),p_reference:text(f,'reference',3,180),p_fingerprint:fingerprint};
}
export function parsePooledReview(f:FormData){const decision=pooledValue(f,'decision');if(!['approved','rejected'].includes(decision))throw new Error('Choose a review decision.');return {p_settlement:id(f,'settlement_id'),p_decision:decision,p_note:text(f,'review_note',10,2000)};}
