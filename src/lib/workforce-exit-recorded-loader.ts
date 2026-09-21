import {supabaseAdmin} from './supabase-admin';
import {parseRecordedExitChecks} from './workforce-exit-recorded-checks';
/** Server-only caller must first authorise this company, associate and station scope. */
export async function loadRecordedExitChecks(companyId:string,workforceId:string,locations:string[]|null){
  if(!supabaseAdmin)throw new Error('Recorded exit checks are unavailable.');
  const result=await supabaseAdmin.rpc('workforce_exit_recorded_checks',{p_company:companyId,p_workforce:workforceId,p_locations:locations});
  if(result.error)throw new Error('Recorded exit checks could not be verified. Retry before closing this exit.');
  return parseRecordedExitChecks(result.data);
}
