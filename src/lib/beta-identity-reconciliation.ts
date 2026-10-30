import 'server-only';
import { supabaseAdmin } from './supabase-admin';
import { BETA_LIFECYCLE_COMPANY,BETA_LIFECYCLE_CANDIDATE } from './beta-lifecycle';
/** Rollout gate only; reconciliation itself takes any exact candidate and is retry-safe.
 * Expand this gate with the lifecycle rollout, never run a per-person mapping script. */
export async function reconcileBetaIdentities() {
 if(!supabaseAdmin)throw new Error('Identity service unavailable');
 const result=await supabaseAdmin.rpc('reconcile_amazon_pilot_identity',{p_company:BETA_LIFECYCLE_COMPANY,p_candidate:BETA_LIFECYCLE_CANDIDATE});
 if(result.error)throw new Error('Automatic identity reconciliation unavailable');
 return result.data;
}
