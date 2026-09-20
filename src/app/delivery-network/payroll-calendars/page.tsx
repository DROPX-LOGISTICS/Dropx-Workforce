import Link from 'next/link';
import {AppShell} from '@/components/app-shell';
import {PageHead} from '@/components/page-head';
import {SubmitButton} from '@/components/submit-button';
import {requirePagePermission,hasPermission} from '@/lib/authorization';
import {requireCompanyId} from '@/lib/company-scope';
import {supabaseAdmin} from '@/lib/supabase-admin';
import {readAllRows} from '@/lib/supabase-pagination';
import {savePayrollCalendar} from './actions';
import styles from '../joining/page.module.css';
export const dynamic='force-dynamic';
export default async function PayrollCalendars({searchParams:params={}}:{searchParams?:{station?:string;notice?:string;error?:string}}){
  const auth=await requirePagePermission('workforce_payroll','access'),company=requireCompanyId(auth);
  if(!supabaseAdmin) return <AppShell active="Payroll Calendars" pageCode="workforce_payroll"><p role="alert">Database is unavailable.</p></AppShell>;
  let query=supabaseAdmin.from('stations').select('id,station_code').eq('company_id',company).order('station_code');
  if(!auth.hasAllLocationAccess)query=query.in('id',auth.locationScopeIds.length ? auth.locationScopeIds:['00000000-0000-0000-0000-000000000000']);
  const [stations,calendars]=await Promise.all([readAllRows(query),readAllRows(supabaseAdmin.from('workforce_payroll_calendars').select('*').eq('company_id',company).order('created_at',{ascending:false}).order('id'))]);
  const names=new Map((stations.data ?? []).map(row=>[row.id,row.station_code]));const rows=(calendars.data ?? []).filter(row=>names.has(row.station_id));
  const error=params.error || stations.error?.message || calendars.error?.message;const canEdit=hasPermission(auth,'workforce_payroll','edit')&&!auth.readOnly;
  return <AppShell active="Payroll Calendars" pageCode="workforce_payroll"><div className={styles.desk}><PageHead eyebrow="Station configuration" title="Payroll calendars" subtitle="Daily, weekly, rolling 15-day, monthly or custom periods. This controls the pay period—not the earning rate, attendance or Finance approval." action={<Link href="/delivery-network/payroll" className="button secondary">Payroll runs →</Link>}/>
    {error || params.notice ? <p role="status" className={`${styles.message} ${error ? styles.error:''}`}>{error || params.notice}</p>:null}
    {canEdit ? <section className={styles.card}><header><h3>Create an approved calendar</h3></header><form action={savePayrollCalendar} className={styles.plan}><div className={styles.fields}>
      <label>Station<select name="station_id" required defaultValue={names.has(params.station??'')?params.station:''}><option value="">Choose station</option>{(stations.data ?? []).map(row=><option key={row.id} value={row.id}>{row.station_code}</option>)}</select></label>
      <label>Name / version<input name="name" required minLength={3} maxLength={120}/></label>
      <label>Frequency<select name="cadence" required defaultValue="weekly"><option value="daily">Daily</option><option value="weekly">Weekly · 7 days</option><option value="fifteen_days">Every 15 days</option><option value="monthly">Calendar month</option><option value="custom">Custom number of days</option></select></label>
      <label>First period starts<input name="anchor_date" required type="date"/><small>For monthly, select the first day of the month.</small></label>
      <label>Custom interval (days)<input name="interval_days" type="number" min="1" max="93" step="1"/><small>Only used for Custom frequency.</small></label>
      <label>Approved policy reference<input name="policy_reference" required minLength={3} maxLength={1000}/></label>
    </div><p className={styles.hint}>Versioned calendars preserve existing payroll. Creating one does not change pay terms or send money.</p><SubmitButton disabled={Boolean(error)} pendingText="Saving calendar">Save calendar</SubmitButton></form></section>:null}
    <section className={styles.card} style={{marginTop:20}}><header><h3>Station calendars</h3></header><div className={styles.table}><table><thead><tr><th>Calendar</th><th>Station</th><th>Frequency</th><th>Starts</th><th>Policy</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{row.name}</td><td>{names.get(row.station_id)}</td><td>{row.cadence.replaceAll('_',' ')}{row.interval_days ? ` · ${row.interval_days} days`:''}</td><td>{row.anchor_date}</td><td>{row.policy_reference}</td><td>{row.is_active ? 'Available':'Retired'}</td><td>{canEdit&&row.is_active ? <form action={savePayrollCalendar}><input type="hidden" name="retire_id" value={row.id}/><SubmitButton className="button secondary compact" pendingText="Retiring" confirmTitle="Retire calendar?" confirmMessage="Stop new selection; existing payroll history will be retained.">Retire</SubmitButton></form>:'—'}</td></tr>)}</tbody></table>{!rows.length ? <p className={styles.empty}>No calendars configured. Custom date payroll remains available.</p>:null}</div></section>
  </div></AppShell>;
}
