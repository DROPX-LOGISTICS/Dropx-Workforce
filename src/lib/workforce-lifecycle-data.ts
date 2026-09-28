import type {AuthorizationContext} from './authorization';
import {requireCompanyId} from './company-scope';
import {supabaseAdmin} from './supabase-admin';
import {loadWorkforceJoining} from './workforce-joining-data';
import {loadWorkforceCommunicationRecipients} from './workforce-communication-recipients';
import {loadPartnerOnboardingStates} from './partner-onboarding';
import {lifecycleReadiness,type LifecycleReadiness} from './workforce-workbench';
import {workforceToday} from './workforce-earnings';
export async function loadWorkforceLifecycle(auth:AuthorizationContext){
 const today=workforceToday();
 const [records,data]=await Promise.all([loadWorkforceCommunicationRecipients(auth),loadWorkforceJoining(auth,{to:today,evidence:false})]);
 if(!supabaseAdmin)throw new Error('Workforce connection is unavailable.');
 const partners=await loadPartnerOnboardingStates(supabaseAdmin,requireCompanyId(auth),data.profiles.map(person=>person.id));
 const readiness=new Map<string,LifecycleReadiness>(data.profiles.map(person=>[person.id,lifecycleReadiness(person,partners.get(person.id),data.mappings,today)]));
 for(const record of records)if(!readiness.has(record.accountId)){
  const status=record.status.toLowerCase().replaceAll(' ','_');
  readiness.set(record.accountId,lifecycleReadiness({id:record.accountId,location_id:record.locationId,is_active:record.isActive,onboarding_status:status,lifecycle_status:record.isActive?'active':status},undefined,[],today));
 }
 return {records,readiness,partners};
}
