'use server';
import { randomUUID,randomBytes,createHash } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { waitUntil } from '@vercel/functions';
import { requirePagePermission,isCompanyOwner } from '@/lib/authorization';
import { requireCompanyId } from '@/lib/company-scope';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { generateConfiguredBiometricId,generateConfiguredWorkerId } from '@/lib/dropx-id-generation';
import { evaluateOnboardingIdentity,assertOnboardingIdentityAllowed } from '@/lib/onboarding-identity';
import { requireDesignationOnboardingAccess } from '@/lib/designation-onboarding-access';
import { requireDesignationPortalAccess } from '@/lib/designation-portal-access';
import { refreshAmazonPilot } from '@/lib/amazon-pilot-data';
import { callWorkforceAmazonWorker } from '@/lib/workforce-amazon-worker';
import { sendFieldExecutiveOnboardingWhatsApp } from '@/lib/whatsapp';
const path='/delivery-network/amazon-pilot';
const value=(form:FormData,key:string)=>String(form.get(key)??'').trim();
const fail=(error:unknown)=>error instanceof Error?error.message:'Unable to save onboarding.';
export async function createAmazonPilot(form:FormData){
 const auth=await requirePagePermission('delivery_associates','add');
 let id='';let warning='';
 try{
  if(auth.readOnly||!supabaseAdmin)throw new Error('Creation is unavailable.');
  const company=requireCompanyId(auth),stationId=value(form,'station_id'),designationId=value(form,'designation_id'),mobile=value(form,'mobile');
  if(!auth.hasAllLocationAccess&&!auth.locationScopeIds.includes(stationId))throw new Error('Station outside your access.');
  const role=await supabaseAdmin.from('designations').select('id,name,onboarding_role_ids,portal_permissions,onboarding_categories,registration_category_code,designation_category:designation_categories!designations_designation_category_id_fkey(id,code,name,people_module)').eq('company_id',company).eq('id',designationId).eq('is_active',true).single();
  if(role.error)throw new Error('Choose a valid designation.');
  requireDesignationOnboardingAccess(role.data,auth);
  requireDesignationPortalAccess(role.data,'workforce','add',{isOwner:isCompanyOwner(auth)});
  assertOnboardingIdentityAllowed(await evaluateOnboardingIdentity({client:supabaseAdmin,companyId:company,mobile,designationId,designationName:role.data.name}),{allowDifferentWorkforceDesignation:false});
  const generated={companyId:company,category:'workforce',designationId,designationName:role.data.name,locationId:stationId,fallback:()=>{throw new Error('Configure the designation ID series before recording arrivals.');}};
  const biometricId=await generateConfiguredBiometricId(generated),dropxId=await generateConfiguredWorkerId(generated);
  const requestedId=randomUUID(),token=randomBytes(32).toString('base64url');
  const created=await supabaseAdmin.rpc('workforce_create_amazon_pilot',{p_company:company,p_actor:auth.userId,p_locations:auth.hasAllLocationAccess?null:auth.locationScopeIds,p_data:{id:requestedId,full_name:value(form,'full_name'),mobile,email:value(form,'email').toLowerCase(),station_id:stationId,designation_id:designationId,reported_on:value(form,'reported_on'),trial_days:Number(value(form,'trial_days')),biometric_id:biometricId,dropx_id:dropxId,token_hash:createHash('sha256').update(token).digest('hex')}});
  if(created.error)throw new Error(created.error.message);
  id=String(created.data);
  const queue=await supabaseAdmin.rpc('workforce_queue_amazon_pilot',{p_company:company,p_workforce:id});
  if(queue.error)warning='Arrival saved. Amazon invitation needs station configuration; open the associate to review.';
  const station=await supabaseAdmin.from('stations').select('station_code,station_name').eq('id',stationId).eq('company_id',company).single();
  waitUntil(sendFieldExecutiveOnboardingWhatsApp({companyId:company,fieldExecutiveId:id,profileType:'workforce',fullName:value(form,'full_name'),mobile:`91${mobile}`,dropxId,biometricId,workforceCategoryCode:role.data.registration_category_code || (role.data.onboarding_categories?.length===1?role.data.onboarding_categories[0]:'field_executives'),onboardingUrl:'https://one.dropxlogistics.com',dateOfJoin:value(form,'reported_on'),locationCode:station.data?.station_code??'',locationName:station.data?.station_name??'',providerName:'Amazon',registrationToken:token,triggeredBy:auth.userId}));
  // The queue is durable even if the worker is temporarily unavailable.
  if(!queue.error)waitUntil(callWorkforceAmazonWorker('/api/admin/amazon/invitation/tick',{method:'POST',body:'{}'}).catch(()=>undefined));
  await refreshAmazonPilot(company,id).catch(()=>undefined);
 }catch(error){redirect(`${path}?error=${encodeURIComponent(fail(error))}${id?`&id=${id}`:''}`);}
 revalidatePath(path);redirect(`${path}?id=${id}&notice=${encodeURIComponent(warning||'Arrival recorded. Amazon invitation queued; biometric ID is ready.')}`);
}
export async function updateAmazonPilot(form:FormData){
 const auth=await requirePagePermission('delivery_associates','edit'),id=value(form,'id');
 try{
  if(auth.readOnly||!supabaseAdmin)throw new Error('Changes are unavailable.');
  const company=requireCompanyId(auth),db=supabaseAdmin;
  const result=await db.from('workforce_amazon_pilots').select('*').eq('company_id',company).eq('workforce_id',id).single();
  if(result.error||!result.data)throw new Error('Associate unavailable.');
  const p=result.data;
  if(!auth.hasAllLocationAccess&&!auth.locationScopeIds.includes(p.station_id))throw new Error('Station outside your access.');
  const action=value(form,'action');
  if(p.closed_at)throw new Error('This trial is closed.');
  if(action==='refresh'){await refreshAmazonPilot(company,id);}
  else if(action==='queue'){
   const q=await db.rpc('workforce_queue_amazon_pilot',{p_company:company,p_workforce:id});if(q.error)throw new Error(q.error.message);
  }else{
   const changed=await db.rpc('workforce_update_amazon_pilot',{p_company:company,p_actor:auth.userId,p_workforce:id,p_action:action,p_data:{notes:value(form,'notes'),work_date:value(form,'work_date'),minutes:Number(value(form,'minutes')),trial_days:Number(value(form,'trial_days'))},p_locations:auth.hasAllLocationAccess?null:auth.locationScopeIds});
   if(changed.error)throw new Error(changed.error.message);
  }
 }catch(error){redirect(`${path}?id=${encodeURIComponent(id)}&error=${encodeURIComponent(fail(error))}`);}
 revalidatePath(path);redirect(`${path}?id=${encodeURIComponent(id)}&notice=Onboarding+updated`);
}
