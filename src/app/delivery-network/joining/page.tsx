import Link from "next/link";
import { ArrowRight, Fingerprint, History, ShieldCheck, UserRoundPlus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { SubmitButton } from "@/components/submit-button";
import { WorkforceAmazonObservation } from "@/components/workforce-amazon-observation";
import { hasPermission, requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadWorkforceJoining, type JoiningEvent } from "@/lib/workforce-joining-data";
import { invitationName, amazonTasks, amazonTaskStates, isJoiningApproved, joiningStages, joiningState, providerStages, providerInvitationEligibility, trainingEntitlements } from "@/lib/workforce-joining";
import { workforceToday } from "@/lib/workforce-earnings";
import { saveJoiningPlan } from "./actions";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
type Params = {person?:string;stage?:string;q?:string;station?:string;source?:string;sort?:string;due?:string;notice?:string;error?:string;page?:string};
const money = (value:number) => new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2}).format(value);
const when = (value:string) => new Date(value).toLocaleString("en-IN",{timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"short"});
function url(params:Params,changes:Params) {
  const merged = {...params,...changes,notice:undefined,error:undefined};
  return `/delivery-network/joining?${new URLSearchParams(Object.entries(merged).filter((entry):entry is [string,string]=>Boolean(entry[1])))}`;
}
export default async function JoiningPage({searchParams:params={}}:{searchParams?:Params}) {
  const auth = await requirePagePermission("delivery_associates","access");
  const today = workforceToday();
  let data: Awaited<ReturnType<typeof loadWorkforceJoining>> | null = null;
  let loadError = "";
  try { data = await loadWorkforceJoining(auth,{to:today}); }
  catch (error) { loadError = error instanceof Error ? error.message : "Joining data could not be loaded."; }
  if (!data) return <AppShell active="Joining & Training" pageCode="delivery_associates"><PageHead eyebrow="Workforce" title="Joining & Training" subtitle="Registration, training and provider activation in one desk."/><section className="panel message-panel error"><div className="panel-body"><h2>Joining desk is not ready</h2><p>{loadError}</p><Link href="/delivery-network/lifecycle">Open existing registration review</Link></div></section></AppShell>;
  const canEdit = hasPermission(auth,"people_review","edit") && !auth.readOnly;
  const stations = new Map(data.stations.map(row=>[row.id,row.station_code]));
  const plans = new Map(data.plans.map(row=>[row.workforce_id,row]));
  const rows = data.profiles.map(person=>{
    const plan = plans.get(person.id) ?? null;
    return {person,plan,state:joiningState(person,plan,data!.mappings,data!.attendance,today),invite:providerInvitationEligibility(person,plan,data!.mappings,data!.attendance,today)};
  });
  const search = (params.q ?? "").trim().toLowerCase();
  const filtered = rows.filter(({person,plan,state}) => (!params.stage || params.stage===state.stage)
    && (!params.station || person.location_id===params.station) && (!params.source || person.onboarding_application_source===params.source)
    && (!params.due || plan?.next_follow_up_on && plan.next_follow_up_on<=today && !["active","offboarded","closed"].includes(state.stage))
    && (!search || [person.full_name,person.dropx_id,person.biometric_id,plan?.provider_reference,plan?.contact_email].some(value=>value?.toLowerCase().includes(search))))
    .sort((a,b)=>params.sort==="updated" ? (b.plan?.updated_at ?? "").localeCompare(a.plan?.updated_at ?? "") || a.person.full_name.localeCompare(b.person.full_name)
      : params.sort==="followup" ? (a.plan?.next_follow_up_on ?? "9999").localeCompare(b.plan?.next_follow_up_on ?? "9999") || a.person.full_name.localeCompare(b.person.full_name)
      : a.person.full_name.localeCompare(b.person.full_name));
  const pages = Math.max(1,Math.ceil(filtered.length/25));
  const page = Math.min(pages,Math.max(1,Math.floor(Number(params.page)||1)));
  const visible = filtered.slice((page-1)*25,page*25);
  const selected = rows.find(row=>row.person.id===params.person) ?? visible[0];
  const plan = selected?.plan;
  const invitation = invitationName(selected?.person.full_name ?? "");
  const stationDefaults = selected && supabaseAdmin ? await supabaseAdmin.from("workforce_amazon_station_settings").select("service_area_code,service_type,supervisor_alias,contract_type").eq("company_id",requireCompanyId(auth)).eq("station_id",selected.person.location_id).maybeSingle() : null;
  const entitlements = selected && plan ? trainingEntitlements(selected.person,plan,data.mappings,data.attendance,plan.eligible_from,today) : [];
  let events: JoiningEvent[] = [];
  let eventError = "";
  if (selected && supabaseAdmin) {
    const result = await supabaseAdmin.from("workforce_joining_events").select("id,workforce_id,event_code,actor_name,created_at,details").eq("company_id",requireCompanyId(auth)).eq("workforce_id",selected.person.id).order("created_at",{ascending:false}).order("id").limit(100);
    events = (result.data ?? []) as JoiningEvent[];
    eventError = result.error?.message ?? "";
  }
  const due = rows.filter(row=>row.plan?.next_follow_up_on && row.plan.next_follow_up_on<=today && !["active","offboarded","closed"].includes(row.state.stage)).length;
  const inviteReady = rows.filter(row=>row.invite.eligible && row.plan && ["not_started","email_setup","documents_pending"].includes(row.plan.provider_stage)).length;
  return <AppShell active="Joining & Training" pageCode="delivery_associates">
    <div className={styles.desk}>
      <PageHead eyebrow="From first arrival to first payout" title="Joining & Training" subtitle="Keep applicants separate. Follow real attendance, agreed pay and provider-ID progress." action={<Link className="button compact" href="/delivery-network/onboarding"><UserRoundPlus size={16}/> Invite associate</Link>}/>
      {params.notice || params.error ? <div role="status" className={`${styles.message} ${params.error ? styles.error : ""}`}>{params.error || params.notice}</div> : null}
      <div className={styles.flow}><span>1 · Register in One</span><ArrowRight size={14}/><span>2 · Workforce approval</span><ArrowRight size={14}/><span>3 · Biometric training / direct joining</span><ArrowRight size={14}/><span>4 · Provider ID + rate mapping</span><ArrowRight size={14}/><span>5 · Earnings & settlement</span></div>
      <nav className={styles.stages} aria-label="Joining stages">
        <Link className={!params.stage ? styles.selected : ""} href={url(params,{stage:undefined,person:undefined,page:"1"})}>All profiles<strong>{rows.length}</strong></Link>
        {Object.entries(joiningStages).map(([key,label])=><Link key={key} className={params.stage===key ? styles.selected : ""} href={url(params,{stage:key,person:undefined,page:"1"})}>{label}<strong>{rows.filter(row=>row.state.stage===key).length}</strong></Link>)}
      </nav>
      <div className={styles.brief}><span><Fingerprint size={17}/> <strong>{inviteReady}</strong> ready for an invitation task after direct joining or two complete training days</span><Link href={url(params,{due:"1",stage:undefined,page:"1",person:undefined})}>{due} follow-ups due <ArrowRight size={14}/></Link></div>
      <form key={JSON.stringify([params.stage,params.q,params.person,params.station,params.source,params.sort,params.due])} className={styles.filters} method="get">
        {params.stage ? <input type="hidden" name="stage" value={params.stage}/> : null}
        <label>Search<input name="q" defaultValue={params.q} placeholder="Name, DropX / biometric ID or email"/></label>
        <label>Associate / DropX ID<select name="person" defaultValue={params.person ?? ""}><option value="">Choose associate</option>{data.profiles.map(row=><option key={row.id} value={row.id}>{row.dropx_id || row.biometric_id || "ID pending"} · {row.full_name}</option>)}</select></label>
        <label>Station<select name="station" defaultValue={params.station ?? ""}><option value="">All permitted stations</option>{data.stations.map(row=><option key={row.id} value={row.id}>{row.station_code}</option>)}</select></label>
        <label>Source<select name="source" defaultValue={params.source ?? ""}><option value="">All sources</option>{[...new Set(data.profiles.map(row=>row.onboarding_application_source).filter(Boolean))].sort().map(source=><option key={source} value={source!}>{source!.replaceAll("_"," ")}</option>)}</select></label>
        <label>Sort<select name="sort" defaultValue={params.sort ?? "name"}><option value="name">Name A–Z</option><option value="followup">Follow-up date</option><option value="updated">Recently updated</option></select></label>
        <label>Follow-ups<select name="due" defaultValue={params.due ?? ""}><option value="">All</option><option value="1">Due / overdue</option></select></label>
        <button className="button secondary" type="submit">Apply</button><Link href="/delivery-network/joining">Reset</Link>
      </form>
      <div className={styles.layout}>
        <section className={styles.queue} aria-label="Joining queue"><header><strong>{filtered.length} profiles</strong><small>Page {page} of {pages}</small></header>
          {visible.map(row=><Link key={row.person.id} href={url(params,{person:row.person.id})} className={`${styles.person} ${selected?.person.id===row.person.id ? styles.current : ""}`} aria-current={selected?.person.id===row.person.id ? "true" : undefined}>
            <strong>{row.person.full_name}</strong><span>{row.person.dropx_id || "Identity reserved"} · {stations.get(row.person.location_id) || "Station pending"}</span>
            <div><b>{joiningStages[row.state.stage]}</b><small>{row.plan ? providerStages[row.plan.provider_stage] : "Terms not configured"}</small></div>
          </Link>)}
          {!visible.length ? <p className={styles.empty}>No profiles match these filters. <Link href="/delivery-network/joining">Clear filters</Link></p> : null}
          <footer>{page>1 ? <Link href={url(params,{page:String(page-1),person:undefined})}>← Previous</Link>:<span/>}{page<pages ? <Link href={url(params,{page:String(page+1),person:undefined})}>Next →</Link>:null}</footer>
        </section>
        {selected ? <div className={styles.detail} key={selected.person.id}>
          <WorkforceAmazonObservation company={requireCompanyId(auth)} person={selected.person.id} profileId={plan?.provider_profile_id ?? null}/>
          <section className={styles.card}><header><div><small>{selected.person.designation} · {stations.get(selected.person.location_id)}</small><h2>{selected.person.full_name}</h2><p>{selected.person.dropx_id || "ID reserved"} · Biometric {selected.person.biometric_id || "not enrolled"}</p></div><span className={styles.badge}>{joiningStages[selected.state.stage]}</span></header>
            <div className={styles.facts}><div>First training arrival<strong>{plan?.mode==="training" ? selected.state.firstPunch || "Awaiting valid punch" : "No training plan"}</strong></div><div>Regular-pay boundary<strong>{selected.state.mapping?.effective_from || "Provider mapping pending"}</strong></div><div>Eligible training days<strong>{entitlements.filter(row=>!row.holds.length).length}</strong></div><div>Training estimate<strong>{money(entitlements.filter(row=>!row.holds.length).reduce((sum,row)=>sum+row.amount,0))}</strong></div></div>
            <div className={styles.links}>{hasPermission(auth,"people_review","access") ? <Link href="/delivery-network/lifecycle">Registration approval / exit</Link>:null}{hasPermission(auth,"provider_mapping","access") ? <Link href="/delivery-network/rate-mapping">Map provider ID & rate</Link>:null}{hasPermission(auth,"workforce_earnings","access") ? <Link href={`/delivery-network/earnings?q=${encodeURIComponent(selected.person.dropx_id || selected.person.full_name)}`}>Earnings & holds</Link>:null}</div>
          </section>
          {!isJoiningApproved(selected.person) ? <div className={styles.message}><ShieldCheck size={18}/> Complete DropX One registration and Workforce review first. Applicants do not accrue training pay automatically.</div> : null}
          <section className={styles.card}><header><div><h3>Joining agreement & provider tracker</h3><p>Recorded progress—not an automatic Amazon invitation. Passwords and verification codes stay with the associate.</p></div></header>
            <div className={styles.links}>{stationDefaults?.data ? <span>Station defaults: <strong>{stationDefaults.data.service_area_code}</strong> · {stationDefaults.data.service_type} · supervisor <strong>{stationDefaults.data.supervisor_alias}</strong> · {stationDefaults.data.contract_type}</span>:<span>{stationDefaults?.error ? "Station defaults are unavailable." : "Amazon station defaults are not configured."}</span>}{hasPermission(auth,"executive_id_onboarding","access") ? <Link href={`/delivery-network/amazon-onboarding-settings?station=${selected.person.location_id}`}>Configure station defaults</Link>:null}</div>
            {isJoiningApproved(selected.person) && canEdit ? <form action={saveJoiningPlan} className={styles.plan}>
              <input type="hidden" name="workforce_id" value={selected.person.id}/><input type="hidden" name="version" value={plan?.version ?? 0}/>
              <div className={styles.fields}>
                <label>Joining path<select name="mode" defaultValue={plan?.mode ?? "training"}><option value="training">Paid training, then own ID</option><option value="direct">Experienced / direct joining · no training</option></select></label>
                <label>Eligible from<input type="date" name="eligible_from" defaultValue={plan?.eligible_from} required/></label>
                <label className={styles.wide}>Training policy · station master<select name="training_policy_id" defaultValue={plan?.training_policy_id ?? ""}><option value="">Select policy (not required for direct joining)</option>{data.policies.filter(row=>row.station_id===selected.person.location_id && (row.is_active || row.id===plan?.training_policy_id)).map(row=><option key={row.id} value={row.id}>{row.name} · {money(Number(row.daily_rate))}/day · {row.minimum_minutes} min · from {row.effective_from}{row.is_active ? "":" · retired (existing terms)"}</option>)}</select><Link href="/delivery-network/training-policies">Configure training policy master</Link></label>
                {plan?.mode==="training" ? <p className={styles.hint}>Saved terms: {money(Number(plan.daily_rate))} / eligible day · {plan.minimum_minutes} minutes minimum. Selecting another policy changes terms only after validation and save.</p>:null}
                <label>Terms accepted on<input type="date" name="terms_accepted_on" max={today} defaultValue={plan?.terms_accepted_on} required/></label>
                <label>Agreement / policy evidence<input name="terms_reference" minLength={3} maxLength={1000} defaultValue={plan?.terms_reference} required placeholder="Accepted agreement reference / version"/></label>
                <label>Training completed on (optional)<input type="date" name="training_completed_on" max={today} defaultValue={plan?.training_completed_on ?? ""}/></label>
                <label>Last training day if left (optional)<input type="date" name="closed_on" max={today} defaultValue={plan?.closed_on ?? ""}/></label>
              </div>
              <p className={styles.hint}>Training ends before the first provider mapping effective date. After a recorded training-completion date, unmapped days are held for a separate waiting/work arrangement—not automatically paid at the training rate. This does not complete a formal exit.</p>
              <h4>Provider ID progress</h4>
              <p className={styles.hint}>Invitation name fields are editable suggestions—verify them before use. Single-name example: Peter / Peter, no suffix. The legal full name stays unchanged. Amazon’s acceptance of the duplicate-name format must be confirmed.</p>
              <div className={styles.fields}>
                <label>Invitation first name<input name="invitation_first_name" maxLength={120} defaultValue={plan?.invitation_first_name ?? invitation.first_name}/></label>
                <label>Invitation last name<input name="invitation_last_name" maxLength={120} defaultValue={plan?.invitation_last_name ?? invitation.last_name}/></label>
                <label>Suffix (only if applicable)<input name="invitation_suffix" maxLength={20} defaultValue={plan?.invitation_suffix ?? ""} placeholder="Usually blank; not Mr. / Ms."/></label>
                <label>Legal full name · unchanged<input value={selected.person.full_name} readOnly/></label>
                <label>Current step<select name="provider_stage" defaultValue={plan?.provider_stage ?? "not_started"}>{Object.entries(providerStages).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
                <label>Associate-controlled email<input name="contact_email" type="email" maxLength={254} defaultValue={plan?.contact_email ?? ""} placeholder="Existing Gmail / Outlook address"/></label>
                <label>Follow-up owner<input name="assigned_to" maxLength={160} defaultValue={plan?.assigned_to ?? ""} placeholder="Responsible team member"/></label>
                <label>Next follow-up<input name="next_follow_up_on" type="date" defaultValue={plan?.next_follow_up_on ?? ""}/></label>
                <label>Provider submission date<input name="provider_submitted_on" type="date" max={today} defaultValue={plan?.provider_submitted_on ?? ""}/></label>
                <label>Provider activation date<input name="provider_activated_on" type="date" max={today} defaultValue={plan?.provider_activated_on ?? ""}/></label>
                <label className={styles.wide}>Provider ID / application reference<input name="provider_reference" maxLength={200} defaultValue={plan?.provider_reference ?? ""} placeholder="Verified provider reference; mapping is a separate controlled step"/></label>
                <label className={styles.wide}>Amazon profile identifier<input name="provider_profile_id" defaultValue={plan?.provider_profile_id ?? ""} placeholder="amzn1.flex.provider.v1.… (from the Amazon profile URL)"/></label>
                <label className={styles.wide}>Evidence, blocker & next action<textarea name="owner_note" maxLength={2000} rows={2} defaultValue={plan?.owner_note ?? ""} placeholder="Who needs to do what next? Do not enter passwords, OTPs or sensitive documents."/></label>
              </div>
              <details style={{marginTop:18}}><summary style={{cursor:"pointer",fontSize:13,fontWeight:650}}>Amazon task checklist · ownership & progress</summary><p className={styles.hint}>Record verified portal observations. Marking a task complete here does not perform it in Amazon. Associate agreements and training must be completed by the associate.</p><div className={styles.fields}>{Object.entries(amazonTasks).map(([key,task])=><label key={key}>{task.owner} · {task.label}<select name={`amazon_${key}`} defaultValue={plan?.amazon_tasks?.[key as keyof typeof amazonTasks] ?? "pending"}>{Object.entries(amazonTaskStates).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>)}</div></details>
              <div className={styles.links}><a href="https://logistics.amazon.in/account-management/delivery-associates/add" target="_blank" rel="noreferrer">Open Amazon invitation form ↗</a>{plan?.provider_profile_id && /^amzn1\.flex\.provider\.v1\.[0-9a-f-]{36}$/.test(plan.provider_profile_id) ? <a href={`https://logistics.amazon.in/account-management/delivery-associates/detail/${encodeURIComponent(plan.provider_profile_id)}`} target="_blank" rel="noreferrer">Open linked Amazon profile ↗</a>:null}</div>
              <label className={styles.confirm}><input type="checkbox" name="confirmed_terms" value="yes" required/> I verified these terms were accepted by the associate and the recorded provider progress is accurate.</label>
              <div className={styles.save}><small>{plan ? `Version ${plan.version} · last updated ${when(plan.updated_at)} IST` : "No pay terms are assumed until saved."}</small><SubmitButton pendingText="Saving joining plan">Save joining plan</SubmitButton></div>
            </form> : <div className={styles.empty}>{plan ? <><p>{plan.mode==="training" ? `${money(Number(plan.daily_rate))} / eligible training day` : "Direct joining — no training pay"} · from {plan.eligible_from}</p><p>{providerStages[plan.provider_stage]} · {plan.assigned_to || "Owner not assigned"}</p><p>{plan.owner_note || "No follow-up note"}</p></> : <p>Agreed joining terms have not been configured.</p>}{!canEdit ? <p>Workforce review permission is required to change this plan.</p>:null}</div>}
          </section>
          <section className={styles.card}><header><div><h3><Fingerprint size={17}/> Attendance → training estimate</h3><p>Ready means attendance qualifies. Bank details, payroll review and payment confirmation are still required.</p></div></header>
            <div className={styles.table}><table><thead><tr><th>Day</th><th>Minutes</th><th>Estimate</th><th>Review</th></tr></thead><tbody>{entitlements.slice().sort((a,b)=>b.attendance.punch_date.localeCompare(a.attendance.punch_date)).slice(0,90).map(row=><tr key={row.attendance.id}><td>{row.attendance.punch_date}</td><td>{row.attendance.work_minutes ?? "—"}</td><td>{money(row.amount)}</td><td>{row.holds.length ? row.holds.join(" · ") : "Attendance ready"}</td></tr>)}</tbody></table>{!entitlements.length ? <p className={styles.empty}>No training attendance in the agreed period. Direct hires do not generate training pay.</p>:null}{entitlements.length>90 ? <p className={styles.hint}>Showing latest 90 days; the earnings date filter provides period detail.</p>:null}</div>
          </section>
          <section className={styles.card}><header><div><h3><History size={17}/> History & responsibility</h3><p>Latest 100 changes · all times IST. Earlier biometric dates are source evidence, not manually entered events.</p></div></header><ol className={styles.history}>
            {selected.person.onboarding_approved_at ? <li><strong>Registration approved</strong><span>{when(selected.person.onboarding_approved_at)} IST · Workforce approval record</span></li>:null}
            {selected.state.firstPunch ? <li><strong>First eligible biometric arrival</strong><span>{selected.state.firstPunch} · attendance source</span></li>:null}
            {events.map(event=>{const after=event.details.after as Record<string,unknown>|undefined;return <li key={event.id}><strong>{event.event_code.replaceAll("_"," ")}</strong><span>{event.actor_name} · {when(event.created_at)} IST</span>{after ? <p>{providerStages[after.provider_stage as keyof typeof providerStages] ?? "Plan updated"} · eligible {String(after.eligible_from ?? "—")}{after.owner_note ? ` · ${String(after.owner_note)}`:""}</p>:<p>Effective from {String(event.details.effective_from ?? "—")}</p>}</li>;})}
            {!events.length ? <li>{eventError || "No joining-plan changes recorded yet."}</li>:null}
          </ol></section>
        </div>:null}
      </div>
    </div>
  </AppShell>;
}
