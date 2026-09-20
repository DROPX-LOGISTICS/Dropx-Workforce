import {supabaseAdmin} from './supabase-admin';
import {readAllRows} from './supabase-pagination';
import {workforceDesignationPredicate} from './workforce-designation-policy';
export async function workforceClassification(company:string) {
  if(!supabaseAdmin)throw new Error('Database is unavailable.');
  const result=await readAllRows(supabaseAdmin.from('designations').select('id,code,name,category:designation_categories!designations_designation_category_id_fkey(people_module)').eq('company_id',company).order('id'));
  if(result.error)throw new Error('The designation master could not be verified.');
  return workforceDesignationPredicate(result.data??[]);
}
