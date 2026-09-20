import { supabaseAdmin } from "@/lib/supabase-admin";
import styles from "@/app/delivery-network/joining/page.module.css";

const when=(value:string)=>new Date(value).toLocaleString("en-IN",{timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"short"});
const labels:Record<string,string>={running:"Sync in progress",ok:"Last scan completed",no_linked_profiles:"No Amazon profile links to track yet",login_required:"Amazon session needs operator sign-in",layout_changed:"Amazon page changed — operator review required",unavailable:"Sync unavailable — last observation retained",not_started:"Worker has not checked yet"};

// Caller must first authorize the selected person using the scoped Joining loader.
export async function WorkforceAmazonObservation({company,person,profileId}:{company:string;person:string;profileId:string|null}) {
  if(!supabaseAdmin) return null;
  const [stateResult,observationResult,historyResult]=await Promise.all([
    supabaseAdmin.from("workforce_amazon_sync_state").select("status,last_attempt_at,last_success_at").eq("company_id",company).maybeSingle(),
    profileId ? supabaseAdmin.from("workforce_amazon_observations").select("progress,provider_status,observed_at").eq("company_id",company).eq("workforce_id",person).eq("provider_profile_id",profileId).maybeSingle():Promise.resolve({data:null,error:null}),
    profileId ? supabaseAdmin.from("workforce_amazon_observation_events").select("id,progress,provider_status,observed_at").eq("company_id",company).eq("workforce_id",person).eq("provider_profile_id",profileId).order("observed_at",{ascending:false}).limit(10):Promise.resolve({data:[],error:null})
  ]);
  const unavailable=stateResult.error||observationResult.error||historyResult.error;
  const state=stateResult.data;const observation=observationResult.data;
  const stale=observation && Date.now()-Date.parse(observation.observed_at)>90*60*1000;
  return <section className={styles.card} aria-label="Amazon automatic tracking">
    <header><div><h3>Amazon automatic tracking</h3><p>Read-only provider observations · every 30 minutes · all times IST</p></div></header>
    <div style={{padding:"16px 20px"}}>
      <p role="status">{unavailable ? "Tracking data is unavailable. The approved joining plan is unchanged." : labels[state?.status ?? "not_started"] ?? "Sync status unavailable"}{!unavailable&&state?.last_attempt_at ? ` · ${when(state.last_attempt_at)}`:""}</p>
      {!profileId ? <p className={styles.hint}>Save the Amazon profile identifier below after the operator sends the invitation. Tracking will then match this associate by that exact identifier.</p> : observation ? <>
        <strong>{observation.progress}</strong><p>{observation.provider_status}</p>
        <p className={styles.hint}>{stale ? "Stale observation — verify in Amazon before acting. ":""}Observed {when(observation.observed_at)}. {state?.last_attempt_at && observation.observed_at<state.last_attempt_at ? "This profile was not refreshed by the latest scan. Missing from onboarding does not mean activated.":""}</p>
        {(historyResult.data?.length ?? 0)>1 ? <details><summary>Provider status history</summary><ol className={styles.history}>{historyResult.data!.map(event=><li key={event.id}><strong>{event.progress}</strong><span>{when(event.observed_at)} · Amazon status sync</span><p>{event.provider_status}</p></li>)}</ol></details>:null}
      </> : <p className={styles.hint}>No matched provider observation yet. Confirm the linked profile exists in Amazon’s Onboarding list. No activation or pay change is inferred.</p>}
      <p className={styles.hint}>An operator sends invitations and applies station settings. The associate completes personal details, acceptance, verification and courses. Provider mapping and its effective date remain a separate approved action.</p>
    </div>
  </section>;
}
