"use server";
import {redirect} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {requirePagePermission} from '@/lib/authorization';
import {requireCompanyId} from '@/lib/company-scope';
import {supabaseAdmin} from '@/lib/supabase-admin';
export async function saveReviewTerms(form:FormData){
 const auth=await requirePagePermission('people_review','edit'),person=String(form.get('workforce_id')||'');
 const query=new URLSearchParams({person,tab:String(form.get('tab')||'onboarding'),section:'training'});
 try{
  if(auth.readOnly||!supabaseAdmin)throw new Error('Editing is unavailable.');
  const field=(key:string)=>String(form.get(key)||'').trim();
  if(field('terms_reference').length<3)throw new Error('Add the agreed terms or reason for this change.');
  const result=await supabaseAdmin.rpc('workforce_save_review_terms',{p_company:requireCompanyId(auth),p_actor:auth.userId,p_actor_name:auth.fullName||auth.email||'Workforce',p_workforce:person,p_version:Number(field('version')),p_locations:auth.hasAllLocationAccess?null:auth.locationScopeIds,p_terms:{
   mode:field('mode'),eligible_from:field('eligible_from'),daily_rate:field('mode')==='direct'?null:Number(field('daily_rate')),minimum_minutes:field('mode')==='direct'?1:Number(field('minimum_minutes')),
   training_completed_on:field('training_completed_on')||null,terms_reference:field('terms_reference'),provider_stage:field('provider_stage'),provider_reference:field('provider_reference')||null
  }});
  if(result.error)throw new Error(result.error.message);
  query.set('notice','Training and provider progress saved. Attendance comes from station biometrics.');
  revalidatePath('/delivery-network/lifecycle');revalidatePath('/delivery-network/earnings');
 }catch(e){query.set('error',e instanceof Error?e.message:'Unable to save terms.');}
 redirect(`/delivery-network/lifecycle?${query}`);
}

export async function savePersonalPaymentStage(form:FormData){
 const auth=await requirePagePermission('provider_mapping','edit');
 const t=(k:string)=>String(form.get(k)||'').trim(),query=new URLSearchParams({person:t('workforce_id'),tab:t('tab')||'active',section:'payments'});
 try{
  if(auth.readOnly||!supabaseAdmin)throw new Error('Editing is unavailable.');
  let values:Record<string,number>;try{const parsed=JSON.parse(t('payment_values_json')) as Record<string,unknown>;values=Object.fromEntries(Object.entries(parsed).map(([key,value])=>{const number=Number(value);if(!key||!Number.isFinite(number)||number<0)throw new Error('invalid');return [key,number];}));}catch{throw new Error('Complete every configured payment field with a valid amount.');}
  const company=requireCompanyId(auth),workforceId=t('workforce_id'),methodId=t('payment_method_id');
  const worker=await supabaseAdmin.from('workforce').select('designation_id').eq('company_id',company).eq('id',workforceId).is('deleted_at',null).maybeSingle();
  if(worker.error||!worker.data?.designation_id)throw new Error('Associate designation could not be verified.');
  const eligibility=await supabaseAdmin.from('workforce_payment_method_designations').select('payment_method_id').eq('company_id',company).eq('payment_method_id',methodId).eq('designation_id',worker.data.designation_id).maybeSingle();
  if(eligibility.error||!eligibility.data)throw new Error('This payment method is not enabled for the associate designation.');
  const r=await supabaseAdmin.rpc('workforce_save_personal_payment_stage_v2',{p_company:company,p_actor:auth.userId,p_actor_name:auth.fullName||auth.email||'Workforce',p_workforce:workforceId,p_mapping:t('mapping_id'),p_expected:t('expected_updated_at')||null,p_mode:t('mode'),p_from:t('effective_from'),p_to:t('effective_to')||null,p_method:methodId,p_values:values,p_reason:t('reason'),p_locations:auth.hasAllLocationAccess?null:auth.locationScopeIds});
  if(r.error)throw new Error(r.error.message);
  revalidatePath('/delivery-network/lifecycle');revalidatePath('/delivery-network/earnings');query.set('notice','Payment stage saved. Recalculate any affected draft payout.');
 }catch(e){query.set('error',e instanceof Error?e.message:'Unable to save payment stage.');}
 redirect('/delivery-network/lifecycle?'+query);
}
