"use server";
import {redirect} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {requirePagePermission} from '@/lib/authorization';
import {requireCompanyId} from '@/lib/company-scope';
import {supabaseAdmin} from '@/lib/supabase-admin';
import {payrollCalendarPeriod,type PayrollCalendar} from '@/lib/workforce-payroll-calendar';
const path='/delivery-network/payroll-calendars';
export async function savePayrollCalendar(form:FormData){
  const auth=await requirePagePermission('workforce_payroll','edit'),company=requireCompanyId(auth);
  const value=(name:string)=>String(form.get(name) ?? '').trim();const query=new URLSearchParams();
  try {
    if(auth.readOnly) throw new Error('Preview mode is read-only.');
    if(!supabaseAdmin) throw new Error('Database is unavailable.');
    const retire=value('retire_id');
    const existing=retire ? await supabaseAdmin.from('workforce_payroll_calendars').select('station_id').eq('company_id',company).eq('id',retire).maybeSingle():null;
    if(retire && (existing?.error || !existing?.data)) throw new Error('Calendar not found.');
    const station=existing?.data?.station_id ?? value('station_id');
    if(!station || !auth.hasAllLocationAccess && !auth.locationScopeIds.includes(station)) throw new Error('Choose a station in your access scope.');
    const stationResult=await supabaseAdmin.from('stations').select('id').eq('id',station).eq('company_id',company).maybeSingle();
    if(stationResult.error || !stationResult.data) throw new Error('Station not found in this company.');
    if(retire) {
      const result=await supabaseAdmin.from('workforce_payroll_calendars').update({is_active:false,retired_by:auth.userId,retired_at:new Date().toISOString()}).eq('company_id',company).eq('id',retire).eq('is_active',true).select('id').maybeSingle();
      if(result.error || !result.data) throw new Error(result.error?.message ?? 'Calendar was already retired.');
    } else {
      const cadence=value('cadence') as PayrollCalendar['cadence'],anchor_date=value('anchor_date');
      const interval_days=cadence==='custom' ? Number(value('interval_days')):null;
      payrollCalendarPeriod({cadence,anchor_date,interval_days},anchor_date);
      if(value('name').length<3 || value('name').length>120 || value('policy_reference').length<3 || value('policy_reference').length>1000) throw new Error('Enter a calendar name and approved policy reference.');
      const result=await supabaseAdmin.from('workforce_payroll_calendars').insert({company_id:company,station_id:station,name:value('name'),cadence,interval_days,anchor_date,policy_reference:value('policy_reference'),created_by:auth.userId});
      if(result.error) throw new Error(result.error.message);
    }
    revalidatePath(path);revalidatePath('/delivery-network/payroll');query.set('notice',retire ? 'Calendar retired. Existing payroll periods remain unchanged.':'Calendar saved. Select it when creating a station payroll; no payroll or payment was created.');
  }catch(error){query.set('error',error instanceof Error ? error.message:'Unable to save calendar.');}
  redirect(`${path}?${query}`);
}
