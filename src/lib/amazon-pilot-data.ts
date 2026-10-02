import 'server-only';
import { supabaseAdmin } from '@/lib/supabase-admin';
import type { PilotEvidence } from './amazon-pilot';
export async function refreshAmazonPilot(companyId:string,workforceId:string) {
 if(!supabaseAdmin)throw new Error('Database unavailable.');
 const db=supabaseAdmin;
 const current=await db.from('workforce_amazon_pilots').select('evidence,closed_at').eq('company_id',companyId).eq('workforce_id',workforceId).single();
 if(current.error)throw new Error(current.error.message);
 if(current.data.closed_at)return;
 const result=await db.rpc('workforce_amazon_pilot_sources',{p_company:companyId,p_workforce:workforceId});
 if(result.error)throw new Error(result.error.message);
 const evidence=result.data as PilotEvidence;
 if(!evidence)throw new Error('No source evidence returned.');
 const prior=current.data.evidence as PilotEvidence;
 if(!evidence.conflict && evidence.providerId===prior.providerId && evidence.transporterId===prior.transporterId && evidence.employeeId && evidence.employeeId===prior.employeeId && prior.firstDelivery && (!evidence.firstDelivery || prior.firstDelivery<evidence.firstDelivery)) evidence.firstDelivery=prior.firstDelivery;
 // Each snapshot remains dated in immutable history; an old match never becomes a new activation.
 if(JSON.stringify(current.data.evidence)!==JSON.stringify(evidence)){
  const history=await db.from('workforce_amazon_pilot_history').insert({company_id:companyId,workforce_id:workforceId,event:'source_observation',evidence});
  if(history.error)throw new Error(history.error.message);
 }
 const update=await db.from('workforce_amazon_pilots').update({evidence,last_checked_at:new Date().toISOString(),sync_error:null}).eq('company_id',companyId).eq('workforce_id',workforceId);
 if(update.error)throw new Error(update.error.message);
}
