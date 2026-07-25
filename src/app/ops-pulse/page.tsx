import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadCodLocations, locationLabel, locationModelName } from "@/lib/ops-pulse/cod";
import {
  operatingModeLabel,
  resolveOperatingContext
} from "@/lib/ops-pulse/operating-context";
import { supabaseAdmin } from "@/lib/supabase-admin";

type SearchParams = { date?: string; shift?: string; view?: string };
type ShipmentFact = {
  shipment_type: string | null;
  total_activity: number | string | null;
  total_delivery: number | string | null;
  work_date: string;
};

export const dynamic = "force-dynamic";

function todayIst() {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit", month: "2-digit", timeZone: "Asia/Kolkata", year: "numeric"
  }).format(new Date());
}

function selectedDate(value?: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? String(value) : todayIst();
}

function ranges(date: string) {
  const [year, month] = date.split("-").map(Number);
  const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    monthEnd: `${year}-${String(month).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`,
    monthStart: `${year}-${String(month).padStart(2, "0")}-01`,
    yearStart: `${year}-01-01`
  };
}

function sum(rows: ShipmentFact[], from: string, to: string, field: "total_delivery" | "total_activity" = "total_delivery") {
  return rows.reduce((total, row) => row.work_date >= from && row.work_date <= to ? total + Number(row[field] ?? 0) : total, 0);
}

function count(value: number) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value);
}

function modelAccent(mode: string) {
  if (mode === "amazon_now") return "now";
  if (mode === "flipkart_odh_mdh") return "flipkart";
  return "amazon";
}

async function shipmentFacts(companyId: string, stationCodes: string[], from: string, to: string) {
  if (!supabaseAdmin) return { error: "Supabase connection is unavailable.", rows: [] as ShipmentFact[] };
  const { data, error } = await supabaseAdmin
    .from("cps_shipment_daily")
    .select("shipment_type,total_activity,total_delivery,work_date")
    .eq("company_id", companyId)
    .in("station_code", stationCodes)
    .gte("work_date", from)
    .lte("work_date", to)
    .order("work_date");
  return { error: error?.message ?? null, rows: (data ?? []) as ShipmentFact[] };
}

export default async function OpsPulsePage({ searchParams }: { searchParams?: SearchParams }) {
  const authorization = await requirePagePermission("ops_pulse", "access");
  const companyId = requireCompanyId(authorization);
  const locationsResult = await loadCodLocations(
    companyId,
    authorization.locationScopeIds,
    authorization.hasAllLocationAccess
  );
  const context = resolveOperatingContext(locationsResult.locations);
  const selectedLocations = context.selectedLocations;
  const date = selectedDate(searchParams?.date);
  const { monthEnd, monthStart, yearStart } = ranges(date);
  const factsResult = selectedLocations.length
    ? await shipmentFacts(companyId, selectedLocations.map((location) => location.station_code), yearStart, monthEnd)
    : { error: null, rows: [] as ShipmentFact[] };
  const facts = factsResult.rows;
  const attendanceResult = isNaN(Date.parse(`${date}T00:00:00Z`)) || !context.location || !supabaseAdmin
    ? { data: [], error: null }
    : await supabaseAdmin.from("attendance_daily")
      .select("enrolment_id,worker_name,employee_code,in_time,out_time,punch_count,work_minutes,status,remark")
      .eq("company_id", companyId)
      .in("location_id", selectedLocations.map((location) => location.id))
      .eq("punch_date", date)
      .order("in_time", { ascending: true });
  const attendance = attendanceResult.data ?? [];
  const dayVolume = sum(facts, date, date);
  const dayActivity = sum(facts, date, date, "total_activity");
  const monthVolume = sum(facts, monthStart, monthEnd);
  const mtdVolume = sum(facts, monthStart, date);
  const ytdVolume = sum(facts, yearStart, date);
  const activeDays = new Set(facts.filter((row) => Number(row.total_delivery ?? 0) > 0).map((row) => row.work_date)).size;
  const average = activeDays ? Math.round(ytdVolume / activeDays) : 0;
  const daily = [...new Map(facts.filter((row) => row.work_date >= monthStart && row.work_date <= date).map((row) => [
    row.work_date,
    sum(facts, row.work_date, row.work_date)
  ])).entries()];
  const maxDaily = Math.max(...daily.map(([, value]) => value), 1);
  const accent = modelAccent(context.mode);
  const isNow = context.mode === "amazon_now";
  const selectedShift = searchParams?.shift || "current";
  const shiftStartHour = selectedShift === "night" ? 21 : 9;
  const reported = attendance.length;
  const singlePunch = attendance.filter((row) => Number(row.punch_count ?? 0) < 2).length;
  const late = attendance.filter((row) => {
    if (!row.in_time) return false;
    const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(row.in_time));
    const [hour, minute] = time.split(":").map(Number);
    return hour * 60 + minute > shiftStartHour * 60 + 15;
  }).length;
  const completedShift = attendance.filter((row) => row.out_time && Number(row.work_minutes ?? 0) >= 600).length;
  const scopeLabel = selectedLocations.length > 1
    ? `${selectedLocations.length} selected locations`
    : context.location ? locationLabel(context.location) : "No mapped location";

  return (
    <AppShell active="Dashboard" pageCode="ops_pulse">
      <div className={`ops-command-center ${accent}`}>
        <PageHead
          eyebrow={`${operatingModeLabel(context.mode)} · ${scopeLabel}`}
          title={isNow ? "Live Shift Command Center" : "Operations Command Center"}
          subtitle={isNow
            ? "Store, attendance, shift readiness, hourly output and live exceptions in one operational view."
            : "A focused view of shipment movement, CPS readiness, cash controls and operational exceptions."}
          action={<span className="ops-live-badge"><i /> {isNow ? "LIVE MODE" : "OPERATIONAL"}</span>}
        />

        {locationsResult.error || factsResult.error || attendanceResult.error ? (
          <section className="panel message-panel error"><div className="panel-body"><strong>Data connection issue</strong><p className="subtle">{locationsResult.error ?? factsResult.error ?? attendanceResult.error?.message}</p></div></section>
        ) : null}

        <section className="ops-control-strip">
          <div className="ops-context-summary">
            <span>Selected workspace</span>
            <strong>{operatingModeLabel(context.mode)}</strong>
            <small>{selectedLocations.length > 1 ? `${selectedLocations.length} permitted locations combined` : context.location ? `${context.location.station_code} · ${context.location.station_name} · ${locationModelName(context.location)}` : "No permitted mapped station"}</small>
          </div>
          <form action="/ops-pulse" className="ops-date-controls">
            <label>Business date<input name="date" type="date" defaultValue={date} /></label>
            {isNow ? <label>Shift<select name="shift" defaultValue={selectedShift}><option value="current">Current shift</option><option value="day">09:00–21:00</option><option value="night">21:00–09:00</option></select></label> : null}
            <button type="submit">Refresh view</button>
          </form>
        </section>

        <section className="ops-kpi-grid">
          <article><div className="ops-kpi-icon">D</div><span>Day volume</span><strong>{count(dayVolume)}</strong><small>{date}</small></article>
          <article><div className="ops-kpi-icon">M</div><span>MTD volume</span><strong>{count(mtdVolume)}</strong><small>Month total {count(monthVolume)}</small></article>
          <article><div className="ops-kpi-icon">Y</div><span>YTD volume</span><strong>{count(ytdVolume)}</strong><small>{activeDays} active days</small></article>
          <article><div className="ops-kpi-icon">Ø</div><span>Daily average</span><strong>{count(average)}</strong><small>Across active days</small></article>
          <article className={dayActivity ? "healthy" : "attention"}><div className="ops-kpi-icon">A</div><span>Activity</span><strong>{count(dayActivity)}</strong><small>{dayActivity ? "Import received" : "Awaiting daily import"}</small></article>
        </section>

        <section className="ops-visual-grid">
          <article className="ops-visual-card wide">
            <header><div><span>VOLUME TREND</span><h2>Daily throughput</h2></div><strong>{count(mtdVolume)} MTD</strong></header>
            <div className="ops-bar-chart" aria-label="Daily volume chart">
              {daily.length ? daily.map(([workDate, value]) => (
                <div className="ops-bar-column" key={workDate} title={`${workDate}: ${count(value)}`}>
                  <span style={{ height: `${Math.max(4, Math.round((value / maxDaily) * 100))}%` }} />
                  <small>{workDate.slice(-2)}</small>
                </div>
              )) : <div className="ops-empty-visual">No shipment imports are available for this location and month.</div>}
            </div>
          </article>

          <article className="ops-visual-card">
            <header><div><span>WORKSPACE HEALTH</span><h2>Today’s readiness</h2></div></header>
            <div className="ops-health-list">
              <div><i className={facts.length ? "good" : "warn"} /><span>Shipment data</span><strong>{facts.length ? "Available" : "Pending"}</strong></div>
              <div><i className="good" /><span>Station mapping</span><strong>Ready</strong></div>
              <div><i className={dayActivity ? "good" : "warn"} /><span>Daily activity</span><strong>{dayActivity ? "Active" : "Not received"}</strong></div>
              <div><i className="neutral" /><span>Exceptions</span><strong>Review queue</strong></div>
            </div>
          </article>
        </section>

        {isNow ? (
          <section className="ops-visual-grid">
            <article className="ops-visual-card wide">
              <header><div><span>SHIFT CONTROL</span><h2>Store reporting timeline</h2></div><Link href="/ops-pulse/daily-submission">Open attendance</Link></header>
              <div className="ops-kpi-grid compact">
                <article><div className="ops-kpi-icon">R</div><span>Reported</span><strong>{reported}</strong><small>Real attendance rows</small></article>
                <article className={late ? "attention" : "healthy"}><div className="ops-kpi-icon">L</div><span>Late</span><strong>{late}</strong><small>After shift + 15 min</small></article>
                <article className={singlePunch ? "attention" : "healthy"}><div className="ops-kpi-icon">1</div><span>Single punch</span><strong>{singlePunch}</strong><small>Needs correction</small></article>
                <article><div className="ops-kpi-icon">✓</div><span>Completed shift</span><strong>{completedShift}</strong><small>10+ working hours</small></article>
              </div>
              <div className="now-attendance-list">
                {attendance.slice(0, 12).map((row) => <div key={row.enrolment_id}><strong>{row.worker_name || row.employee_code || row.enrolment_id}</strong><span>{row.in_time ? new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(row.in_time)) : "No in-punch"}</span><b>{Number(row.work_minutes ?? 0)} min</b></div>)}
                {!attendance.length ? <div className="ops-empty-visual">No attendance records received for this store and date.</div> : null}
              </div>
            </article>
            <article className="ops-visual-card">
              <header><div><span>ACTION CENTER</span><h2>Live attention</h2></div></header>
              <div className="ops-health-list">
                <div><i className={reported ? "good" : "warn"} /><span>Attendance feed</span><strong>{reported ? `${reported} reported` : "No data"}</strong></div>
                <div><i className={late ? "warn" : "good"} /><span>Late reporting</span><strong>{late}</strong></div>
                <div><i className={singlePunch ? "warn" : "good"} /><span>Punch exceptions</span><strong>{singlePunch}</strong></div>
                <div><i className={dayActivity ? "good" : "warn"} /><span>Shipment activity</span><strong>{count(dayActivity)}</strong></div>
              </div>
            </article>
          </section>
        ) : (
          <section className="ops-action-grid">
            <Link href="/ops-pulse/daily-submission"><span>01</span><div><strong>Daily operations</strong><small>Review station submission and imported activity</small></div><b>→</b></Link>
            <Link href={context.mode === "flipkart_odh_mdh" ? "/ops-pulse/cod/submission?client=flipkart" : "/ops-pulse/cod/executive-reconciliation?client=amazon"}><span>02</span><div><strong>COD control</strong><small>Capture, reconcile and close cash liability</small></div><b>→</b></Link>
            <Link href="/cps"><span>03</span><div><strong>CPS performance</strong><small>Inspect shipments, associates and cost performance</small></div><b>→</b></Link>
          </section>
        )}
      </div>
    </AppShell>
  );
}
