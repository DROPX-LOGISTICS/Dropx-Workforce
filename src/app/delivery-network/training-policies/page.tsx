import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { SubmitButton } from "@/components/submit-button";
import { hasPermission, requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { readAllRows } from "@/lib/supabase-pagination";
import type { TrainingPolicy } from "@/lib/workforce-joining";
import { saveTrainingPolicy } from "./actions";
import styles from "../joining/page.module.css";

export const dynamic="force-dynamic";
export default async function TrainingPolicies({searchParams:params={}}:{searchParams?:{station?:string;notice?:string;error?:string}}) {
  const auth=await requirePagePermission("people_review","access");
  const company=requireCompanyId(auth);
  if(!supabaseAdmin) return <AppShell active="Training Policies" pageCode="people_review"><p>Database is unavailable.</p></AppShell>;
  let query=supabaseAdmin.from("stations").select("id,station_code").eq("company_id",company).order("station_code");
  if(!auth.hasAllLocationAccess) query=query.in("id",auth.locationScopeIds.length ? auth.locationScopeIds : ["00000000-0000-0000-0000-000000000000"]);
  const [stationsResult,policiesResult]=await Promise.all([readAllRows(query),readAllRows(supabaseAdmin.from("workforce_training_policies").select("id,station_id,name,daily_rate,minimum_minutes,policy_reference,effective_from,effective_to,is_active").eq("company_id",company).order("effective_from",{ascending:false}).order("id"))]);
  const stations=stationsResult.data ?? [];
  const stationById=new Map(stations.map(row=>[row.id,row.station_code]));
  const policies=((policiesResult.data ?? []) as TrainingPolicy[]).filter(row=>stationById.has(row.station_id));
  const error=params.error || stationsResult.error?.message || policiesResult.error?.message;
  const canEdit=hasPermission(auth,"people_review","edit") && !auth.readOnly;
  return <AppShell active="Training Policies" pageCode="people_review"><div className={styles.desk}>
    <PageHead eyebrow="Workforce configuration" title="Training policy master" subtitle="Configure approved rates and attendance requirements by station. No default pay or duration is assumed." action={<Link className="button secondary compact" href="/delivery-network/joining">Select associate & policy →</Link>}/>
    {error || params.notice ? <div role="status" className={`${styles.message} ${error ? styles.error:""}`}>{error || params.notice}</div>:null}
    {canEdit ? <section className={styles.card}><header><div><h3>Create an approved policy</h3><p>Policies are immutable. Create a new version and retire the old one when terms change; existing joining agreements retain their saved terms.</p></div></header><form action={saveTrainingPolicy} className={styles.plan}><div className={styles.fields}>
      <label>Station<select name="station_id" required defaultValue={stations.some(row=>row.id===params.station)?params.station:''}><option value="">Choose station</option>{stations.map(row=><option value={row.id} key={row.id}>{row.station_code}</option>)}</select></label>
      <label>Policy name / version<input name="name" required minLength={3} maxLength={120} placeholder="e.g. Associate training · v1"/></label>
      <label>Agreed daily amount (₹)<input name="daily_rate" required type="number" min="0.01" step="0.01"/></label>
      <label>Minimum eligible attendance (minutes)<input name="minimum_minutes" required type="number" min="1" max="1440" step="1"/></label>
      <label>Eligible joining dates from<input name="effective_from" required type="date"/></label>
      <label>Eligible joining dates through (optional)<input name="effective_to" type="date"/></label>
      <label className={styles.wide}>Approved policy / agreement reference<input name="policy_reference" required minLength={3} maxLength={1000} placeholder="Document reference or approved version"/></label>
    </div><p className={styles.hint}>This is an attendance-eligibility rule, not a shift assignment. Each associate’s acceptance is recorded separately before applying the policy.</p><SubmitButton disabled={Boolean(stationsResult.error || policiesResult.error)} pendingText="Creating policy">Create training policy</SubmitButton></form></section>:null}
    <section className={styles.card} style={{marginTop:20}}><header><h3>{policies.length} policies in your station scope</h3></header><div className={styles.table}><table><thead><tr><th>Policy</th><th>Station</th><th>Daily amount</th><th>Minutes</th><th>Joining dates</th><th>Status</th><th>Action</th></tr></thead><tbody>{policies.map(row=><tr key={row.id}><td><strong>{row.name}</strong><br/>{row.policy_reference}</td><td>{stationById.get(row.station_id)}</td><td>₹{Number(row.daily_rate).toLocaleString("en-IN")}</td><td>{row.minimum_minutes}</td><td>{row.effective_from}<br/>{row.effective_to || "Open-ended"}</td><td>{row.is_active ? "Available":"Retired"}</td><td>{row.is_active && canEdit ? <form action={saveTrainingPolicy}><input type="hidden" name="retire_id" value={row.id}/><SubmitButton className="button secondary compact" confirmTitle="Retire this policy?" confirmMessage="This stops new selection. Existing joining agreements and earnings remain unchanged." pendingText="Retiring">Retire</SubmitButton></form>:"—"}</td></tr>)}</tbody></table>{!policies.length ? <p className={styles.empty}>No training policy configured yet. Add the agreed station policy above, then select an associate by DropX ID in the joining desk.</p>:null}</div></section>
  </div></AppShell>;
}
