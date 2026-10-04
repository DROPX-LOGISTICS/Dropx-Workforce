'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { waitUntil } from '@vercel/functions';
import { requirePagePermission,isCompanyOwner } from '@/lib/authorization';
import { requireCompanyId } from '@/lib/company-scope';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { generateConfiguredBiometricId } from '@/lib/dropx-id-generation';
import { evaluateOnboardingIdentity,assertOnboardingIdentityAllowed } from '@/lib/onboarding-identity';
import { requireDesignationOnboardingAccess } from '@/lib/designation-onboarding-access';
import { requireDesignationPortalAccess } from '@/lib/designation-portal-access';
import { callWorkforceAmazonWorker } from '@/lib/workforce-amazon-worker';
import { ensureAmazonEmailRoute } from '@/lib/amazon-email-routing';

const path='/delivery-network/amazon-pilot';
const value=(form:FormData,key:string)=>String(form.get(key)??'').trim();
const fail=(error:unknown)=>error instanceof Error?error.message:'Unable to save onboarding.';

async function ensureCandidateEmailRoute(company:string,candidateId:string){
 if(!supabaseAdmin)throw new Error('Database unavailable.');
 const result=await supabaseAdmin.from('workforce_amazon_email_pilot_candidates').select('alias_email,inbox_status,routing_rule_id').eq('company_id',company).eq('id',candidateId).single();
 if(result.error||!result.data)throw new Error('The backend email reservation is missing.');
 if(['routed','receiving'].includes(result.data.inbox_status)&&result.data.routing_rule_id)return result.data.alias_email;
 try{
  const ruleId=await ensureAmazonEmailRoute(result.data.alias_email);
  const saved=await supabaseAdmin.from('workforce_amazon_email_pilot_candidates').update({inbox_status:'routed',routing_rule_id:ruleId,routing_error:null,routed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('company_id',company).eq('id',candidateId);
  if(saved.error)throw new Error(saved.error.message);
  return result.data.alias_email;
 }catch(error){
  const message=fail(error).slice(0,1000);
  await supabaseAdmin.from('workforce_amazon_email_pilot_candidates').update({inbox_status:'route_failed',routing_error:message,updated_at:new Date().toISOString()}).eq('company_id',company).eq('id',candidateId);
  throw new Error(`Inbox route could not be activated: ${message}`);
 }
}

export type AmazonPilotCreateState={status:'idle'|'warning'|'error';message:string;existingProfile?:string};

export async function createAmazonPilot(_:AmazonPilotCreateState,form:FormData):Promise<AmazonPilotCreateState>{
 const auth=await requirePagePermission('delivery_associates','add');
 let id='';let warning='';
 try{
  if(auth.readOnly||!supabaseAdmin)throw new Error('Creation is unavailable.');
  const company=requireCompanyId(auth),stationId=value(form,'station_id'),designationId=value(form,'designation_id'),mobile=value(form,'mobile');
  if(!auth.hasAllLocationAccess&&!auth.locationScopeIds.includes(stationId))throw new Error('Station outside your access.');
  const stationConfig=await supabaseAdmin.from('workforce_amazon_station_settings').select('invitation_enabled,associate_email_pattern').eq('company_id',company).eq('station_id',stationId).maybeSingle();
  if(stationConfig.error||!stationConfig.data?.invitation_enabled)throw new Error('Amazon invitations are not enabled at this station. Choose a configured station.');
  if(!stationConfig.data.associate_email_pattern)throw new Error('Configure the backend email alias pattern for this station before starting the pilot.');
  const role=await supabaseAdmin.from('designations').select('id,name,onboarding_role_ids,portal_permissions,onboarding_categories,registration_category_code,designation_category:designation_categories!designations_designation_category_id_fkey(id,code,name,people_module)').eq('company_id',company).eq('id',designationId).eq('is_active',true).single();
  if(role.error)throw new Error('Choose a valid designation.');
  requireDesignationOnboardingAccess(role.data,auth);
  requireDesignationPortalAccess(role.data,'workforce','add',{isOwner:isCompanyOwner(auth)});
  const identity=await evaluateOnboardingIdentity({client:supabaseAdmin,companyId:company,mobile,designationId,designationName:role.data.name});
  const confirmed=value(form,'identity_exception_confirmed')==='true';
  assertOnboardingIdentityAllowed(identity,{allowDifferentWorkforceDesignation:true});
  if(identity.otherMatches.length&&!confirmed){
   const existing=identity.otherMatches[0];
   return {status:'warning',message:'This mobile number is already linked to a DropX identity. It will be flagged, not blocked. Confirm this isolated pilot registration to continue.',existingProfile:`${existing.display_name||'Existing person'} · ${existing.designation_name||existing.designation_code||'Existing role'}`};
  }
  const generated={companyId:company,category:'workforce',designationId,designationName:role.data.name,locationId:stationId,fallback:()=>{throw new Error('Configure the designation biometric ID series before recording arrivals.');}};
  const biometricId=await generateConfiguredBiometricId(generated),requestedId=randomUUID();
  const created=await supabaseAdmin.rpc('workforce_create_isolated_amazon_email_pilot',{p_company:company,p_actor:auth.userId,p_locations:auth.hasAllLocationAccess?null:auth.locationScopeIds,p_data:{id:requestedId,full_name:value(form,'full_name'),mobile,station_id:stationId,designation_id:designationId,reported_on:value(form,'reported_on'),biometric_id:biometricId}});
  if(created.error)throw new Error(created.error.message);
  id=String(created.data);
  try{
   await ensureCandidateEmailRoute(company,id);
   const queue=await supabaseAdmin.rpc('workforce_queue_isolated_amazon_email_pilot',{p_company:company,p_actor:auth.userId,p_candidate:id,p_locations:auth.hasAllLocationAccess?null:auth.locationScopeIds});
   if(queue.error)warning='Pilot saved. The Amazon invitation needs attention; open the candidate to review.';
   else waitUntil(callWorkforceAmazonWorker('/api/admin/amazon/invitation/tick',{method:'POST',body:'{}'}).catch(()=>undefined));
  }catch(error){warning=`Pilot and backend email saved. ${fail(error)} Open the candidate and retry.`;}
 }catch(error){return {status:'error',message:fail(error)};}
 revalidatePath(path);
 redirect(`${path}?candidate=${id}&notice=${encodeURIComponent(warning||'Backend email reserved and Amazon invitation queued. No canonical Workforce profile was created.')}`);
}

export async function updateAmazonPilot(form:FormData){
 const auth=await requirePagePermission('delivery_associates','edit'),id=value(form,'candidate_id');
 try{
  if(auth.readOnly||!supabaseAdmin)throw new Error('Changes are unavailable.');
  const company=requireCompanyId(auth),db=supabaseAdmin;
  const result=await db.from('workforce_amazon_email_pilot_candidates').select('station_id,closed_at').eq('company_id',company).eq('id',id).single();
  if(result.error||!result.data)throw new Error('Pilot candidate unavailable.');
  if(!auth.hasAllLocationAccess&&!auth.locationScopeIds.includes(result.data.station_id))throw new Error('Station outside your access.');
  const action=value(form,'action');
  if(action==='queue'){
   if(result.data.closed_at)throw new Error('This pilot is closed.');
   await ensureCandidateEmailRoute(company,id);
   const queued=await db.rpc('workforce_queue_isolated_amazon_email_pilot',{p_company:company,p_actor:auth.userId,p_candidate:id,p_locations:auth.hasAllLocationAccess?null:auth.locationScopeIds});
   if(queued.error)throw new Error(queued.error.message);
   waitUntil(callWorkforceAmazonWorker('/api/admin/amazon/invitation/tick',{method:'POST',body:'{}'}).catch(()=>undefined));
  }else if(action==='close'){
   const closed=await db.rpc('workforce_close_isolated_amazon_email_pilot',{p_company:company,p_actor:auth.userId,p_candidate:id,p_reason:value(form,'notes'),p_locations:auth.hasAllLocationAccess?null:auth.locationScopeIds});
   if(closed.error)throw new Error(closed.error.message);
  }else throw new Error('Unsupported pilot action.');
 }catch(error){redirect(`${path}?candidate=${encodeURIComponent(id)}&error=${encodeURIComponent(fail(error))}`);}
 revalidatePath(path);
 redirect(`${path}?candidate=${encodeURIComponent(id)}&notice=Pilot+updated`);
}
