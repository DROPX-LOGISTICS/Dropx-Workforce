import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { PerformanceStationFilter } from "@/components/performance-station-filter";
import { AmazonWeekNavigator } from "@/components/amazon-week-navigator";
import { PerformanceSortControl } from "@/components/performance-sort-control";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadCodLocations } from "@/lib/ops-pulse/cod";
import { resolveOperatingContext } from "@/lib/ops-pulse/operating-context";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type SearchParams = { view?: string; week?: string; from?: string; to?: string; stations?: string; sort?: string };
type MetricFact = {
  batch_id: string;
  source_type: string;
  report_year: number | null;
  report_week: number | null;
  report_date: string | null;
  station_code: string | null;
  row_label: string | null;
  raw_text: string | null;
  values_json: unknown;
  created_at: string;
};
type ShipmentFact = {
  work_date: string;
  station_code: string;
  amazon_delivery: number | string | null;
  c_return: number | string | null;
  mfn: number | string | null;
  mfn_return: number | string | null;
  total_delivery: number | string | null;
};

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function validDate(value: string | undefined, fallback: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? String(value) : fallback;
}

function number(value: unknown) {
  return Number(value ?? 0);
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function standing(raw: string | null) {
  return raw?.match(/\b(FANTASTIC|GREAT|FAIR|POOR)\b/i)?.[1]?.toUpperCase() ?? "—";
}

function stationCode(value: string | null) {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function metricValues(row: MetricFact) {
  if (Array.isArray(row.values_json)) return row.values_json.map(number);
  if (row.values_json && typeof row.values_json === "object") {
    const payload = row.values_json as Record<string, unknown>;
    const nested = payload.values ?? payload.metrics ?? payload.data;
    if (Array.isArray(nested)) return nested.map(number);
    const numbered = Object.entries(payload)
      .filter(([key]) => /^\d+$/.test(key))
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([, value]) => number(value));
    if (numbered.length) return numbered;
  }
  return [];
}

const dailyMetricDefinitions = [
  { label: "AFN Premium LMC DEA", short: "AFN Prem LMC DEA", index: 1, direction: "lower", target: 0.0064 },
  { label: "AFN Standard LMC DEA", short: "AFN Std LMC DEA", index: 2, direction: "lower", target: 0.0038 },
  { label: "MFN Premium LMC DEA", short: "MFN Prem LMC DEA", index: 3, direction: "lower", target: 0.0077 },
  { label: "MFN Standard LMC DEA", short: "MFN Std LMC DEA", index: 4, direction: "lower", target: 0.0053 },
  { label: "AFN Premium DOT", short: "AFN Prem DOT", index: 5, direction: "higher", target: 0.965 },
  { label: "AFN Standard DOT", short: "AFN Std DOT", index: 6, direction: "higher", target: 0.942 },
  { label: "MFN Premium DOT", short: "MFN Prem DOT", index: 7, direction: "higher", target: 0.965 },
  { label: "MFN Standard DOT", short: "MFN Std DOT", index: 8, direction: "higher", target: 0.942 },
  { label: "DOT Premium (AFN + MFN)", short: "DOT Premium", index: 9, direction: "higher", target: null },
  { label: "DOT Standard (AFN + MFN)", short: "DOT Standard", index: 10, direction: "higher", target: null },
  { label: "Premium (AFN + MFN) DDS", short: "Premium DDS", index: 11, direction: "higher", target: 0.94 },
  { label: "Standard (AFN + MFN) DDS", short: "Standard DDS", index: 12, direction: "higher", target: 0.89 },
  { label: "Good Scan – Non-Delivery", short: "Good Scan Non-Del", index: 13, direction: "higher", target: 0.9 },
  { label: "Good Scan – Not Picked", short: "Good Scan Not Picked", index: 14, direction: "higher", target: 0.85 },
  { label: "SMD 2.0 Slot Adherence", short: "Slot Adherence", index: 15, direction: "higher", target: 0.987 },
  { label: "LM Contacts per Shipment", short: "LM CPS", index: 16, direction: "lower", target: null },
  { label: "LM Reverse Contacts per Shipment", short: "LM RCPS", index: 17, direction: "lower", target: null },
  { label: "Open COD (>7 Days)", short: "Open COD >7D", index: 18, direction: "lower", target: null },
  { label: "%DNR Within 48 Hours", short: "DNR <48H", index: 19, direction: "lower", target: null },
  { label: "Delivery Success Rate", short: "DSR", index: 20, direction: "higher", target: null }
] as const;

const slsMetricDefinitions = [
  { label: "Overall score", index: 1, target: null, direction: "higher" },
  { label: "Helmet adherence", index: 2, target: .985, direction: "higher" },
  { label: "DOT Premium", index: 3, target: .955, direction: "higher" },
  { label: "DOT Standard", index: 4, target: .935, direction: "higher" },
  { label: "DDS Premium", index: 5, target: .94, direction: "higher" },
  { label: "DDS Standard", index: 6, target: .89, direction: "higher" },
  { label: "In-facility loss vs goal", index: 7, target: 1, direction: "lower" },
  { label: "Short cash", index: 8, target: .001, direction: "lower" },
  { label: "GST pendency", index: 9, target: .001, direction: "lower" },
  { label: "Open COD (>7 days)", index: 10, target: .001, direction: "lower" },
  { label: "Non-delivered good scan", index: 11, target: .9, direction: "higher" },
  { label: "Unsuccessful pickup good scan", index: 12, target: .83, direction: "higher" },
  { label: "SWA COD DSR", index: 13, target: .684, direction: "higher" },
  { label: "SWA prepaid DSR", index: 14, target: .98, direction: "higher" },
  { label: "Forward-leg contacts / shipment", index: 15, target: .003, direction: "lower" },
  { label: "Reverse-leg contacts / shipment", index: 16, target: .0105, direction: "lower" },
  { label: "DNR supporting volume", index: 17, target: null, direction: "higher" },
  { label: "DNR rescue rate", index: 18, target: .85, direction: "higher" },
  { label: "ReadMe OTR", index: 19, target: .95, direction: "higher" },
  { label: "Supporting volume", index: 20, target: null, direction: "higher" },
  { label: "Supporting exception", index: 21, target: null, direction: "lower" }
] as const;

function ragStatus(value: number, target: number | null, direction: string) {
  if (target == null) return "neutral";
  if (direction === "higher") {
    if (value >= target) return "green";
    if (value >= target * .95) return "amber";
    return "red";
  }
  if (value <= target) return "green";
  if (value <= Math.max(target * 2, target + .005)) return "amber";
  return "red";
}

function targetLabel(target: number | null, direction: string) {
  return target == null ? "Reference" : `${direction === "higher" ? "≥" : "≤"} ${percent(target)}`;
}

function weekDates(year: number, week: number) {
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const firstSunday = new Date(yearStart);
  firstSunday.setUTCDate(firstSunday.getUTCDate() - firstSunday.getUTCDay());
  const start = new Date(firstSunday);
  start.setUTCDate(start.getUTCDate() + (week - 1) * 7);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function amazonWeekNumber(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const firstSunday = new Date(yearStart);
  firstSunday.setUTCDate(firstSunday.getUTCDate() - firstSunday.getUTCDay());
  return Math.floor((date.getTime() - firstSunday.getTime()) / 604800000) + 1;
}

export default async function PerformancePage({ searchParams }: { searchParams?: SearchParams }) {
  const authorization = await requirePagePermission("cod_reports", "access");
  const companyId = requireCompanyId(authorization);
  const locationsResult = await loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess);
  const context = resolveOperatingContext(locationsResult.locations);
  const permittedLocations = context.selectedLocations;
  const permittedCodes = permittedLocations.map((location) => location.station_code);
  const requestedCodes = String(searchParams?.stations ?? "").split(",").map((code) => code.trim().toUpperCase()).filter((code) => permittedCodes.includes(code));
  const selectedCodes = requestedCodes.length ? [...new Set(requestedCodes)] : permittedCodes;
  const view = searchParams?.view === "sls" ? "sls" : "daily";
  const to = validDate(searchParams?.to, today());
  const from = validDate(searchParams?.from, `${to.slice(0, 7)}-01`);

  const [metricResult, shipmentResult] = !supabaseAdmin || !selectedCodes.length
    ? [{ data: [] as MetricFact[], error: null }, { data: [] as ShipmentFact[], error: null }]
    : await Promise.all([
      supabaseAdmin.from("report_metric_facts")
        .select("batch_id,source_type,report_year,report_week,report_date,station_code,row_label,raw_text,values_json,created_at")
        .eq("company_id", companyId)
        .in("source_type", ["daily_edsp_metrics", "edsp_sls_scorecard"])
        .order("created_at", { ascending: false })
        .limit(10000),
      supabaseAdmin.from("cps_shipment_daily")
        .select("work_date,station_code,amazon_delivery,c_return,mfn,mfn_return,total_delivery")
        .eq("company_id", companyId).in("station_code", selectedCodes)
        .gte("work_date", from).lte("work_date", to)
    ]);

  const allFacts = (metricResult.data ?? []) as MetricFact[];
  const scopedFacts = allFacts.filter((row) => !row.station_code || selectedCodes.includes(stationCode(row.station_code)));
  const availableWeeks = [...new Set(scopedFacts.filter((row) => row.source_type === "edsp_sls_scorecard" && row.report_week).map((row) => Number(row.report_week)))].sort((a, b) => b - a);
  const selectedWeek = Number(searchParams?.week) || availableWeeks[0] || 1;
  const stationQuery = selectedCodes.length === permittedCodes.length ? "" : `&stations=${encodeURIComponent(selectedCodes.join(","))}`;
  const currentWeek = amazonWeekNumber(today());
  const slsRows = scopedFacts.filter((row) => {
    const values = metricValues(row);
    return row.source_type === "edsp_sls_scorecard" && Number(row.report_week) === selectedWeek && row.station_code && selectedCodes.includes(stationCode(row.station_code)) && values.length > 2 && values[1] > 0 && values[1] <= 1;
  });
  const dailyCandidates = scopedFacts.filter((row) => {
    const values = metricValues(row);
    return row.source_type === "daily_edsp_metrics" && row.station_code && selectedCodes.includes(stationCode(row.station_code)) && values.length > 5;
  });
  const reportDay = (row: MetricFact) => row.report_date || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(row.created_at));
  const exactDailyCandidates = dailyCandidates.filter((row) => reportDay(row) >= from && reportDay(row) <= to);
  const datedFallbackCandidates = dailyCandidates.filter((row) => reportDay(row) <= to);
  const resolvedDailyCandidates = exactDailyCandidates.length
    ? exactDailyCandidates
    : datedFallbackCandidates.length
      ? datedFallbackCandidates
      : dailyCandidates;
  const selectedDailyBatch = resolvedDailyCandidates[0]?.batch_id ?? null;
  const dailyRows = selectedDailyBatch ? resolvedDailyCandidates.filter((row) => row.batch_id === selectedDailyBatch) : [];
  const selectedDailyReportDate = dailyRows[0] ? reportDay(dailyRows[0]) : null;
  const isDailyFallback = Boolean(selectedDailyReportDate && (selectedDailyReportDate < from || selectedDailyReportDate > to));
  const dailySort = searchParams?.sort || "exceptions_desc";
  const missedTargets = (row: MetricFact) => dailyMetricDefinitions.filter((metric) => metric.target != null && ragStatus(metricValues(row)[metric.index] ?? 0, metric.target, metric.direction) !== "green").length;
  const sortedDailyRows = [...dailyRows].sort((a, b) => {
    if (dailySort === "exceptions_desc") return missedTargets(b) - missedTargets(a);
    if (dailySort === "station_desc") return String(b.station_code).localeCompare(String(a.station_code));
    if (dailySort === "dsr_low") return (metricValues(a)[20] ?? 0) - (metricValues(b)[20] ?? 0);
    if (dailySort === "dsr_high") return (metricValues(b)[20] ?? 0) - (metricValues(a)[20] ?? 0);
    return String(a.station_code).localeCompare(String(b.station_code));
  });
  const slsSort = searchParams?.sort || "score_desc";
  const sortedSlsRows = [...slsRows].sort((a, b) => {
    if (slsSort === "station_asc") return String(a.station_code).localeCompare(String(b.station_code));
    if (slsSort === "station_desc") return String(b.station_code).localeCompare(String(a.station_code));
    if (slsSort === "score_asc") return metricValues(a)[1] - metricValues(b)[1];
    return metricValues(b)[1] - metricValues(a)[1];
  });
  const missingDsrStations = dailyRows.filter((row) => Number(metricValues(row)[20] ?? 0) === 0).length;
  const shipments = (shipmentResult.data ?? []) as ShipmentFact[];
  const shipmentMap = new Map<string, { delivered: number; cReturn: number; mfn: number; mfnReturn: number; total: number }>();
  shipments.forEach((row) => {
    const current = shipmentMap.get(row.station_code) ?? { delivered: 0, cReturn: 0, mfn: 0, mfnReturn: 0, total: 0 };
    current.delivered += number(row.amazon_delivery);
    current.cReturn += number(row.c_return);
    current.mfn += number(row.mfn);
    current.mfnReturn += number(row.mfn_return);
    current.total += number(row.total_delivery);
    shipmentMap.set(row.station_code, current);
  });
  const weekRange = weekDates(2026, selectedWeek);
  const averageSls = slsRows.length ? slsRows.reduce((total, row) => total + metricValues(row)[1], 0) / slsRows.length : 0;
  const standingCounts = ["FANTASTIC", "GREAT", "FAIR", "POOR"].map((label) => ({ label, count: slsRows.filter((row) => standing(row.raw_text) === label).length }));
  const maxStanding = Math.max(...standingCounts.map((entry) => entry.count), 1);
  const totalDelivered = shipments.reduce((total, row) => total + number(row.amazon_delivery), 0);
  const totalCReturn = shipments.reduce((total, row) => total + number(row.c_return), 0);
  const totalMfn = shipments.reduce((total, row) => total + number(row.mfn), 0);
  const dailyTargets = dailyMetricDefinitions.filter((metric) => metric.target != null);
  const achievedDailyTargets = dailyRows.reduce((sum, row) => sum + dailyTargets.filter((metric) => ragStatus(metricValues(row)[metric.index] ?? 0, metric.target, metric.direction) === "green").length, 0);
  const totalDailyTargets = dailyRows.length * dailyTargets.length;

  return (
    <AppShell active="Performance" pageCode="cod_reports">
      <div className="ops-command-center performance-workspace">
        <PageHead eyebrow="Performance" title="Station Performance" subtitle="Daily metrics, weekly scorecards and delivery data." />
        <nav className="performance-tabs">
          <Link className={view === "daily" ? "active" : ""} href={`/ops-pulse/performance?view=daily&from=${from}&to=${to}${stationQuery}`}>Daily EDSP</Link>
          <Link className={view === "sls" ? "active" : ""} href={`/ops-pulse/performance?view=sls&week=${selectedWeek}${stationQuery}`}>Amazon SLS</Link>
        </nav>
        <div className="performance-local-filter-row">
          <PerformanceStationFilter stations={permittedLocations.map((location) => ({ code: location.station_code, name: location.station_name || location.city || location.station_code }))} selectedCodes={selectedCodes} view={view} from={from} to={to} week={selectedWeek} />
        </div>

        {metricResult.error || shipmentResult.error ? <section className="panel message-panel error"><div className="panel-body">{metricResult.error?.message ?? shipmentResult.error?.message}</div></section> : null}

        {view === "daily" ? (
          <>
            <section className="ops-control-strip">
              <div className="ops-context-summary"><span>Daily review</span><strong>{from} to {to}</strong><small>{selectedCodes.length} permitted stations</small></div>
              <form className="ops-date-controls"><input type="hidden" name="view" value="daily" />{selectedCodes.length !== permittedCodes.length ? <input type="hidden" name="stations" value={selectedCodes.join(",")} /> : null}<label>From<input type="date" name="from" defaultValue={from} /></label><label>To<input type="date" name="to" defaultValue={to} /></label><button>Apply range</button></form>
            </section>
            <section className="performance-summary-grid">
              <article><span>Delivered</span><strong>{totalDelivered.toLocaleString("en-IN")}</strong><small>Delivered packages</small></article>
              <article><span>Stations reviewed</span><strong>{dailyRows.length}</strong><small>{selectedDailyReportDate ?? "No performance data"}</small></article>
              <article><span>Targets achieved</span><strong>{totalDailyTargets ? `${Math.round(achievedDailyTargets / totalDailyTargets * 100)}%` : "—"}</strong><small>{achievedDailyTargets}/{totalDailyTargets} checks</small></article>
              <article><span>Attention needed</span><strong>{totalDailyTargets - achievedDailyTargets}</strong><small>Missed targets</small></article>
            </section>
            {isDailyFallback ? <section className="performance-data-warning"><div><strong>Selected-day performance row was not found.</strong><span>Showing the nearest available EDSP batch dated {selectedDailyReportDate}. Delivery totals remain filtered to {from}–{to}.</span></div></section> : null}
            {missingDsrStations ? <section className="performance-data-warning"><div><strong>DSR/PSR source value is zero for {missingDsrStations} station{missingDsrStations === 1 ? "" : "s"}.</strong><span>The dashboard is preserving the uploaded report value. Upload a corrected Daily EDSP report containing the metric; the system will not manufacture a replacement percentage.</span></div><a href="https://dashboard.dropxlogistics.com/imports">Open report imports</a></section> : null}
            <section className="panel performance-matrix-panel">
              <div className="panel-head"><div><h2>Daily performance review</h2><p className="subtle">Red needs action, amber is near target, and green is achieved. Targets are shown in every metric header.</p></div><div className="panel-head-tools"><strong>{dailyRows.length} stations</strong><PerformanceSortControl value={dailySort} options={[{ label: "Most misses first", value: "exceptions_desc" }, { label: "Station A–Z", value: "station_asc" }, { label: "Station Z–A", value: "station_desc" }, { label: "Lowest DSR first", value: "dsr_low" }, { label: "Highest DSR first", value: "dsr_high" }]} /></div></div>
              <div className="performance-matrix-wrap">
                <table className="performance-matrix">
                  <thead><tr><th className="sticky-rank">#</th><th className="sticky-station">Station</th><th>Review</th><th>Delivered</th><th>C-Return</th><th>MFN</th>{dailyMetricDefinitions.map((metric) => <th key={metric.label} title={metric.label}><span>{metric.short}</span><small>{targetLabel(metric.target, metric.direction)}</small></th>)}</tr></thead>
                  <tbody>
                    {sortedDailyRows.map((row, index) => {
                      const normalizedCode = stationCode(row.station_code);
                      const shipment = shipmentMap.get(normalizedCode) ?? { delivered: 0, cReturn: 0, mfn: 0, mfnReturn: 0, total: 0 };
                      const values = metricValues(row);
                      return <tr key={`${row.batch_id}-${row.station_code}`}>
                        <td className="sticky-rank">{index + 1}</td>
                        <td className="sticky-station"><strong>{normalizedCode}</strong><small>{row.row_label || "—"}</small></td>
                        <td><strong className={missedTargets(row) ? "metric-bad-text" : "metric-good-text"}>{missedTargets(row)} missed</strong></td><td>{shipment.delivered.toLocaleString("en-IN")}</td><td>{shipment.cReturn.toLocaleString("en-IN")}</td><td>{shipment.mfn.toLocaleString("en-IN")}</td>
                        {dailyMetricDefinitions.map((metric) => {
                          const value = values[metric.index] ?? 0;
                          const status = ragStatus(value, metric.target, metric.direction);
                          return <td key={metric.label} className={status === "neutral" ? "" : `metric-${status}`} title={`${metric.label} · Target ${targetLabel(metric.target, metric.direction)}`}>{percent(value)}</td>;
                        })}
                      </tr>;
                    })}
                    {!dailyRows.length ? <tr><td colSpan={26} className="empty-cell">Daily performance data is not available for the selected date and stations. Delivery data remains available separately.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : (
          <>
            <section className="ops-control-strip">
              <div className="ops-context-summary"><span>Amazon SLS review</span><strong>Week {selectedWeek}</strong><small>{weekRange.start} to {weekRange.end} · Sunday–Saturday</small></div>
              <AmazonWeekNavigator selectedWeek={selectedWeek} currentWeek={currentWeek} stations={selectedCodes.length === permittedCodes.length ? "" : selectedCodes.join(",")} />
            </section>
            <section className="performance-summary-grid">
              <article><span>Average SLS score</span><strong>{percent(averageSls)}</strong><small>{slsRows.length} station scores</small></article>
              {standingCounts.slice(0, 3).map((entry) => <article key={entry.label}><span>{entry.label}</span><strong>{entry.count}</strong><small>Stations</small></article>)}
            </section>
            <section className="sls-review-stack">
              <article className="ops-visual-card sls-standing-card">
                <header><div><span>STANDING MIX</span><h2>Week {selectedWeek} distribution</h2></div></header>
                <div className="performance-standing-chart">{standingCounts.map((entry) => <div key={entry.label}><span>{entry.label}</span><i><b style={{ width: `${Math.max(3, entry.count / maxStanding * 100)}%` }} /></i><strong>{entry.count}</strong></div>)}</div>
              </article>
              <article className="ops-visual-card sls-ranking-card">
                <header><div><span>SLS SCORECARD</span><h2>Station ranking</h2></div><div className="panel-head-tools"><strong>{weekRange.start}–{weekRange.end}</strong><PerformanceSortControl value={slsSort} options={[{ label: "Highest SLS first", value: "score_desc" }, { label: "Lowest SLS first", value: "score_asc" }, { label: "Station A–Z", value: "station_asc" }, { label: "Station Z–A", value: "station_desc" }]} /></div></header>
                <div className="table-wrap"><table><thead><tr><th>Rank</th><th>Station</th><th>City</th><th>Standing</th><th>SLS score</th><th>Metrics achieved</th></tr></thead><tbody>
                  {sortedSlsRows.map((row, index) => {
                    const values = metricValues(row);
                    const targetMetrics = slsMetricDefinitions.filter((metric) => metric.target != null);
                    const achieved = targetMetrics.filter((metric) => ragStatus(values[metric.index] ?? 0, metric.target, metric.direction) === "green").length;
                    return <tr key={`${row.batch_id}-${row.station_code}`}><td>{index + 1}</td><td><strong>{row.station_code}</strong></td><td>{row.row_label || "—"}</td><td><span className={`performance-standing ${standing(row.raw_text).toLowerCase()}`}>{standing(row.raw_text)}</span></td><td><strong>{percent(values[1])}</strong></td><td><strong>{Math.round(achieved / targetMetrics.length * 100)}%</strong><small className="achievement-count">{achieved}/{targetMetrics.length} targets</small></td></tr>;
                  })}
                  {!slsRows.length ? <tr><td colSpan={6} className="empty-cell">Data not available for Week {selectedWeek}.</td></tr> : null}
                </tbody></table></div>
              </article>
              <section className="sls-station-scorecards">
                {sortedSlsRows.map((row) => {
                  const values = metricValues(row);
                  const targetMetrics = slsMetricDefinitions.filter((metric) => metric.target != null);
                  const achieved = targetMetrics.filter((metric) => ragStatus(values[metric.index] ?? 0, metric.target, metric.direction) === "green").length;
                  const achievement = Math.round(achieved / targetMetrics.length * 100);
                  return <details className="sls-station-scorecard" key={`detail-${row.batch_id}-${row.station_code}`} open={slsRows.length === 1}>
                    <summary><div><span>{row.station_code}</span><strong>{row.row_label || row.station_code}</strong></div><div className="sls-score-summary"><span className={`performance-standing ${standing(row.raw_text).toLowerCase()}`}>{standing(row.raw_text)}</span><b>{percent(values[1])} SLS</b><i className={achievement >= 90 ? "green" : achievement >= 70 ? "amber" : "red"}>{achievement}% targets achieved</i></div><em>⌄</em></summary>
                    <div className="sls-target-legend"><span><i className="green" /> Achieved</span><span><i className="amber" /> Near target</span><span><i className="red" /> Missed</span></div>
                    <div className="sls-target-grid">{slsMetricDefinitions.map((metric) => {
                      const value = values[metric.index] ?? 0;
                      const status = ragStatus(value, metric.target, metric.direction);
                      return <article className={status} key={metric.label}><span>{metric.label}</span><strong>{value <= 1 ? percent(value) : value.toLocaleString("en-IN")}</strong><small>Target {targetLabel(metric.target, metric.direction)}</small></article>;
                    })}</div>
                  </details>;
                })}
              </section>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
