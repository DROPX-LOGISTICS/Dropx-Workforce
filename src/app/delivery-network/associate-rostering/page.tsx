import { assignWorkforceShift } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { isWorkforceDate } from "@/lib/workforce-earnings";
import { readAllRows } from "@/lib/supabase-pagination";
import { Cable, CalendarDays, Route, UsersRound } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type Shift = { code?: string | null; name?: string | null; start_time?: string | null; end_time?: string | null };
type Assignment = { id: string; workforce_id: string | null; effective_from: string; effective_to: string | null; notes: string | null; hr_shifts?: Shift | Shift[] | null };
type Associate = { id: string; dropx_id: string | null; full_name: string; designation: string | null; location_id: string | null; stations?: { station_code?: string | null } | Array<{ station_code?: string | null }> | null };

function relation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function indiaDay() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function time(value: string | null | undefined) {
  return value ? value.slice(0, 5) : "—";
}

export default async function AssociateRosteringPage({ searchParams }: { searchParams?: { date?: string; notice?: string; error?: string } }) {
  const authorization = await requirePagePermission("workforce_activity", "access");
  const companyId = requireCompanyId(authorization);
  const today = isWorkforceDate(searchParams?.date) ? searchParams.date : indiaDay();
  const canEdit = authorization.permissions.workforce_activity.canEdit && !authorization.readOnly;
  let shifts: Array<{ id: string; code: string; name: string }> = [];
  let associates: Associate[] = [];
  let assignments: Assignment[] = [];
  let error: string | null = null;

  if (!supabaseAdmin) {
    error = "Supabase service role key is not configured.";
  } else {
    let associateQuery = supabaseAdmin.from("workforce")
      .select("id,dropx_id,full_name,designation,location_id,stations(station_code)")
      .eq("company_id", companyId)
      .eq("is_active", true).eq("onboarding_status", "active")
      .is("deleted_at", null).neq("migration_state", "reclassified")
      .order("full_name");
    if (!authorization.hasAllLocationAccess) {
      associateQuery = associateQuery.in("location_id", authorization.locationScopeIds.length
        ? authorization.locationScopeIds
        : ["00000000-0000-0000-0000-000000000000"]);
    }
    const [associateResult, assignmentResult, shiftResult] = await Promise.all([
      readAllRows(associateQuery.order("id")),
      supabaseAdmin.from("hr_contractor_shift_assignments")
        .select("id,workforce_id,effective_from,effective_to,notes,hr_shifts(code,name,start_time,end_time)")
        .eq("company_id", companyId)
        .lte("effective_from", today)
        .or(`effective_to.is.null,effective_to.gte.${today}`)
        .order("effective_from", { ascending: false }),
      supabaseAdmin.from("hr_shifts").select("id,code,name").eq("company_id", companyId).eq("is_active", true).order("name")
    ]);
    error = associateResult.error?.message ?? assignmentResult.error?.message ?? null;
    shifts = shiftResult.data ?? [];
    error = error ?? shiftResult.error?.message ?? null;
    associates = (associateResult.data ?? []) as Associate[];
    assignments = (assignmentResult.data ?? []) as Assignment[];
  }

  const assignmentByAssociate = new Map<string, Assignment>();
  for (const assignment of assignments) {
    if (assignment.workforce_id && !assignmentByAssociate.has(assignment.workforce_id)) {
      assignmentByAssociate.set(assignment.workforce_id, assignment);
    }
  }
  const rostered = associates.filter((associate) => assignmentByAssociate.has(associate.id));
  const unrostered = associates.length - rostered.length;

  return (
    <AppShell active="Associate Rostering" pageCode="workforce_activity">
      <PageHead
        eyebrow="Workforce operations"
        title="Associate Rostering"
        subtitle="The Workforce-owned roster for associates. Plan shifts for activated associates and review staffing on any date."
        action={<span className="status-pill neutral">DropX Workforce source</span>}
      />

      {searchParams?.notice || searchParams?.error ? <section className={`panel message-panel ${searchParams.error ? "error" : "success"}`}><div className="panel-body">{searchParams.error ?? searchParams.notice}</div></section> : null}
      <form className="wf-range-bar" method="get"><label>Roster date<input name="date" type="date" defaultValue={today} required /></label><button type="submit">View roster</button></form>
      {error ? <section className="panel message-panel error"><div className="panel-body"><strong>Roster source unavailable</strong><p className="subtle" style={{ marginTop: 6 }}>{error}</p></div></section> : null}

      <section className="performance-summary-grid">
        <article><span><UsersRound size={18} /> Active associates</span><strong>{associates.length}</strong><small>Canonical Workforce profiles</small></article>
        <article><span><CalendarDays size={18} /> Rostered on selected date</span><strong>{rostered.length}</strong><small>Active shift assignments</small></article>
        <article><span><Route size={18} /> Awaiting assignment</span><strong>{unrostered}</strong><small>Ready for future route allocation</small></article>
        <article><span><CalendarDays size={18} /> Available shifts</span><strong>{shifts.length}</strong><small>Active company shift definitions</small></article>
      </section>

      {canEdit && !error ? <section className="wf-finance-panel"><header><div><h2>Assign a shift</h2><p>Choose an associate and a period up to 93 days. Conflicting assignments are blocked.</p></div></header><form action={assignWorkforceShift} className="wf-finance-form">
        <label>Associate<select name="workforce_id" required><option value="">Choose associate</option>{associates.map((person) => <option key={person.id} value={person.id}>{person.dropx_id} · {person.full_name}</option>)}</select></label>
        <label>Shift<select name="shift_id" required><option value="">Choose shift</option>{shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.code} · {shift.name}</option>)}</select></label>
        <label>From<input name="effective_from" type="date" required defaultValue={today} /></label><label>Through<input name="effective_to" type="date" required defaultValue={today} /></label>
        <label>Notes<input name="notes" maxLength={500} placeholder="Coverage or scheduling notes" /></label><SubmitButton pendingText="Assigning">Assign shift</SubmitButton>
      </form></section> : null}
      <section className="panel">
        <div className="panel-head"><div><h2>Current associate roster</h2><p className="subtle">Effective on {today}. Only canonical Workforce assignments appear here.</p></div></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Associate</th><th>Designation</th><th>Station</th><th>Shift</th><th>Time</th><th>Effective period</th><th>Status</th></tr></thead>
          <tbody>{associates.map((associate) => {
            const assignment = assignmentByAssociate.get(associate.id);
            const shift = relation(assignment?.hr_shifts);
            const station = relation(associate.stations);
            return <tr key={associate.id}>
              <td><strong>{associate.full_name}</strong><small>{associate.dropx_id || "ID pending"}</small></td>
              <td>{associate.designation || "—"}</td>
              <td>{station?.station_code || "—"}</td>
              <td>{shift?.name || shift?.code || "Not assigned"}</td>
              <td>{assignment ? `${time(shift?.start_time)} – ${time(shift?.end_time)}` : "—"}</td>
              <td>{assignment ? `${assignment.effective_from} – ${assignment.effective_to || "ongoing"}` : "—"}</td>
              <td><span className={`status-pill ${assignment ? "good" : "warn"}`}>{assignment ? "Rostered" : "Unassigned"}</span></td>
            </tr>;
          })}{!associates.length ? <tr><td className="empty-cell" colSpan={7}>No active Workforce associates are available.</td></tr> : null}</tbody>
        </table></div>
      </section>
    </AppShell>
  );
}
