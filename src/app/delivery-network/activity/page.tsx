import { canonicalAttendanceIdentity } from "@/lib/workforce-controls";
import { readAllRows } from "@/lib/supabase-pagination";
import { ArrowRight, CalendarDays, Fingerprint, Gauge, PackageCheck, UsersRound } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PendingLink } from "@/components/pending-link";
import { WorkforceLiveRefresh } from "@/components/workforce-live-refresh";
import { hasPermission, requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadWorkforceEarnings, workforceEarningsDateRange } from "@/lib/workforce-earnings";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type AttendanceRow = { profile_type: string | null; contractor_id: string | null; id: string; account_id: string | null; field_executive_id: string | null; punch_date: string; worker_status: string | null };

function format(value: number, digits = 0) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: digits }).format(value);
}

async function loadAttendanceRows(companyId: string, from: string, to: string, locationScopeIds: string[] | null) {
  if (!supabaseAdmin) return { rows: [] as AttendanceRow[], error: "Supabase service role key is not configured.", truncated: false };
  const rows: AttendanceRow[] = [];
  const pageSize = 1000;
  let truncated = false;
  for (let start = 0; start < 50000; start += pageSize) {
    let query = supabaseAdmin.from("attendance_punches")
      .select("id, profile_type, account_id, contractor_id, field_executive_id, punch_date, worker_status")
      .eq("company_id", companyId).gte("punch_date", from).lte("punch_date", to)
      .order("punch_date", { ascending: true }).order("id", { ascending: true }).range(start, start + pageSize - 1);
    if (locationScopeIds) query = query.in("location_id", locationScopeIds.length ? locationScopeIds : ["00000000-0000-0000-0000-000000000000"]);
    const result = await query;
    if (result.error) return { rows, error: result.error.message, truncated };
    const page = (result.data ?? []) as AttendanceRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
    if (start + pageSize >= 50000) truncated = true;
  }
  return { rows, error: null as string | null, truncated };
}

export default async function WorkforceActivityPage({ searchParams }: { searchParams?: { from?: string; to?: string } }) {
  const authorization = await requirePagePermission("workforce_activity", "access");
  const companyId = requireCompanyId(authorization);
  const { from, to } = workforceEarningsDateRange(searchParams);
  const snapshotPromise = loadWorkforceEarnings(authorization, from, to);
  let attendanceRows: AttendanceRow[] = [];
  let activeWorkforce = 0;
  const identities = new Map<string, string>();
  let attendanceError: string | null = null;

  if (supabaseAdmin) {
    let workforceQuery = supabaseAdmin.from("workforce").select("id", { count: "exact", head: true })
      .eq("company_id", companyId).eq("is_active", true).is("deleted_at", null).neq("migration_state", "reclassified");
    if (!authorization.hasAllLocationAccess) {
      const scope = authorization.locationScopeIds.length ? authorization.locationScopeIds : ["00000000-0000-0000-0000-000000000000"];
      workforceQuery = workforceQuery.in("location_id", scope);
    }
    const [attendanceResult, workforceResult, identitiesResult] = await Promise.all([
      loadAttendanceRows(companyId, from, to, authorization.hasAllLocationAccess ? null : authorization.locationScopeIds),
      workforceQuery.eq("onboarding_status", "active"),
      readAllRows(supabaseAdmin.from("workforce").select("id, source_profile_type, source_profile_id, location_id").eq("company_id", companyId).is("deleted_at", null).neq("migration_state", "reclassified").order("id"))
    ]);
    for (const row of identitiesResult.data ?? []) {
      if (!authorization.hasAllLocationAccess && !authorization.locationScopeIds.includes(row.location_id)) continue;
      identities.set(`workforce:${row.id}`, row.id);
      identities.set(`${row.source_profile_type}:${row.source_profile_id}`, row.id);
    }
    attendanceRows = attendanceResult.rows;
    activeWorkforce = workforceResult.count ?? 0;
    attendanceError = attendanceResult.error ?? workforceResult.error?.message ?? identitiesResult.error?.message ?? (attendanceResult.truncated ? "Attendance source exceeded 50,000 rows. Narrow the date range for complete person-day totals." : null);
  }
  const snapshot = await snapshotPromise;

  const presentRows = attendanceRows.filter((row) => Boolean(canonicalAttendanceIdentity(row, identities)) && !["A", "ABSENT", "INACTIVE"].includes(String(row.worker_status ?? "").toUpperCase()));
  const attendedPeople = new Set(presentRows.map((row) => canonicalAttendanceIdentity(row, identities))).size;
  const attendedPersonDays = new Set(presentRows.map((row) => `${canonicalAttendanceIdentity(row, identities)}:${row.punch_date}`)).size;
  const shipmentWorkers = new Set(snapshot.lines.filter((line) => line.sourceType === "shipment" && line.workforceId).map((line) => line.workforceId)).size;
  const productionLines = snapshot.lines.filter((line) => line.sourceType === "shipment");
  const average = shipmentWorkers ? snapshot.totalShipments / shipmentWorkers : 0;

  return (
    <AppShell active="Attendance & Activity" pageCode="workforce_activity">
      <section className="wf-finance-hero compact">
        <div>
          <span>Daily control tower</span>
          <h1>Attendance &amp; workforce activity</h1>
          <p>One operational view of active people, biometric attendance, imported shipment output, mapping gaps and productivity.</p>
        </div>
        <div className="wf-finance-actions">
          <WorkforceLiveRefresh />
          {hasPermission(authorization, "workforce_earnings", "access") ? <PendingLink className="wf-command-primary" href={`/delivery-network/earnings?from=${from}&to=${to}`}>Open live earnings <ArrowRight size={15} /></PendingLink> : null}
        </div>
      </section>

      <form className="wf-range-bar" method="get">
        <label>From<input defaultValue={from} name="from" type="date" /></label>
        <label>To<input defaultValue={to} name="to" type="date" /></label>
        <button type="submit">Apply period</button>
        <span>Shipment earnings are live from CPS imports; attendance is read from the biometric daily ledger.</span>
      </form>

      {attendanceError || snapshot.warnings.length ? <section className="panel message-panel error"><div className="panel-body">{attendanceError ?? snapshot.warnings.join(" ")}</div></section> : null}

      <section className="wf-finance-kpis">
        <article><span><UsersRound size={18} /></span><small>Active workforce</small><strong>{format(activeWorkforce)}</strong><em>Canonical active profiles</em></article>
        <article><span><CalendarDays size={18} /></span><small>Attended</small><strong>{format(attendedPeople)}</strong><em>{format(attendedPersonDays)} person-days</em></article>
        <article><span><Fingerprint size={18} /></span><small>Producing associates</small><strong>{format(shipmentWorkers)}</strong><em>{format(snapshot.exceptions.length)} mapping/rate gaps</em></article>
        <article><span><PackageCheck size={18} /></span><small>Delivered</small><strong>{format(snapshot.totalSourceShipments)}</strong><em>{format(productionLines.length)} daily source rows</em></article>
        <article><span><Gauge size={18} /></span><small>Average productivity</small><strong>{format(average, 1)}</strong><em>Deliveries per producing associate in period</em></article>
      </section>

      <section className="wf-finance-panel">
        <header>
          <div><span>Daily production ledger</span><h2>Latest associate activity</h2><p>Showing up to 250 of {productionLines.length} source rows. Each traces to its provider ID and business date.</p></div>
          {hasPermission(authorization, "provider_mapping", "access") ? <PendingLink href="/delivery-network/rate-mapping">Resolve ID &amp; rate gaps <ArrowRight size={14} /></PendingLink> : null}
        </header>
        <div className="table-wrap">
          <table className="wf-finance-table">
            <thead><tr><th>Date</th><th>Station</th><th>Associate</th><th>Provider ID</th><th>Delivery</th><th>Total activity</th><th>Pay state</th></tr></thead>
            <tbody>
              {productionLines.slice(0, 250).map((line) => (
                <tr key={line.key}>
                  <td>{line.workDate}</td>
                  <td><strong>{line.stationCode}</strong></td>
                  <td><strong>{line.workerName}</strong><small>{line.dropxId ?? "Not mapped"}</small></td>
                  <td>{line.providerMemberId}</td>
                  <td>{format(line.totalDelivery)}</td>
                  <td>{format(line.totalActivity)}</td>
                  <td><span className={`wf-pay-state ${line.status}`}>{line.status.replaceAll("_", " ")}</span></td>
                </tr>
              ))}
              {!productionLines.length ? <tr><td className="empty-cell" colSpan={7}>No shipment activity was imported for this period.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
