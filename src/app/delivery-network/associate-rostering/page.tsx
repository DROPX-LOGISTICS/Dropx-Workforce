import { saveWorkforceOperatingSchedule } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { isWorkforceDate } from "@/lib/workforce-earnings";
import { readAllRows } from "@/lib/supabase-pagination";
import { Cable, CalendarDays, Route, UsersRound } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { workforceClassification } from "@/lib/workforce-classification";
import { SearchableSelect } from "@/components/searchable-select";

export const dynamic = "force-dynamic";

type Assignment = { id: string; workforce_id: string | null; operating_pincode: string; weekly_off_day: number; effective_from: string; effective_to: string | null; notes: string | null };
type Associate = { id: string; dropx_id: string | null; full_name: string; designation: string | null; designation_id:string|null; location_id: string | null; stations?: { station_code?: string | null } | Array<{ station_code?: string | null }> | null };

function relation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function indiaDay() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

const dayName = (day: number) => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day] ?? "—";

export default async function AssociateRosteringPage({ searchParams }: { searchParams?: { date?: string; notice?: string; error?: string } }) {
  const authorization = await requirePagePermission("workforce_activity", "access");
  const companyId = requireCompanyId(authorization);
  const today = isWorkforceDate(searchParams?.date) ? searchParams.date : indiaDay();
  const canEdit = authorization.permissions.workforce_activity.canEdit && !authorization.readOnly;
  let associates: Associate[] = [];
  let assignments: Assignment[] = [];
  let history: {id:string;workforce_id:string;actor_id:string;created_at:string;replaced_schedule_id:string|null;after_snapshot:{operating_pincode:string;weekly_off_day:number;effective_from:string;effective_to:string|null;notes:string|null}}[] = [];
  const actorNames=new Map<string,string>();
  let error: string | null = null;

  if (!supabaseAdmin) {
    error = "Supabase service role key is not configured.";
  } else {
    let associateQuery = supabaseAdmin.from("workforce")
      .select("id,dropx_id,full_name,designation,designation_id,location_id,stations(station_code)")
      .eq("company_id", companyId)
      .eq("is_active", true).eq("onboarding_status", "active")
      .is("deleted_at", null).neq("migration_state", "reclassified")
      .order("full_name");
    if (!authorization.hasAllLocationAccess) {
      associateQuery = associateQuery.in("location_id", authorization.locationScopeIds.length
        ? authorization.locationScopeIds
        : ["00000000-0000-0000-0000-000000000000"]);
    }
    const [associateResult, assignmentResult, eligible] = await Promise.all([
      readAllRows(associateQuery.order("id")),
      readAllRows(supabaseAdmin.from("workforce_operating_schedules")
        .select("id,workforce_id,operating_pincode,weekly_off_day,effective_from,effective_to,notes")
        .eq("company_id", companyId)
        .lte("effective_from", today)
        .or(`effective_to.is.null,effective_to.gte.${today}`)
        .order("effective_from", { ascending: false }).order("id")),
      workforceClassification(companyId)
    ]);
    error = associateResult.error?.message ?? assignmentResult.error?.message ?? null;
    associates = ((associateResult.data ?? []) as Associate[]).filter(eligible);
    assignments = (assignmentResult.data ?? []) as Assignment[];
    const visibleIds=new Set(associates.map(person=>person.id));
    const events=await readAllRows(supabaseAdmin.from('workforce_operating_schedule_events').select('id,workforce_id,actor_id,created_at,replaced_schedule_id,after_snapshot').eq('company_id',companyId).order('created_at',{ascending:false}).order('id'));
    if(events.error)error=events.error.message;
    history=(events.data??[]).filter(row=>visibleIds.has(row.workforce_id)).slice(0,100) as typeof history;
    const actors=[...new Set(history.map(row=>row.actor_id))];
    if(actors.length){const names=await supabaseAdmin.from('profiles').select('id,full_name').eq('company_id',companyId).in('id',actors);for(const person of names.data??[])actorNames.set(person.id,person.full_name||'Authorised operator');}
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
        subtitle="Configure each Delivery Associate’s operating pincode and weekly off. DropX One reads this Workforce-owned schedule automatically."
        action={<span className="status-pill neutral">DropX Workforce source</span>}
      />

      {searchParams?.notice || searchParams?.error ? <section className={`panel message-panel ${searchParams.error ? "error" : "success"}`}><div className="panel-body">{searchParams.error ?? searchParams.notice}</div></section> : null}
      <form className="wf-range-bar" method="get"><label>Roster date<input name="date" type="date" defaultValue={today} required /></label><button type="submit">View roster</button></form>
      {error ? <section className="panel message-panel error"><div className="panel-body"><strong>Roster source unavailable</strong><p className="subtle" style={{ marginTop: 6 }}>{error}</p></div></section> : null}

      <section className="performance-summary-grid">
        <article><span><UsersRound size={18} /> Active associates</span><strong>{associates.length}</strong><small>Canonical Workforce profiles</small></article>
        <article><span><CalendarDays size={18} /> Schedules configured</span><strong>{rostered.length}</strong><small>Operating area and weekly off set</small></article>
        <article><span><Route size={18} /> Awaiting configuration</span><strong>{unrostered}</strong><small>Need pincode and weekly off</small></article>
        <article><span><CalendarDays size={18} /> Schedule source</span><strong>Workforce</strong><small>Synced to DropX One</small></article>
      </section>

      {canEdit && !error ? <section className="wf-finance-panel"><header><div><h2>Configure operating schedule</h2><p>Set the service pincode and the regular weekly off. Delivery Associates do not use clock shifts.</p></div></header><form action={saveWorkforceOperatingSchedule} className="wf-finance-form">
<label>Associate / DropX ID<SearchableSelect name="workforce_id" required placeholder="Search name, ID or station" options={associates.map(person=>({value:person.id,label:`${person.dropx_id||'ID pending'} · ${person.full_name}`,helper:relation(person.stations)?.station_code??undefined}))}/></label>
        <label>Operating pincode<input name="operating_pincode" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="524101" required /></label>
        <label>Weekly off<select name="weekly_off_day" required>{[0,1,2,3,4,5,6].map(day => <option key={day} value={day}>{dayName(day)}</option>)}</select></label>
        <label>From<input name="effective_from" type="date" required defaultValue={today} /></label><label>Through (optional)<input name="effective_to" type="date" /></label>
        <label>Replace an existing schedule (optional)<SearchableSelect name="replaces" placeholder="New schedule, or search current associate" options={associates.flatMap(person=>{const existing=assignmentByAssociate.get(person.id);return existing?[{value:existing.id,label:`${person.dropx_id||'ID pending'} · ${person.full_name}`,helper:`${existing.operating_pincode} · ${dayName(existing.weekly_off_day)} · from ${existing.effective_from}`}]:[];})}/><small>Select only when changing this associate’s schedule. The old version ends the day before the new one starts; past days cannot be replaced.</small></label>
        <label>Notes / reason for change<input name="notes" maxLength={500} placeholder="Required when replacing a schedule" /></label><SubmitButton pendingText="Saving" confirmTitle="Save operating schedule?" confirmMessage="The selected pincode and weekly off will appear in the associate’s DropX One account from the effective date. A replacement preserves earlier days.">Save schedule</SubmitButton>
      </form></section> : null}
      <section className="panel">
        <div className="panel-head"><div><h2>Current operating schedules</h2><p className="subtle">Effective on {today}. These schedules are shown to associates in DropX One.</p></div></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Associate</th><th>Designation</th><th>Station</th><th>Operating pincode</th><th>Weekly off</th><th>Effective period</th><th>Status</th></tr></thead>
          <tbody>{associates.map((associate) => {
            const assignment = assignmentByAssociate.get(associate.id);
            const station = relation(associate.stations);
            return <tr key={associate.id}>
              <td><strong>{associate.full_name}</strong><small>{associate.dropx_id || "ID pending"}</small></td>
              <td>{associate.designation || "—"}</td>
              <td>{station?.station_code || "—"}</td>
              <td>{assignment?.operating_pincode || "Not assigned"}</td>
              <td>{assignment ? dayName(assignment.weekly_off_day) : "—"}</td>
              <td>{assignment ? `${assignment.effective_from} – ${assignment.effective_to || "ongoing"}` : "—"}</td>
              <td><span className={`status-pill ${assignment ? "good" : "warn"}`}>{assignment ? "Rostered" : "Unassigned"}</span></td>
            </tr>;
          })}{!associates.length ? <tr><td className="empty-cell" colSpan={7}>No active Workforce associates are available.</td></tr> : null}</tbody>
        </table></div>
      </section>
      <section className="panel"><div className="panel-head"><div><h2>Schedule change history</h2><p className="subtle">Latest 100 changes in your visible associate scope. Earlier operating days remain in the version history.</p></div></div><div className="table-wrap"><table><thead><tr><th>Associate</th><th>Action</th><th>Effective schedule</th><th>Changed by · IST</th><th>Reason</th></tr></thead><tbody>{history.map(event=><tr key={event.id}><td>{associates.find(person=>person.id===event.workforce_id)?.full_name}</td><td>{event.replaced_schedule_id?'Dated replacement':'Created'}</td><td>{event.after_snapshot.operating_pincode} · {dayName(event.after_snapshot.weekly_off_day)} off<br/>{event.after_snapshot.effective_from} – {event.after_snapshot.effective_to||'ongoing'}</td><td>{actorNames.get(event.actor_id)||'Authorised operator'}<br/>{new Date(event.created_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}</td><td>{event.after_snapshot.notes||'—'}</td></tr>)}{!history.length?<tr><td colSpan={5}>{error?'History unavailable.':'No changes recorded by the versioned schedule workflow yet. Earlier schedules remain visible above.'}</td></tr>:null}</tbody></table></div></section>
    </AppShell>
  );
}
