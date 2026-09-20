'use server';
import {redirect} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {requirePagePermission,isCompanyOwner} from '@/lib/authorization';
import {requireCompanyId} from '@/lib/company-scope';
import {supabaseAdmin} from '@/lib/supabase-admin';
import {parseMileageClaim} from '@/lib/workforce-mileage-input';
import {isWorkforceDate} from '@/lib/workforce-earnings';
const path='/delivery-network/mileage';
const value=(form:FormData,key:string)=>String(form.get(key)??'').trim();
export async function submitMileage(form:FormData){
 const auth=await requirePagePermission('workforce_adjustments','add'),query=new URLSearchParams();
 try{
  if(auth.readOnly)throw new Error('Preview mode is read-only.');if(!supabaseAdmin)throw new Error('Database is unavailable.');
  const result=await supabaseAdmin.rpc('workforce_submit_mileage',{...parseMileageClaim(form),p_company:requireCompanyId(auth),p_actor:auth.userId,p_locations:auth.hasAllLocationAccess?null:auth.locationScopeIds});
  if(result.error)throw new Error(result.error.message);query.set('notice','Evidence submitted for independent review. No payable earning has been created.');revalidatePath(path);
 }catch(e){query.set('error',e instanceof Error?e.message:'Unable to submit mileage.');}
 redirect(`${path}?${query}`);
}
export async function createMileagePolicy(form:FormData){
 const auth=await requirePagePermission('workforce_rate_cards','edit'),query=new URLSearchParams();
 try{
  if(auth.readOnly||!isCompanyOwner(auth))throw new Error('Only an owner outside preview mode can configure approved mileage terms.');if(!supabaseAdmin)throw new Error('Database is unavailable.');
  const from=value(form,'effective_from'),to=value(form,'effective_to');if(!isWorkforceDate(from)||!isWorkforceDate(to))throw new Error('Choose valid effective dates.');
  const result=await supabaseAdmin.rpc('workforce_create_mileage_policy',{p_company:requireCompanyId(auth),p_actor:auth.userId,p_station:value(form,'station_id'),p_name:value(form,'name'),p_rate:Number(value(form,'rate_per_km')),p_max_km:Number(value(form,'maximum_daily_km')),p_from:from,p_to:to,p_reference:value(form,'policy_reference'),p_locations:auth.hasAllLocationAccess?null:auth.locationScopeIds});
  if(result.error)throw new Error(result.error.code==='23P01'?'This station already has a policy for part of that date range. Choose a non-overlapping window.':result.error.message);
  query.set('notice','Approved policy version saved. No claim or payment was created.');revalidatePath(path);
 }catch(e){query.set('error',e instanceof Error?e.message:'Unable to create mileage policy.');}
 redirect(`${path}?${query}`);
}
export async function reviewMileage(form:FormData){
 const auth=await requirePagePermission('workforce_adjustments','edit'),company=requireCompanyId(auth),query=new URLSearchParams();
 try{
  if(auth.readOnly||!isCompanyOwner(auth))throw new Error('Only an authorised owner outside preview mode may review mileage.');if(!supabaseAdmin)throw new Error('Database is unavailable.');
  const decision=value(form,'decision'),remarks=value(form,'review_remarks'),posting=value(form,'posting_date');
  if(!['approved','rejected'].includes(decision)||remarks.length<10||remarks.length>2000||!isWorkforceDate(posting))throw new Error('Choose a decision, valid posting date and documented review notes.');
  const claim=await supabaseAdmin.from('workforce_mileage_claims').select('id,station_id,adjustment_id,reported_by').eq('company_id',company).eq('id',value(form,'claim_id')).maybeSingle();
  if(claim.error||!claim.data||(!auth.hasAllLocationAccess&&!auth.locationScopeIds.includes(claim.data.station_id)))throw new Error('Claim was not found in your company and station scope.');
  if(claim.data.reported_by===auth.userId)throw new Error('Another owner must review your claim.');
  const result=await supabaseAdmin.from('workforce_adjustments').update({status:decision,reviewed_by:auth.userId,reviewed_at:new Date().toISOString(),review_remarks:remarks,...(decision==='approved'?{effective_date:posting}:{}),updated_at:new Date().toISOString()}).eq('company_id',company).eq('id',claim.data.adjustment_id).eq('status','pending').select('id').maybeSingle();
  if(result.error)throw new Error(result.error.message);if(!result.data)throw new Error('Another reviewer already decided this claim. Refresh to see the latest evidence.');
  query.set('notice',decision==='approved'?'Mileage approved. Recalculate the open payroll snapshot before confirmation.':'Claim rejected; it will not add to earnings.');
  for(const route of [path,'/delivery-network/adjustments','/delivery-network/earnings','/delivery-network/payroll'])revalidatePath(route);
 }catch(e){query.set('error',e instanceof Error?e.message:'Unable to review mileage.');}
 redirect(`${path}?${query}`);
}
