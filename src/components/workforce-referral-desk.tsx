import { BadgeIndianRupee, ExternalLink, PencilLine, UserRoundPlus } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { PendingLink } from "@/components/pending-link";
import { reviewReferral, saveReferralProgram, setReferralProgramStatus, updateReferralCandidate } from "@/app/delivery-network/referrals/actions";

type Program = { id: string; name: string; station_id: string | null; reward_amount: number | string; qualification_source: string; qualifying_days: number; effective_from: string; effective_to: string | null; terms: string; is_active: boolean };
type Related<T> = T | T[] | null;
type Adjustment = { status: string; payroll_run_id: string | null };
type Referral = { id: string; referred_full_name: string; referred_country_code: string; referred_mobile: string; preferred_station_id: string | null; status: string; qualification_progress: number; qualifying_days_snapshot: number; reward_amount_snapshot: number | string; qualification_source_snapshot: string; submitted_at: string; qualified_at: string | null; approved_at: string | null; paid_at: string | null; decision_remarks: string | null; adjustment_id: string | null; adjustment: Related<Adjustment>; referrer: Related<{ full_name: string; dropx_id: string | null }>; station: Related<{ station_code: string; station_name: string | null }> };
type Source = { code: string; name: string; description: string | null };
type Station = { id: string; station_code: string; station_name: string | null };

const first = <T,>(value: Related<T>) => Array.isArray(value) ? value[0] ?? null : value;
const money = (value: number | string) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value));
const words = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const date = (value: string | null) => value ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)) : "—";

function inviteHref(row: Referral) {
  const query = new URLSearchParams({
    full_name: row.referred_full_name,
    mobile_country_code: row.referred_country_code,
    mobile: row.referred_mobile,
  });
  if (row.preferred_station_id) query.set("location_id", row.preferred_station_id);
  return `/delivery-network/onboarding/associates?${query}`;
}

function Journey({ row }: { row: Referral }) {
  const adjustment = first(row.adjustment);
  const steps = [
    ["Referred", true],
    ["Onboarded", row.status !== "submitted" && row.status !== "rejected" && row.status !== "cancelled"],
    ["Qualified", Boolean(row.qualified_at || ["qualified", "approved", "paid"].includes(row.status))],
    ["Bonus approved", Boolean(row.approved_at || ["approved", "paid"].includes(row.status))],
    ["In payroll", Boolean(adjustment?.payroll_run_id)],
    ["Paid", row.status === "paid"],
  ] as const;
  return <div className="wf-referral-journey" aria-label={`Referral journey for ${row.referred_full_name}`}>{steps.map(([label, done], index) => <span className={done ? "done" : ""} key={label}><i>{done ? "✓" : index + 1}</i>{label}</span>)}</div>;
}

function ReferralProgramMaster({ programs, stations, sources, canEdit }: { programs: Program[]; stations: Station[]; sources: Source[]; canEdit: boolean }) {
  const sourceName = new Map(sources.map((source) => [source.code, source.name]));
  return <section className="panel wf-referral-programs">
    <div className="panel-head"><div><h2>Referral program rules</h2><p className="subtle">Configure reward, evidence and qualifying days by location. Each referral keeps the rule captured when it was submitted.</p></div><PendingLink href="/delivery-network/designations">Eligible roles</PendingLink></div>
    {canEdit ? <form action={saveReferralProgram} className="panel-body form-grid four">
      <label>Program name<input className="field" name="name" placeholder="Delivery referral" required /></label>
      <label>Location<select className="field" name="station_id"><option value="">All locations</option>{stations.map((station) => <option key={station.id} value={station.id}>{station.station_code} · {station.station_name}</option>)}</select></label>
      <label>Bonus amount<input className="field" name="reward_amount" min="1" step="0.01" type="number" required /></label>
      <label>Qualifying days<input className="field" name="qualifying_days" min="1" max="365" type="number" required /></label>
      <label>Evidence source<select className="field" name="qualification_source" required><option value="">Choose source</option>{sources.map((source) => <option key={source.code} value={source.code}>{source.name}</option>)}</select></label>
      <label>Effective from<input className="field" name="effective_from" type="date" required /></label>
      <label>Effective to · optional<input className="field" name="effective_to" type="date" /></label>
      <label className="checkbox-row"><input name="is_active" type="checkbox" defaultChecked />Active</label>
      <label className="wide">Terms shown in DropX One<textarea className="field" name="terms" minLength={5} maxLength={2000} placeholder="Who qualifies, when the bonus is paid, and exclusions" required /></label>
      <SubmitButton pendingText="Saving">Save program</SubmitButton>
    </form> : null}
    {programs.length ? <div className="table-wrap"><table><thead><tr><th>Program</th><th>Location</th><th>Bonus</th><th>Qualification</th><th>Effective period</th><th>Status</th>{canEdit ? <th>Action</th> : null}</tr></thead><tbody>{programs.map((program) => <tr key={program.id}><td><strong>{program.name}</strong><small>{program.terms}</small></td><td>{program.station_id ? stations.find((station) => station.id === program.station_id)?.station_code : "All locations"}</td><td>{money(program.reward_amount)}</td><td>{program.qualifying_days} days · {sourceName.get(program.qualification_source) || words(program.qualification_source)}</td><td>{program.effective_from} → {program.effective_to || "Ongoing"}</td><td><span className={`wf-referral-state ${program.is_active ? "active" : "paused"}`}>{program.is_active ? "Active" : "Paused"}</span></td>{canEdit ? <td><form action={setReferralProgramStatus}><input name="id" type="hidden" value={program.id} /><input name="is_active" type="hidden" value={program.is_active ? "false" : "true"} /><SubmitButton className="button secondary compact" pendingText="Saving">{program.is_active ? "Pause" : "Resume"}</SubmitButton></form></td> : null}</tr>)}</tbody></table></div> : <div className="empty-cell">No referral rule is configured. Add the first location rule above.</div>}
  </section>;
}

export function WorkforceReferralDesk({ area, programs, referrals, stations, sources, canEdit }: { area: "candidates" | "programs"; programs: Program[]; referrals: Referral[]; stations: Station[]; sources: Source[]; canEdit: boolean }) {
  if (area === "programs") return <ReferralProgramMaster programs={programs} stations={stations} sources={sources} canEdit={canEdit} />;

  const sourceName = new Map(sources.map((source) => [source.code, source.name]));
  const summary = [
    ["New referrals", referrals.filter((row) => row.status === "submitted").length, "Ready for onboarding"],
    ["Qualifying", referrals.filter((row) => row.status === "linked").length, "Attendance or delivery days running"],
    ["Bonus approval", referrals.filter((row) => row.status === "qualified").length, "Rule completed"],
    ["Payroll & paid", referrals.filter((row) => ["approved", "paid"].includes(row.status)).length, `${referrals.filter((row) => row.status === "paid").length} paid`],
  ] as const;

  return <div className="workforce-referral-desk">
    <section className="wf-referral-summary" aria-label="Referral summary">{summary.map(([label, value, detail]) => <article key={label}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>)}</section>
    <section className="panel wf-referral-register">
      <div className="panel-head"><div><h2>Referral register</h2><p className="subtle">One journey from DropX One submission to associate onboarding, rule qualification, bonus approval and payment.</p></div></div>
      <div className="wf-referral-list">{referrals.map((row) => {
        const referrer = first(row.referrer), station = first(row.station), adjustment = first(row.adjustment);
        return <article key={row.id} className="wf-referral-card">
          <header><div><strong>{row.referred_full_name}</strong><small>+{row.referred_country_code} {row.referred_mobile} · {station?.station_code || "Location pending"}</small></div><span className={`wf-referral-state ${row.status}`}>{words(row.status)}</span></header>
          <Journey row={row} />
          <dl>
            <div><dt>Referred by</dt><dd>{referrer?.full_name || "—"}<small>{referrer?.dropx_id}</small></dd></div>
            <div><dt>Rule progress</dt><dd>{row.qualification_progress}/{row.qualifying_days_snapshot} days<small>{sourceName.get(row.qualification_source_snapshot) || words(row.qualification_source_snapshot)}</small></dd></div>
            <div><dt>Referral bonus</dt><dd>{money(row.reward_amount_snapshot)}<small>{adjustment ? `Bonus approval: ${words(adjustment.status)}` : "Not sent for approval"}</small></dd></div>
            <div><dt>Submitted</dt><dd>{date(row.submitted_at)}<small>{row.paid_at ? `Paid ${date(row.paid_at)}` : row.decision_remarks || "Auditable journey"}</small></dd></div>
          </dl>
          {canEdit && row.status === "submitted" ? <details className="wf-referral-edit"><summary><PencilLine size={13} /> Update candidate details</summary><form action={updateReferralCandidate} className="form-grid four"><input name="id" type="hidden" value={row.id} /><label>Full name<input className="field" name="referred_full_name" defaultValue={row.referred_full_name} required /></label><label>Country code<input className="field" name="referred_country_code" defaultValue={row.referred_country_code} inputMode="numeric" required /></label><label>Mobile<input className="field" name="referred_mobile" defaultValue={row.referred_mobile} inputMode="numeric" required /></label><label>Preferred location<select className="field" name="preferred_station_id" defaultValue={row.preferred_station_id || ""}><option value="">Not selected</option>{stations.map((item) => <option key={item.id} value={item.id}>{item.station_code} · {item.station_name}</option>)}</select></label><SubmitButton className="button compact" pendingText="Saving">Save details</SubmitButton></form></details> : null}
          <div className="wf-referral-actions">
            {row.status === "submitted" ? <PendingLink className="button compact" href={inviteHref(row)}><UserRoundPlus size={14} /> Onboard candidate</PendingLink> : null}
            {canEdit && !["paid", "rejected", "cancelled"].includes(row.status) ? <form action={reviewReferral} className="wf-referral-review"><input name="id" type="hidden" value={row.id} /><input aria-label="Review remarks" name="remarks" placeholder="Decision note" /><SubmitButton className="button secondary compact" name="decision" pendingText="Refreshing" value="refresh">Refresh progress</SubmitButton>{row.status === "qualified" ? <SubmitButton className="button compact" name="decision" pendingText="Sending" value="approve"><BadgeIndianRupee size={14} /> Approve bonus</SubmitButton> : null}<SubmitButton className="button danger compact" name="decision" pendingText="Rejecting" value="reject">Reject</SubmitButton></form> : null}
            {row.status === "approved" ? <PendingLink className="button secondary compact" href="/delivery-network/adjustments"><ExternalLink size={14} /> Bonus approval</PendingLink> : null}
          </div>
        </article>;
      })}{!referrals.length ? <div className="empty-cell">No referred candidates yet. DropX One submissions will appear here when a location program is active.</div> : null}</div>
    </section>
  </div>;
}
