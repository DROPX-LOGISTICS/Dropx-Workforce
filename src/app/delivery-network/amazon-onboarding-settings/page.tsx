import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { SubmitButton } from "@/components/submit-button";
import { hasPermission, requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { readAllRows } from "@/lib/supabase-pagination";
import { saveAmazonStation } from "./actions";
import styles from "../joining/page.module.css";

export const dynamic="force-dynamic";
export type AmazonStationSettings={station_id:string;service_area_code:string;service_type:string;supervisor_alias:string;contract_type:string;version:number;updated_at:string};
export default async function AmazonSettings({searchParams:params={}}:{searchParams?:{station?:string;notice?:string;error?:string}}) {
  const auth=await requirePagePermission("executive_id_onboarding","access");
  const company=requireCompanyId(auth);
  if (!supabaseAdmin) return <AppShell active="Amazon Station Defaults" pageCode="executive_id_onboarding"><p>Database is unavailable.</p></AppShell>;
  let query=supabaseAdmin.from("stations").select("id,station_code").eq("company_id",company).order("station_code");
  if (!auth.hasAllLocationAccess) query=query.in("id",auth.locationScopeIds.length ? auth.locationScopeIds : ["00000000-0000-0000-0000-000000000000"]);
  const [stationsResult,settingsResult]=await Promise.all([readAllRows(query),readAllRows(supabaseAdmin.from("workforce_amazon_station_settings").select("station_id,service_area_code,service_type,supervisor_alias,contract_type,version,updated_at").eq("company_id",company).order("station_id"))]);
  const stations=stationsResult.data ?? [];
  const station=stations.find(row=>row.id===params.station) ?? stations[0];
  const settings=(settingsResult.data ?? []) as AmazonStationSettings[];
  const current=settings.find(row=>row.station_id===station?.id);
  const error=stationsResult.error?.message || settingsResult.error?.message || params.error;
  const canEdit=hasPermission(auth,"executive_id_onboarding","edit") && !auth.readOnly;
  const history=station ? await supabaseAdmin.from("workforce_amazon_station_events").select("id,actor_name,created_at,details").eq("company_id",company).eq("station_id",station.id).order("created_at",{ascending:false}).limit(20) : null;
  return <AppShell active="Amazon Station Defaults" pageCode="executive_id_onboarding"><div className={styles.desk}>
    <PageHead eyebrow="Workforce configuration" title="Amazon station defaults" subtitle="One verified service area, service type and supervisor login per station. Used by the joining desk; never an automatic change to Amazon." action={<Link href="/delivery-network/joining" className="button secondary compact">Open joining desk</Link>}/>
    {error || params.notice ? <div role="status" className={`${styles.message} ${error ? styles.error : ""}`}>{error || params.notice}</div>:null}
    <div className={styles.layout}><section className={styles.queue}><header><strong>Stations</strong><small>{stations.length} in scope</small></header>{stations.map(row=><Link className={`${styles.person} ${row.id===station?.id ? styles.current:""}`} key={row.id} href={`/delivery-network/amazon-onboarding-settings?station=${row.id}`}><strong>{row.station_code}</strong><span>{settings.find(item=>item.station_id===row.id)?.supervisor_alias || "Defaults not configured"}</span></Link>)}</section>
      {station ? <div className={styles.detail}><section className={styles.card}><header><div><h2>{station.station_code}</h2><p>Verify against Amazon Setup → Associates → Onboarding → Associate Settings. Defaults are a handoff reference, not proof the external setup is complete.</p></div></header>
        <form className={styles.plan} action={saveAmazonStation} key={station.id}>
          <input type="hidden" name="station_id" value={station.id}/><input type="hidden" name="version" value={current?.version ?? 0}/>
          <fieldset disabled={!canEdit || Boolean(stationsResult.error || settingsResult.error)} style={{border:0,padding:0,margin:0}}><div className={styles.fields}>
            <label>Amazon service-area code<input name="service_area_code" required maxLength={24} defaultValue={current?.service_area_code ?? ""} placeholder="Exact code, e.g. KOZA"/></label>
            <label>Service type<input value="Amazon Logistics" readOnly/></label>
            <label>Supervisor badge login<input name="supervisor_alias" required maxLength={80} defaultValue={current?.supervisor_alias ?? ""} placeholder="Without @amazon.com"/></label>
            <label>Approved DA contract type<select name="contract_type" required defaultValue={current?.contract_type ?? "Independent Contractor"}>{["Independent Contractor","Subcontractor","DSP Employed"].map(value=><option key={value}>{value}</option>)}</select></label>
          </div><p className={styles.hint}>No shared email passwords, OTPs or Amazon credentials belong in this master. Confirm the individual’s contract arrangement before each invitation.</p><SubmitButton pendingText="Saving station defaults">Save station defaults</SubmitButton></fieldset>
        </form></section><section className={styles.card}><header><h3>Change history · IST</h3></header><ol className={styles.history}>{(history?.data ?? []).map(row=><li key={row.id}><strong>{row.actor_name}</strong><span>{new Date(row.created_at).toLocaleString("en-IN",{timeZone:"Asia/Kolkata"})}</span><p>{row.details?.after?.service_area_code} · {row.details?.after?.service_type} · {row.details?.after?.supervisor_alias} · {row.details?.after?.contract_type}</p></li>)}{!history?.data?.length ? <li>{history?.error?.message || "No settings saved yet."}</li>:null}</ol></section></div>:<p>No permitted stations found.</p>}
    </div>
  </div></AppShell>;
}
