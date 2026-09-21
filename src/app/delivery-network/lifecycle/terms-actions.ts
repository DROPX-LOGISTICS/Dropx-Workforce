"use server";
import {redirect} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {requirePagePermission} from '@/lib/authorization';
import {requireCompanyId} from '@/lib/company-scope';
import {supabaseAdmin} from '@/lib/supabase-admin';
export async function saveReviewTerms(form:FormData){
 const auth=await requirePagePermission('people_review','edit'),person=String(form.get('workforce_id')||'');
 const query=new URLSearchParams({person,tab:String(form.get('tab')||'onboarding'),section:'payments'});
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
  const keys=t('pay_type')==='MG_PER_DAY'?['MG_PER_DAY']:['DELIVERY','CRETURN','SELLER_PICKUP','SLLLER_RETURN'];
  if(keys.some(k=>t(k)===''||!Number.isFinite(Number(t(k)))))throw new Error('Complete every rate. Use 0 for a non-paying activity.');
  const r=await supabaseAdmin.rpc('workforce_save_personal_payment_stage',{p_company:requireCompanyId(auth),p_actor:auth.userId,p_actor_name:auth.fullName||auth.email||'Workforce',p_workforce:t('workforce_id'),p_mapping:t('mapping_id'),p_expected:t('expected_updated_at')||null,p_mode:t('mode'),p_from:t('effective_from'),p_to:t('effective_to')||null,p_type:t('pay_type'),p_values:Object.fromEntries(keys.map(k=>[k,Number(t(k))])),p_reason:t('reason'),p_locations:auth.hasAllLocationAccess?null:auth.locationScopeIds});
  if(r.error)throw new Error(r.error.message);
  revalidatePath('/delivery-network/lifecycle');revalidatePath('/delivery-network/earnings');query.set('notice','Payment stage saved. Recalculate any affected draft payout.');
 }catch(e){query.set('error',e instanceof Error?e.message:'Unable to save payment stage.');}
 redirect('/delivery-network/lifecycle?'+query);
}
