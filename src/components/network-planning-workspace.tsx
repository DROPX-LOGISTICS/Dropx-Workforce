import type { NetworkPlanningData, NetworkRoute } from "@/lib/ops-pulse/network-planning";
import { planningWeekDays, routePlanShareText } from "@/lib/ops-pulse/network-planning";
import {
  applyWeeklyRosterTemplate,
  assignFieldExecutive,
  createRoutePlan,
  delegateSectorPlanning,
  markAbsenceAndReplace,
  removeRosterAssignment,
  reportVehicleIncident,
  saveBackupPoolMember,
  saveWeeklyRosterTemplate,
  updateRouteStatus
} from "@/app/ops-pulse/service-network/actions";
import styles from "./network-planning-workspace.module.css";

type View = "control" | "routes" | "roster";

type Props = {
  data: NetworkPlanningData;
  stationId: string;
  stationCode: string;
  client: string;
  from: string;
  to: string;
  week: string;
  selectedDate: string;
  view: View;
  canEdit: boolean;
};

function formatDate(value: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", ...(options ?? {}) }).format(new Date(`${value}T12:00:00+05:30`));
}

function fmt(value: number, digits = 0) {
  return value.toLocaleString("en-IN", { maximumFractionDigits: digits });
}

function Context({ props, nextView }: { props: Props; nextView?: View }) {
  return <>
    <input type="hidden" name="station" value={props.stationCode}/>
    <input type="hidden" name="station_id" value={props.stationId}/>
    <input type="hidden" name="client" value={props.client}/>
    <input type="hidden" name="from" value={props.from}/>
    <input type="hidden" name="to" value={props.to}/>
    <input type="hidden" name="week" value={props.week}/>
    <input type="hidden" name="date" value={props.selectedDate}/>
    <input type="hidden" name="view" value={nextView ?? props.view}/>
  </>;
}

function viewHref(props: Props, view: View, date = props.selectedDate) {
  const query = new URLSearchParams({ station: props.stationCode, client: props.client, from: props.from, to: props.to, week: props.week, date, view });
  return `/ops-pulse/service-network?${query}`;
}

function signalLabel(route: NetworkRoute) {
  if (route.signal === "unassigned") return "Unassigned";
  if (route.signal === "overloaded") return "Overloaded";
  if (route.signal === "absence") return "Absence";
  return "Covered";
}

function RouteCard({ route, props }: { route: NetworkRoute; props: Props }) {
  const available = props.data.fieldExecutives;
  return <article className={`${styles.routeCard} ${styles[route.signal]}`}>
    <header>
      <div><span className={styles.sectorDot} style={{ background: route.sectorColor }}/><strong>{route.routeCode}</strong><small>{route.routeName} · {route.sectorName}</small></div>
      <span className={styles.signal}>{signalLabel(route)}</span>
    </header>
    <div className={styles.routeFacts}>
      <span><small>Pincodes</small><strong>{route.pincodes.join(", ") || "Not assigned"}</strong></span>
      <span><small>Expected volume</small><strong>{fmt(route.expectedVolume)}</strong></span>
      <span><small>Vehicle</small><strong>{route.vehicleType}</strong></span>
      <span><small>HC plan / actual</small><strong>{route.plannedHeadcount} / {route.actualHeadcount}</strong></span>
      <span><small>Required HC</small><strong>{route.requiredHeadcount ?? "SPR pending"}</strong></span>
      <span><small>Load / FE</small><strong>{route.loadPerFE == null ? "—" : fmt(route.loadPerFE, 1)}</strong></span>
    </div>
    <div className={styles.rosterChips}>
      {route.roster.filter(entry => entry.rosterStatus !== "released").map(entry => <div key={entry.id} className={entry.rosterStatus === "absent" || entry.attendanceStatus && !["P", "PRESENT", "HLF"].includes(entry.attendanceStatus.toUpperCase()) ? styles.absentChip : ""}>
        {entry.fieldExecutiveName} · {entry.vehicleType ?? "vehicle?"}{entry.isCrossSector ? " · cross-sector" : ""}{entry.attendanceStatus ? ` · ${entry.attendanceStatus}` : ""}
        {props.canEdit && entry.rosterStatus !== "absent" ? <form action={markAbsenceAndReplace}>
          <Context props={props}/><input type="hidden" name="route_plan_id" value={route.id}/><input type="hidden" name="assignment_id" value={entry.id}/><input type="hidden" name="auto_replace" value="true"/><button title="Record absence and auto-replace">Absent</button>
        </form> : null}
        {props.canEdit ? <form action={removeRosterAssignment}>
          <Context props={props}/><input type="hidden" name="route_plan_id" value={route.id}/><input type="hidden" name="assignment_id" value={entry.id}/><button title="Release from route">×</button>
        </form> : null}
      </div>)}
      {!route.roster.filter(entry => entry.rosterStatus !== "released").length ? <em>No FE allocated</em> : null}
    </div>
    {props.canEdit ? <div className={styles.quickActions}>
      <form action={assignFieldExecutive}>
        <Context props={props}/><input type="hidden" name="route_plan_id" value={route.id}/>
        <select name="field_executive_id" required defaultValue=""><option value="" disabled>Choose FE</option>{available.map(fe => <option key={fe.id} value={fe.id}>{fe.name} · {fe.vehicleType ?? "vehicle not set"}</option>)}</select>
        <select name="replace_assignment_id" defaultValue=""><option value="">Add to route</option>{route.roster.filter(item => !["released", "absent"].includes(item.rosterStatus)).map(item => <option key={item.id} value={item.id}>Replace {item.fieldExecutiveName}</option>)}</select>
        <label className={styles.check}><input type="checkbox" name="manual_override"/> Override</label>
        <button className="button compact">Allocate</button>
      </form>
      <form action={updateRouteStatus}>
        <Context props={props}/><input type="hidden" name="route_plan_id" value={route.id}/>
        <select name="status" defaultValue={route.status}><option value="draft">Draft</option><option value="published">Published</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select>
        <button className="button secondary compact">Update</button>
      </form>
    </div> : null}
  </article>;
}

export function NetworkPlanningWorkspace(props: Props) {
  const days = planningWeekDays(props.week);
  const routesForDay = props.data.routes.filter(route => route.planDate === props.selectedDate && route.status !== "cancelled");
  const shareText = routePlanShareText(props.stationCode, props.selectedDate, props.data.routes);
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
  const qs = new URLSearchParams({ station: props.stationCode, date: props.selectedDate });

  if (!props.data.schemaReady) return <section className="panel"><div className="panel-head"><div><h2>Network Planning</h2><p className="subtle">The existing Service Network is ready to be upgraded in place.</p></div></div><div className="panel-body"><div className="alert warn"><strong>One-time database setup required</strong><span>{props.data.error}</span></div></div></section>;

  return <section className={styles.workspace}>
    <div className={styles.heading}>
      <div><span>Station operations</span><h2>Network Planning</h2><p>Sectors, routes, FE rostering and same-day recovery for {props.stationCode}.</p></div>
      <div className={styles.shareActions}><a className="button secondary compact" href={`/ops-pulse/service-network/share?${qs}`} target="_blank" rel="noreferrer">Share view</a><a className="button compact" href={whatsapp} target="_blank" rel="noreferrer">WhatsApp plan</a></div>
    </div>

    {props.data.error ? <div className="message-panel error">{props.data.error}</div> : null}
    <div className={styles.dateBar}>
      <div className={styles.days}>{days.map(day => <a key={day} className={day === props.selectedDate ? styles.activeDay : ""} href={viewHref(props, props.view, day)}><small>{new Intl.DateTimeFormat("en-IN", { weekday: "short", timeZone: "Asia/Kolkata" }).format(new Date(`${day}T12:00:00+05:30`))}</small><strong>{formatDate(day)}</strong></a>)}</div>
      <form method="get"><input type="hidden" name="station" value={props.stationCode}/><input type="hidden" name="client" value={props.client}/><input type="hidden" name="from" value={props.from}/><input type="hidden" name="to" value={props.to}/><input type="hidden" name="view" value={props.view}/><label>Week of<input type="date" name="week" defaultValue={props.week}/></label><button className="button secondary compact">Go</button></form>
    </div>

    <div className={styles.tabs} role="navigation" aria-label="Network planning views">
      <a className={props.view === "control" ? styles.activeTab : ""} href={viewHref(props, "control")}>Control Tower</a>
      <a className={props.view === "routes" ? styles.activeTab : ""} href={viewHref(props, "routes")}>Route Plan</a>
      <a className={props.view === "roster" ? styles.activeTab : ""} href={viewHref(props, "roster")}>FE Roster</a>
    </div>

    <div className={styles.metrics}>
      <article><span>Sector volume</span><strong>{fmt(props.data.summary.expectedVolume)}</strong><small>{formatDate(props.selectedDate)}</small></article>
      <article><span>HC planned / actual</span><strong>{props.data.summary.plannedHeadcount} / {props.data.summary.actualHeadcount}</strong><small>{props.data.attendanceLinked ? "Linked with attendance" : "Roster status; attendance pending"}</small></article>
      <article><span>FE utilization</span><strong>{fmt(props.data.summary.feUtilizationPercent, 1)}%</strong><small>{props.data.fieldExecutives.length} active at station</small></article>
      <article className={props.data.summary.coverageGaps ? styles.dangerMetric : ""}><span>Coverage gaps</span><strong>{props.data.summary.coverageGaps}</strong><small>{props.data.summary.unassignedRoutes} unassigned · {props.data.summary.overloadedRoutes} overloaded</small></article>
      <article className={props.data.summary.absentExecutives ? styles.dangerMetric : ""}><span>Absenteeism</span><strong>{props.data.summary.absentExecutives}</strong><small>{props.data.backupPool.length} FE in backup pool</small></article>
    </div>

    {props.view === "control" ? <>
      <div className={styles.controlGrid}>
        <section className="panel"><div className="panel-head"><div><h3>Operational exceptions</h3><p className="subtle">Priority actions for the selected day.</p></div><span className="count-badge">{props.data.summary.coverageGaps + props.data.incidents.filter(item => item.status === "open").length}</span></div><div className={styles.alertList}>
          {routesForDay.filter(route => route.signal !== "covered").map(route => <a key={route.id} href={viewHref(props, "routes")}><span className={styles.alertIcon}>!</span><div><strong>{route.routeCode} · {signalLabel(route)}</strong><small>{route.sectorName} · {fmt(route.expectedVolume)} volume · {route.plannedHeadcount} planned FE</small></div></a>)}
          {props.data.incidents.filter(item => item.incidentDate === props.selectedDate && item.status === "open").map(item => <div key={item.id}><span className={styles.alertIcon}>!</span><div><strong>{item.vehicleType} {item.incidentType}</strong><small>{item.details || "Replacement action required"}</small></div></div>)}
          {!routesForDay.some(route => route.signal !== "covered") && !props.data.incidents.some(item => item.incidentDate === props.selectedDate && item.status === "open") ? <div className={styles.allClear}><strong>All planned routes are covered</strong><small>No unassigned, overloaded or open vehicle exception for this day.</small></div> : null}
        </div></section>
        <section className="panel"><div className="panel-head"><div><h3>Sector ownership</h3><p className="subtle">Who is accountable for daily route readiness.</p></div></div><div className={styles.sectorList}>{props.data.sectors.map(sector => {
          const sectorRoutes = routesForDay.filter(route => route.sectorId === sector.id);
          return <article key={sector.id}><span className={styles.sectorDot} style={{ background: sector.color }}/><div><strong>{sector.code} · {sector.name}</strong><small>{sector.pincodes.map(item => item.pincode).join(", ") || "Pincodes not configured"}</small><small>TL: {sector.tlName || "Unassigned"} · SSA: {sector.ssaName || "Unassigned"}</small></div><span><strong>{fmt(sectorRoutes.reduce((sum, route) => sum + route.expectedVolume, 0))}</strong><small>{sectorRoutes.length} routes</small></span></article>;
        })}{!props.data.sectors.length ? <div className="empty-cell">Create sectors in Network Planning Master.</div> : null}</div></section>
      </div>
      <div className={styles.routeGrid}>{routesForDay.map(route => <RouteCard key={route.id} route={route} props={props}/>)}</div>
    </> : null}

    {props.view === "routes" ? <>
      {props.canEdit ? <details className={styles.formPanel} open={!routesForDay.length}><summary>Add route for {formatDate(props.selectedDate)}</summary><form action={createRoutePlan} className={styles.formGrid}>
        <Context props={props}/><input type="hidden" name="plan_date" value={props.selectedDate}/>
        <label>Sector<select name="sector_id" required defaultValue=""><option value="" disabled>Choose sector</option>{props.data.sectors.map(sector => <option key={sector.id} value={sector.id}>{sector.code} · {sector.name}</option>)}</select></label>
        <label>Route code<input name="route_code" placeholder="N-01" required/></label><label>Route name<input name="route_name" placeholder="North morning route" required/></label>
        <label>Expected volume<input type="number" name="expected_volume" min="0" defaultValue="0" required/></label><label>Vehicle<select name="vehicle_type" defaultValue="bike"><option value="bike">Bike</option><option value="van">Van</option><option value="mixed">Mixed</option></select></label>
        <label>Shift<input name="shift_code" defaultValue="general"/></label><label>Capacity override<input type="number" min="1" name="capacity_override" placeholder="Use FE/SPR capacity"/></label>
        <label className={styles.wide}>Pincodes<input name="pincodes" placeholder="999001, 999002"/></label><label>Start<input type="time" name="planned_start_time"/></label><label>End<input type="time" name="planned_end_time"/></label>
        <label className={styles.wide}>Change reason / exception<input name="change_reason" placeholder="Volume spike, temporary split, merged pincode…"/></label>
        <label className={styles.check}><input type="checkbox" name="is_temporary"/> Temporary route</label><label className={styles.check}><input type="checkbox" name="manual_override"/> Cross-sector/pincode override</label><label className={styles.check}><input type="checkbox" name="publish"/> Publish now</label><button className="button">Add route</button>
      </form></details> : null}
      <div className={styles.routeGrid}>{routesForDay.map(route => <RouteCard key={route.id} route={route} props={props}/>)}{!routesForDay.length ? <div className={styles.empty}>No routes planned for this day.</div> : null}</div>
      {props.canEdit ? <details className={styles.formPanel}><summary>Report vehicle breakdown or capacity exception</summary><form action={reportVehicleIncident} className={styles.formGrid}><Context props={props}/><input type="hidden" name="incident_date" value={props.selectedDate}/>
        <label>Route<select name="route_plan_id" defaultValue=""><option value="">Station-wide</option>{routesForDay.map(route => <option key={route.id} value={route.id}>{route.routeCode}</option>)}</select></label><label>FE<select name="field_executive_id" defaultValue=""><option value="">Not linked</option>{props.data.fieldExecutives.map(fe => <option key={fe.id} value={fe.id}>{fe.name}</option>)}</select></label>
        <label>Vehicle<select name="vehicle_type"><option value="van">Van</option><option value="bike">Bike</option></select></label><label>Exception<select name="incident_type"><option value="breakdown">Breakdown</option><option value="accident">Accident</option><option value="unavailable">Unavailable</option><option value="capacity_restriction">Capacity restriction</option><option value="other">Other</option></select></label><label className={styles.wide}>Details<input name="details" required placeholder="What happened and support required"/></label><button className="button">Raise exception</button>
      </form></details> : null}
    </> : null}

    {props.view === "roster" ? <>
      <div className={styles.weekGrid}>{days.map(day => <article key={day} className={day === props.selectedDate ? styles.selectedDayCard : ""}><header><small>{new Intl.DateTimeFormat("en-IN", { weekday: "short", timeZone: "Asia/Kolkata" }).format(new Date(`${day}T12:00:00+05:30`))}</small><strong>{formatDate(day)}</strong></header>{props.data.routes.filter(route => route.planDate === day && route.status !== "cancelled").map(route => <div key={route.id}><span style={{ borderColor: route.sectorColor }}>{route.routeCode}</span><small>{route.roster.filter(item => !["released", "leave"].includes(item.rosterStatus)).map(item => item.fieldExecutiveName).join(", ") || "Unassigned"}</small></div>)}{!props.data.routes.some(route => route.planDate === day && route.status !== "cancelled") ? <em>No routes</em> : null}</article>)}</div>
      {props.canEdit ? <div className={styles.controlGrid}>
        <details className={styles.formPanel}><summary>Backup FE pool</summary><form action={saveBackupPoolMember} className={styles.formGrid}><Context props={props}/><label>Field Executive<select name="field_executive_id" required defaultValue=""><option value="" disabled>Choose available FE</option>{props.data.fieldExecutives.map(fe => <option key={fe.id} value={fe.id}>{fe.name} · {fe.vehicleType ?? "vehicle not set"}</option>)}</select></label><label>Priority<input type="number" name="priority" min="1" defaultValue="100"/></label><label>Effective from<input type="date" name="effective_from" defaultValue={props.selectedDate}/></label><label>Effective to<input type="date" name="effective_to"/></label><label className={styles.wide}>Notes<input name="notes" placeholder="Primary van backup, weekend-only…"/></label><button className="button">Add to pool</button></form><div className={styles.compactList}>{props.data.backupPool.map(member => <span key={member.id}><strong>{member.fieldExecutiveName}</strong><small>{member.vehicleType} · priority {member.priority}</small></span>)}</div></details>
        <details className={styles.formPanel}><summary>Delegate planning</summary><form action={delegateSectorPlanning} className={styles.formGrid}><Context props={props}/><label>Sector<select name="sector_id" defaultValue=""><option value="">Entire station</option>{props.data.sectors.map(sector => <option key={sector.id} value={sector.id}>{sector.name}</option>)}</select></label><label>Assign to<select name="assigned_to_user_id" required defaultValue=""><option value="" disabled>Choose TL / SSA</option>{props.data.planners.filter(user => ["TEAM_LEADER", "SSA"].includes(user.roleCode)).map(user => <option key={user.id} value={user.id}>{user.name} · {user.roleName}</option>)}</select></label><label>Authority<select name="permission_level"><option value="plan">Plan</option><option value="approve">Plan & approve</option><option value="view">View only</option></select></label><label>From<input type="date" name="effective_from" defaultValue={props.selectedDate}/></label><label>To<input type="date" name="effective_to"/></label><label className={styles.wide}>Reason<input name="reason" placeholder="Weekly delegation, leave cover…"/></label><button className="button">Delegate</button></form><div className={styles.compactList}>{props.data.delegations.map(item => <span key={item.id}><strong>{item.assignedToName}</strong><small>{item.permissionLevel} · {item.sectorId ? props.data.sectors.find(sector => sector.id === item.sectorId)?.name : "Entire station"}</small></span>)}</div></details>
      </div> : null}
      {props.canEdit ? <div className={styles.controlGrid}>
        <details className={styles.formPanel}><summary>Save this week as a template</summary><form action={saveWeeklyRosterTemplate} className={styles.formGrid}><Context props={props}/><label>Template name<input name="template_name" required placeholder="Standard Week A"/></label><label>Sector scope<select name="sector_id" defaultValue=""><option value="">Entire station</option>{props.data.sectors.map(sector => <option key={sector.id} value={sector.id}>{sector.name}</option>)}</select></label><label className={styles.check}><input type="checkbox" name="is_default"/> Default template</label><button className="button">Save template</button></form></details>
        <details className={styles.formPanel}><summary>Apply roster template</summary><form action={applyWeeklyRosterTemplate} className={styles.formGrid}><Context props={props}/><label>Template<select name="template_id" required defaultValue=""><option value="" disabled>Choose template</option>{props.data.templates.map(template => <option key={template.id} value={template.id}>{template.name}{template.isDefault ? " · default" : ""}</option>)}</select></label><button className="button">Apply as draft</button></form><p className={styles.hint}>Existing route codes on the same day are updated; the week remains draft until reviewed.</p></details>
      </div> : null}
    </> : null}
  </section>;
}
