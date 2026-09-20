'use server';
import {redirect} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {requirePagePermission,isCompanyOwner} from '@/lib/authorization';
import {requireCompanyId} from '@/lib/company-scope';
import {supabaseAdmin} from '@/lib/supabase-admin';
import {parsePooledPolicy,parsePooledAgreement,parsePooledSubmission,parsePooledReview} from '@/lib/workforce-pooled-input';
const path='/delivery-network/pooled-settlements';
async function perform(form:FormData,kind:'policy'|'agreement'|'submit'|'review'){
 const configuration=kind==='policy'||kind==='agreement';
 const auth=await requirePagePermission(configuration?'workforce_rate_cards':'workforce_adjustments',kind==='submit'?'add':'edit');
 const query=new URLSearchParams();
 try{
  if(auth.readOnly)throw new Error('Preview mode is read-only.');
  if(kind!=='submit'&&!isCompanyOwner(auth))throw new Error('An authorised owner must configure agreed terms and independently review settlements.');
  if(!supabaseAdmin)throw new Error('Database is unavailable.');
  const options={policy:['workforce_create_pooled_policy',parsePooledPolicy],agreement:['workforce_accept_pooled_window',parsePooledAgreement],submit:['workforce_submit_pooled_settlement',parsePooledSubmission],review:['workforce_review_pooled_settlement',parsePooledReview]} as const;
  const [rpc,parse]=options[kind];
  const result=await supabaseAdmin.rpc(rpc,{...parse(form),p_company:requireCompanyId(auth),p_actor:auth.userId,p_locations:auth.hasAllLocationAccess?null:auth.locationScopeIds});
  if(result.error)throw new Error(result.error.code==='23P01'?'An existing policy or accepted window overlaps these dates. Saved terms are immutable.':result.error.message);
  query.set('notice',{policy:'Station terms saved. Configure the matching fixed-daily base rate card separately; no earnings were created.',agreement:'Accepted window saved. Settlement becomes available after the window ends and all base payroll is confirmed.',submit:'Settlement submitted for independent review. No payment was made.',review:'Review saved. Approved positive supplements enter matching open payroll after recalculation; Finance approval is still required.'}[kind]);
  for(const route of [path,'/delivery-network/adjustments','/delivery-network/earnings','/delivery-network/payroll'])revalidatePath(route);
 }catch(e){query.set('error',e instanceof Error?e.message:'Unable to save pooled settlement.');}
 redirect(`${path}?${query}`);
}
export async function createPooledPolicy(f:FormData){await perform(f,'policy');}
export async function acceptPooledAgreement(f:FormData){await perform(f,'agreement');}
export async function submitPooledSettlement(f:FormData){await perform(f,'submit');}
export async function reviewPooledSettlement(f:FormData){await perform(f,'review');}
