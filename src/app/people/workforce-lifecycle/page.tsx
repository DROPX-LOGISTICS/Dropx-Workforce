import { AlertTriangle, BadgeCheck, BriefcaseBusiness, ClipboardCheck, LogOut, ShieldCheck, UserCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { WorkforceExitPayroll } from "@/components/workforce-exit-payroll";
import { WorkforceAssociateSetup } from "@/components/workforce-associate-setup";
import { PageHead } from "@/components/page-head";
import { PendingLink } from "@/components/pending-link";
import { SubmitButton } from "@/components/submit-button";
import { hasPermission, requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {isActiveReviewProfile} from '@/lib/workforce-overview';
import {readAllRows} from '@/lib/supabase-pagination';
import { isNonEmployeeProfileType, workforceTable, type NonEmployeeProfileType } from "@/lib/workforce-profiles";
import { completeWorkforceSettlement, reviewWorkforceExit, reviewWorkforceOnboarding, startWorkforceExit } from "./actions";

export const dynamic = "force-dynamic";

type Applicant = {
  id: string; full_name: string; dropx_id: string | null; biometric_id: string | null;
  mobile_country_code: string | null; mobile: string; email: string | null; designation: string | null;
  location_id: string | null; date_of_join: string | null; onboarding_status: string; lifecycle_status: string;
  onboarding_application_source: string | null; onboarding_submitted_at: string | null; provider_id_status: string | null;
  provider_employee_id: string | null; onboarding_review_remarks: string | null; updated_at: string;
  identity_exception_required: boolean; identity_exception_context: Record<string, unknown> | null;
  stations: { station_code: string | null; station_name: string | null } | Array<{ station_code: string | null; station_name: string | null }> | null;
};

type ChecklistItem = { id: string; code: string; label: string; description: string | null; is_required: boolean; applicable_designation_codes: string[]; sort_order: number };
type ChecklistResult = { workforce_id: string; checklist_item_id: string; status: string; remarks: string | null };
type ReviewIssue = { account_id: string; kind: string; display_name: string | null; message: string | null; updated_at: string | null };
type ExitCase = { id: string; field_executive_id: string | null; profile_type: string; profile_id: string; profile_location_id: string | null; case_type: string; status: string; requested_effective_date: string; approved_effective_date: string | null; reason_code: string; reason_details: string | null; review_remarks: string | null; created_at: string };
type ExitProfile = { id: string; full_name: string; dropx_id: string | null; designation: string | null; location_id: string | null };

function first<T>(value: T | T[] | null | undefined) { return Array.isArray(value) ? value[0] ?? null : value ?? null; }
function title(value: string | null | undefined) { return String(value ?? "-").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function when(value: string | null | undefined) { if (!value) return "-"; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date); }

export default async function WorkforceLifecyclePage({ searchParams }: { searchParams?: { tab?: string; person?:string; section?:string; q?:string; from?:string;to?:string;error?: string; notice?: string } }) {
  const authorization = await requirePagePermission("people_review", "access");
  const companyId = requireCompanyId(authorization);
  const canEdit = Boolean(authorization.permissions.people_review?.canEdit && !authorization.readOnly);
  let tab = ["onboarding", "active", "exits"].includes(searchParams?.tab ?? "") ? searchParams!.tab! : "onboarding";
  let error = "";
  let applicants: Applicant[] = [];
  let checklist: ChecklistItem[] = [];
  let checklistResults: ChecklistResult[] = [];
  let acceptedIds = new Set<string>();
  let exits: ExitCase[] = [];
  let exitChecklist: Array<{ id: string; label: string; description: string | null; is_required: boolean }> = [];
  let designationCodes = new Map<string, string>();
  let activationGates = new Map<string, boolean>();
  const reviewIssuesByApplicant = new Map<string, ReviewIssue[]>();
  const exitProfileMap = new Map<string, ExitProfile>();
  if (!supabaseAdmin) {
    error = "Supabase service role key is not configured.";
  } else {
    let applicantQuery = supabaseAdmin.from("workforce")
      .select("id, full_name, dropx_id, biometric_id, mobile_country_code, mobile, email, designation, location_id, date_of_join, onboarding_status, lifecycle_status, onboarding_application_source, onboarding_submitted_at, provider_id_status, provider_employee_id, onboarding_review_remarks, identity_exception_required, identity_exception_context, updated_at, stations(station_code, station_name)")
      .eq("company_id", companyId).is("deleted_at", null).neq("migration_state", "reclassified").order("updated_at", { ascending: false });
    if (!authorization.hasAllLocationAccess) applicantQuery = applicantQuery.in("location_id", authorization.locationScopeIds.length ? authorization.locationScopeIds : ["00000000-0000-0000-0000-000000000000"]);
    const [applicantResult, checklistResult, resultResult, acceptanceResult, exitResult, exitMasterResult, designationResult, reviewIssueResult] = await Promise.all([
      readAllRows(applicantQuery.order('id')),
      supabaseAdmin.from("workforce_onboarding_checklist_master").select("id, code, label, description, is_required, applicable_designation_codes, sort_order").eq("company_id", companyId).eq("is_active", true).order("sort_order"),
      supabaseAdmin.from("workforce_onboarding_checklist_results").select("workforce_id, checklist_item_id, status, remarks").eq("company_id", companyId).not("workforce_id", "is", null),
      supabaseAdmin.from("workforce_agreement_acceptances").select("profile_id").eq("company_id", companyId).eq("profile_type", "workforce"),
      supabaseAdmin.from("workforce_lifecycle_cases").select("id, field_executive_id, profile_type, profile_id, profile_location_id, case_type, status, requested_effective_date, approved_effective_date, reason_code, reason_details, review_remarks, created_at").eq("company_id", companyId).order("created_at", { ascending: false }),
      supabaseAdmin.from("workforce_exit_checklist_master").select("id, label, description, is_required").eq("company_id", companyId).eq("is_active", true).order("sort_order"),
      supabaseAdmin.from("designations").select("name, code, dropx_one_activation_gate").eq("company_id", companyId).eq("is_active", true),
      supabaseAdmin.from("connect_profile_verifications").select("account_id, kind, display_name, message, updated_at").eq("company_id", companyId).eq("profile_type", "workforce").or("manual_review.eq.true,block_submit.eq.true")
    ]);
    const firstError = [applicantResult, checklistResult, resultResult, acceptanceResult, exitResult, exitMasterResult, designationResult, reviewIssueResult].find((result) => result.error)?.error;
    if (firstError) error = firstError.message;
    else {
      applicants = (applicantResult.data ?? []) as Applicant[];
      checklist = (checklistResult.data ?? []) as ChecklistItem[];
      checklistResults = (resultResult.data ?? []) as ChecklistResult[];
      acceptedIds = new Set((acceptanceResult.data ?? []).map((row) => String(row.profile_id)));
      exits = (exitResult.data ?? []) as ExitCase[];
      if (!authorization.hasAllLocationAccess) {
        exits = exits.filter((item) => item.profile_location_id && authorization.locationScopeIds.includes(item.profile_location_id));
      }
      exitChecklist = (exitMasterResult.data ?? []) as typeof exitChecklist;
      designationCodes = new Map((designationResult.data ?? []).map((row) => [String(row.name).toLowerCase(), String(row.code).toUpperCase()]));
      activationGates = new Map((designationResult.data ?? []).flatMap((row) => [[String(row.name).toLowerCase(),Boolean(row.dropx_one_activation_gate)],[String(row.code).toLowerCase(),Boolean(row.dropx_one_activation_gate)]]));
      for (const issue of (reviewIssueResult.data ?? []) as ReviewIssue[]) {
        reviewIssuesByApplicant.set(issue.account_id, [...(reviewIssuesByApplicant.get(issue.account_id) ?? []), issue]);
      }
      const profileTypes: NonEmployeeProfileType[] = ["workforce", "field_executive", "contractor", "vendor", "worker"];
      for (const profileType of profileTypes) {
        const ids = [...new Set(exits.filter((item) => item.profile_type === profileType).map((item) => item.profile_id))];
        if (!ids.length) continue;
        const profiles = await supabaseAdmin.from(workforceTable(profileType)).select("id, full_name, dropx_id, designation, location_id").eq("company_id", companyId).in("id", ids);
        if (profiles.error) { error = profiles.error.message; break; }
        for (const profile of profiles.data ?? []) exitProfileMap.set(`${profileType}:${profile.id}`, profile as ExitProfile);
      }
    }
  }
  const pending = applicants.filter((item) => !["active", "cancelled"].includes(item.onboarding_status));
  const active = applicants.filter(isActiveReviewProfile);
  const openExits = exits.filter((item) => !["rejected", "settled", "cancelled"].includes(item.status));
  const resultMap = new Map(checklistResults.map((item) => [`${item.workforce_id}:${item.checklist_item_id}`, item]));
  const applicantMap = new Map(applicants.map((item) => [item.id, item]));

  const matches=(item:Applicant)=>!searchParams?.q||[item.full_name,item.dropx_id,item.biometric_id,first(item.stations)?.station_code].some(v=>v?.toLowerCase().includes(searchParams.q!.toLowerCase()));
  const requestedPerson=searchParams?.person?applicants.find(p=>p.id===searchParams.person):undefined;
  if(requestedPerson && tab!=='exits') tab=isActiveReviewProfile(requestedPerson)||['inactive','offboarded','exited','terminated','resigned','settled'].includes(requestedPerson.lifecycle_status)?'active':'onboarding';
  const queue=(tab==='active'?active:pending).filter(matches);
  const selected=searchParams?.person?requestedPerson:queue[0];
  const requestedSection=searchParams?.section==='training'?'activation':searchParams?.section;
  const section=['profile','activation','payments','earnings','exit'].includes(requestedSection||'')?requestedSection!:'profile';
  const navPerson=requestedPerson??(tab!=='exits'?selected:undefined);
  const visibleExits=searchParams?.person?exits.filter(item=>item.profile_type==='workforce'&&item.profile_id===searchParams.person):exits;
  const profileSections=[['profile','1 · Registration'],['activation','2 · Amazon ID'],['payments','3 · Provider & pay'],...(hasPermission(authorization,'workforce_earnings','access')?[['earnings','4 · Earnings']]:[]),['exit','5 · Exit']];
  return <AppShell active="Associate Lifecycle" pageCode="people_review">
    <PageHead eyebrow="Workforce · Associate lifecycle" title={requestedPerson?'Associate workflow':tab==='exits'?'Exit & settlement':'Registration review'} subtitle={requestedPerson?'Registration → Amazon ID → Provider ID → pay readiness → exit.':'Select an associate and complete the next required action.'} action={<PendingLink className="button secondary" href="/delivery-network/associates">← All associates</PendingLink>}/>
    {searchParams?.notice ? <div className="notice">{searchParams.notice}</div> : null}
    {searchParams?.error || error ? <div className="error-box"><strong>Action required</strong><p>{searchParams?.error || error}</p></div> : null}
    {!searchParams?.person?<><section className="workforce-lifecycle-summary">
      <article><ClipboardCheck /><span>Awaiting HO</span><strong>{pending.filter((item) => item.onboarding_status === "under_review").length}</strong></article>
      <article><UserCheck /><span>Active partners</span><strong>{active.length}</strong></article>
      <article><LogOut /><span>Open exits</span><strong>{openExits.length}</strong></article>
      <article><ShieldCheck /><span>Agreements accepted</span><strong>{acceptedIds.size}</strong></article>
    </section>
    <nav className="workforce-lifecycle-tabs" aria-label="Workforce lifecycle sections">
      <PendingLink className={tab === "onboarding" ? "active" : ""} href="?tab=onboarding">Onboarding approvals</PendingLink>
      <PendingLink className={tab === "active" ? "active" : ""} href="?tab=active">Active partners</PendingLink>
      <PendingLink className={tab === "exits" ? "active" : ""} href="?tab=exits">Exit & settlement</PendingLink>
    </nav></>:null}
    {navPerson?<nav className="workforce-lifecycle-tabs" aria-label="Associate profile sections">{profileSections.map(([key,label])=><PendingLink key={key} className={(tab==='exits'?key==='exit':section===key)?'active':''} href={`?tab=${isActiveReviewProfile(navPerson)?'active':'onboarding'}&person=${navPerson.id}&section=${key}`}>{label}</PendingLink>)}</nav>:null}
    {tab!=='exits'&&!searchParams?.person?<><form className="wf-simple-search" method="get"><input type="hidden" name="tab" value={tab}/><input name="q" aria-label="Find associate" placeholder="Name, DropX ID, biometric ID or station" defaultValue={searchParams?.q}/><button className="button secondary">Search</button></form><div className="wf-simple-queue" aria-label="Associate review queue">{queue.map(item=><PendingLink key={item.id} className={selected?.id===item.id?'active':''} href={`?tab=${tab}&person=${item.id}`}><strong>{item.full_name}</strong><small>{item.dropx_id||'Registration pending'} · {first(item.stations)?.station_code} · {title(item.onboarding_status)}</small></PendingLink>)}</div></>:null}

    {tab === "onboarding" ? <section className="workforce-lifecycle-grid">
      {selected ? [selected].map((item) => {
        const station = first(item.stations);
        const applicantDesignationCode = designationCodes.get(String(item.designation ?? "").toLowerCase()) ?? "";
        const activationGated = activationGates.get(String(item.designation ?? "").toLowerCase()) ?? activationGates.get(applicantDesignationCode.toLowerCase()) ?? false;
        const applicable = checklist.filter((check) => !check.applicable_designation_codes?.length || check.applicable_designation_codes.map((code) => code.toUpperCase()).includes(applicantDesignationCode));
        const reviewIssues = reviewIssuesByApplicant.get(item.id) ?? [];
        const existingProfiles = Array.isArray(item.identity_exception_context?.existing_profiles)
          ? item.identity_exception_context.existing_profiles as Array<Record<string, unknown>>
          : [];
        return <article className="card workforce-lifecycle-card" key={item.id}>
          <header><div><small>{title(item.onboarding_application_source)} request</small><h2>{item.full_name}</h2><p>{item.dropx_id || "ID reserved"} · {station?.station_code || "No station"} · {item.designation || "No designation"}</p></div><span className={`status ${item.onboarding_status}`}>{title(item.onboarding_status)}</span></header>
          <div className="workforce-lifecycle-facts"><span>Mobile<strong>+{item.mobile_country_code || "91"} {item.mobile}</strong></span><span>Submitted<strong>{when(item.onboarding_submitted_at || item.updated_at)}</strong></span><span>Agreement<strong>{acceptedIds.has(item.id) ? "Accepted" : "Pending"}</strong></span><span>Provider ID<strong>{item.provider_employee_id || title(item.provider_id_status)}</strong></span></div>
          <WorkforceAssociateSetup auth={authorization} id={item.id} dateOfJoin={item.date_of_join} tab={tab} section={section} from={searchParams?.from} to={searchParams?.to}/>
          {section==='profile'?<>
          {item.identity_exception_required ? <section className="workforce-lifecycle-issues"><header><span><AlertTriangle size={15} /> Existing employee · approval exception</span></header>{existingProfiles.map((profile, index) => <div key={`${String(profile.source_type ?? "profile")}:${String(profile.source_id ?? index)}`}><strong>{String(profile.display_name ?? "Existing person")}</strong><span>{String(profile.designation_name ?? profile.designation_code ?? "Existing designation")} · {title(String(profile.profile_status ?? "existing"))}</span></div>)}</section> : null}
          {reviewIssues.length ? <section className="workforce-lifecycle-issues"><header><span><AlertTriangle size={15} /> Profile correction required</span><PendingLink href={`/delivery-network/onboarding/associates?edit=${encodeURIComponent(item.id)}&review=1`}>Resolve {reviewIssues.length} {reviewIssues.length === 1 ? "issue" : "issues"}</PendingLink></header>{reviewIssues.map((issue) => <div key={`${issue.kind}:${issue.updated_at ?? ""}`}><strong>{title(issue.kind)}</strong><span>{issue.message || "Verification requires manual review."}{issue.display_name ? ` · Verified source: ${issue.display_name}` : ""}</span></div>)}</section> : null}
          {canEdit && ["under_review", "returned", "approved"].includes(item.onboarding_status) ? <form action={reviewWorkforceOnboarding} className="workforce-review-form">
            <input name="id" type="hidden" value={item.id} />
            <h3>HO activation checklist</h3>
            {item.identity_exception_required ? <label><input name="identity_exception_approved" type="checkbox" value="true" /><span><strong>Approve secondary Workforce engagement *</strong><small>I verified the existing designation above and approve this different role without creating a duplicate person.</small></span></label> : null}
            {applicable.map((check) => {
              const existing = resultMap.get(`${item.id}:${check.id}`);
              return <label key={check.id}><input defaultChecked={["completed", "not_required"].includes(existing?.status ?? "")} name={`checklist_${check.id}`} type="checkbox" value="true" /><span><strong>{check.label}{check.is_required ? " *" : ""}</strong><small>{check.description}</small></span></label>;
            })}
            <div className="workforce-provider-row"><label>Amazon / provider ID<input defaultValue={item.provider_employee_id || ""} name="provider_employee_id" placeholder="Enter ID after creation" /></label><label className="compact-check"><input name="provider_not_required" type="checkbox" value="true" />Not required for this designation</label></div>
            <label>Review remarks<textarea name="remarks" placeholder="Verification, return or rejection note" /></label>
            <p className="subtle">Provider ID pending? Approve for joining after all other checks. This enables biometric attendance without marking the associate delivery-active.</p>
            <button className="button" disabled={Boolean(reviewIssues.length)} name="review_action" type="submit" value="approve_for_joining">Approve registration → Amazon ID</button>
            <div className="form-actions"><button className="button secondary" name="review_action" type="submit" value="return">Return</button><button className="button danger" name="review_action" type="submit" value="reject">Reject</button>{!activationGated?<button className="button secondary" disabled={Boolean(reviewIssues.length)} name="review_action" title={reviewIssues.length ? "Resolve profile verification issues before approval" : undefined} type="submit" value="approve">Activate without Amazon ID</button>:null}</div>
          </form> : <p className="subtle">{item.onboarding_review_remarks || "Waiting for the applicant or HO action."}</p>}
          </>:null}
        </article>;
      }) : <div className="card workforce-empty"><BadgeCheck /><h2>No onboarding requests pending</h2><p>New workforce requests from Recruit and Ops will appear here after the applicant submits the profile.</p></div>}
    </section> : null}

    {tab === "active" ? <section className="workforce-lifecycle-grid">
      {selected ? [selected].map((item) => { const station = first(item.stations); return <article className="card workforce-lifecycle-card" key={item.id}>
        <header><div><small>Workforce associate</small><h2>{item.full_name}</h2><p>{item.dropx_id || "-"} · {station?.station_code || "-"} · {item.designation || "-"}</p></div><span className="status">{isActiveReviewProfile(item)?'Active':title(item.lifecycle_status)}</span></header>
        <div className="workforce-lifecycle-facts"><span>Biometric<strong>{item.biometric_id || "-"}</strong></span><span>Provider ID<strong>{item.provider_employee_id || "Not required"}</strong></span><span>Date of join<strong>{item.date_of_join || "-"}</strong></span><span>Mobile<strong>+{item.mobile_country_code || "91"} {item.mobile}</strong></span></div>
        <WorkforceAssociateSetup auth={authorization} id={item.id} dateOfJoin={item.date_of_join} tab={tab} section={section} from={searchParams?.from} to={searchParams?.to}/>
        {section==='exit'&&canEdit&&isActiveReviewProfile(item)&&!openExits.some(exit=>exit.profile_type==='workforce'&&exit.profile_id===item.id) ? <form action={startWorkforceExit} className="workforce-exit-start"><input name="id" type="hidden" value={item.id} /><label>Exit type<select name="case_type" required><option value="">Select</option><option value="resignation">Resignation</option><option value="termination">Termination</option></select></label><label>Effective date<input name="effective_date" required type="date" /></label><label>Reason<select name="reason_code" required><option value="">Select</option><option value="voluntary">Voluntary resignation</option><option value="attendance">Attendance / abandonment</option><option value="performance">Performance</option><option value="conduct">Conduct / compliance</option><option value="business">Business requirement</option><option value="other">Other</option></select></label><label>Details<textarea name="reason_details" /></label><SubmitButton confirmMessage="This creates a formal workforce exit case and starts the settlement workflow." confirmTitle="Start exit process?">Start exit process</SubmitButton></form> : null}
      </article>; }) : <div className="card workforce-empty"><BriefcaseBusiness /><h2>No active workforce in scope</h2></div>}
    </section> : null}

    {tab === "exits" || section==='exit' ? <section className="workforce-lifecycle-grid">
      {visibleExits.length ? visibleExits.map((item) => { const person = item.profile_type === "workforce" ? applicantMap.get(item.profile_id) : isNonEmployeeProfileType(item.profile_type) ? exitProfileMap.get(`${item.profile_type}:${item.profile_id}`) : null; return <article className="card workforce-lifecycle-card" key={item.id}>
        <header><div><small>{title(item.profile_type)} · {title(item.case_type)}</small><h2>{person?.full_name || "Workforce profile"}</h2><p>{person?.dropx_id ? `${person.dropx_id} · ` : ""}Requested last day {item.requested_effective_date} · {title(item.reason_code)}</p></div><span className={`status ${item.status}`}>{title(item.status)}</span></header>
        {item.reason_details ? <p>{item.reason_details}</p> : null}
        {canEdit && ["submitted", "under_review"].includes(item.status) ? <form action={reviewWorkforceExit} className="workforce-decision-form"><input name="case_id" type="hidden" value={item.id} /><label>Decision remarks<textarea name="remarks" required /></label><div className="form-actions"><button className="button danger" name="review_action" type="submit" value="reject">Reject exit</button><button className="button" name="review_action" type="submit" value="approve">Approve for settlement</button></div></form> : null}
        {canEdit && item.status === "settlement_pending" ? <form action={completeWorkforceSettlement} className="workforce-review-form"><input name="case_id" type="hidden" value={item.id} /><h3>Exit checklist and final settlement</h3>{exitChecklist.map((check) => <label key={check.id}><input name={`exit_checklist_${check.id}`} type="checkbox" value="true" /><span><strong>{check.label}{check.is_required ? " *" : ""}</strong><small>{check.description}</small></span></label>)}{item.profile_type==='workforce'?<WorkforceExitPayroll companyId={companyId} workforceId={item.profile_id} lastDay={item.approved_effective_date??item.requested_effective_date}/>:<div className="workforce-settlement-values"><label>Gross amount<input min="0" name="gross_amount" step="0.01" type="number" /></label><label>Deductions<input min="0" name="deduction_amount" step="0.01" type="number" /></label><label>Settlement<select name="settlement_status" required><option value="">Select</option><option value="paid">Paid</option><option value="waived">Waived</option></select></label><label>Payment date<input name="payment_date" type="date" /></label><label>UTR / reference<input name="payment_reference" /></label></div>}<SubmitButton confirmMessage="This reconciles final settlement and deactivates access. Workforce amounts must match an existing Finance-paid payroll; no new payment is sent." confirmTitle="Complete settlement?">Reconcile & deactivate</SubmitButton></form> : null}
        {item.review_remarks ? <p className="subtle">Review: {item.review_remarks}</p> : null}
      </article>; }) : <div className="card workforce-empty"><BadgeCheck /><h2>No exit cases</h2><p>Resignation and termination cases will be tracked here through settlement and deactivation.</p></div>}
    </section> : null}
  </AppShell>;
}
