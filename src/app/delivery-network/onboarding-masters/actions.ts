'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requirePagePermission } from '@/lib/authorization';
import { requireCompanyId } from '@/lib/company-scope';
import { supabaseAdmin } from '@/lib/supabase-admin';

const path='/delivery-network/onboarding-masters';
const value=(form:FormData,key:string)=>String(form.get(key)??'').trim();
const fail=(error:unknown)=>error instanceof Error?error.message:'Unable to save this reason.';

export async function saveOnboardingExitReason(form:FormData){
 const auth=await requirePagePermission('delivery_associates','edit');
 try{
  if(auth.readOnly||!supabaseAdmin)throw new Error('Changes are unavailable.');
  const company=requireCompanyId(auth),id=value(form,'id');
  const clientCode=value(form,'client_code').toUpperCase(),code=value(form,'code').toLowerCase();
  const label=value(form,'label'),description=value(form,'description');
  const sortOrder=Number(value(form,'sort_order')||100);
  if(!/^[A-Z0-9_-]{2,40}$/.test(clientCode))throw new Error('Use a valid client code.');
  if(!/^[a-z0-9_]{2,60}$/.test(code))throw new Error('Reason code can use lowercase letters, numbers and underscores.');
  if(label.length<2||label.length>120)throw new Error('Enter a reason label.');
  if(description.length>500)throw new Error('Description is too long.');
  if(!Number.isInteger(sortOrder)||sortOrder<1||sortOrder>10000)throw new Error('Enter a valid display order.');
  const payload={company_id:company,client_code:clientCode,code,label,description,requires_note:form.get('requires_note')==='on',is_active:form.get('is_active')==='on',sort_order:sortOrder,updated_at:new Date().toISOString()};
  const result=id
   ?await supabaseAdmin.from('workforce_onboarding_exit_reasons').update(payload).eq('company_id',company).eq('id',id)
   :await supabaseAdmin.from('workforce_onboarding_exit_reasons').insert(payload);
  if(result.error)throw new Error(result.error.message);
 }catch(error){redirect(`${path}?error=${encodeURIComponent(fail(error))}`);}
 revalidatePath(path);redirect(`${path}?notice=Exit+reason+saved`);
}
