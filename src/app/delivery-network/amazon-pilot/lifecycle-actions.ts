'use server';
import { requirePagePermission } from '@/lib/authorization';
import { requireCompanyId } from '@/lib/company-scope';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { betaLifecycleEnabled } from '@/lib/beta-lifecycle';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
const path='/delivery-network/amazon-pilot';
export async function updateBetaLifecycle(form:FormData) {
  const auth=await requirePagePermission('delivery_associates','edit');
  const val=(key:string)=>String(form.get(key)??'').trim(),id=val('candidate_id'),company=requireCompanyId(auth);
  try {
    if(auth.readOnly||!supabaseAdmin||!betaLifecycleEnabled(company,id))throw new Error('This control is available only for the current beta candidate.');
    const action=val('action');
    if(!['edit_contact','confirm_registration','return_registration','archive','restore','note'].includes(action))throw new Error('Unsupported action.');
    const result=await supabaseAdmin.rpc('workforce_beta_admin_action',{
      p_company:company,p_candidate:id,p_actor:auth.userId,p_locations:auth.hasAllLocationAccess?null:auth.locationScopeIds,
      p_action:action,p_expected_updated_at:val('candidate_version'),p_reason:val('reason'),
      p_data:{full_name:val('full_name'),mobile:val('mobile'),registration_version:val('registration_version')}
    });
    if(result.error)throw new Error(result.error.message.includes('schema cache')?'Admin controls are waiting for the database release. Please retry after deployment.':result.error.message);
  } catch(error) {redirect(`${path}?candidate=${encodeURIComponent(id)}&error=${encodeURIComponent(error instanceof Error?error.message:'Could not save.')}#candidate`);}
  revalidatePath(path);
  redirect(`${path}?candidate=${encodeURIComponent(id)}&notice=Beta+update+saved.+DropX+One+will+refresh+automatically.#candidate`);
}
