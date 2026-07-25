import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadCodLocations } from "@/lib/ops-pulse/cod";
import { resolveOperatingContext } from "@/lib/ops-pulse/operating-context";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type SearchParams = { view?: string; week?: string; from?: string; to?: string };
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

function metricValues(row: MetricFact) {
  return Array.isArray(row.values_json) ? row.values_json.map(number) : [];
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

export default async function PerformancePage({ searchParams }: { searchParams?: SearchParams }) {
  const authorization = await requirePagePermission("cod_reports", "access");
  const companyId = requireCompanyId(authorization);
  const locationsResult = await loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess);
  const context = resolveOperatingContext(locationsResult.locations);
  const selectedCodes = context.selectedLocations.map((location) => location.station_code);
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
  const scopedFacts = allFacts.filter((row) => !row.station_code || selectedCodes.includes(row.station_code));
  const availableWeeks = [...new Set(scopedFacts.filter((row) => row.source_type === "edsp_sls_scorecard" && row.report_week).map((row) => Number(row.report_week)))].sort((a, b) => b - a);
  const selectedWeek = Number(searchParams?.week) || availableWeeks[0] || 1;
  const slsRows = scopedFacts.filter((row) => {
    const values = metricValues(row);
    return row.source_type === "edsp_sls_scorecard" && Number(row.report_week) === selectedWeek && row.station_code && selectedCodes.includes(row.station_code) && values.length > 2 && values[1] > 0 && values[1] <= 1;
  });
  const dailyRows = scopedFacts.filter((row) => {
    const values = metricValues(row);
    return row.source_type === "daily_edsp_metrics" && row.station_code && selectedCodes.includes(row.station_code) && values.length > 5;
  });
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

  return (
    <AppShell active="Performance" pageCode="cod_reports">
      <div className="ops-command-center performance-workspace">
        <PageHead eyebrow="Amazon EDSP" title="Station Performance" subtitle="Imported Daily EDSP Metrics, SLS scorecards and shipment activity in one review workspace." />
        <nav className="performance-tabs">
          <Link className={view === "daily" ? "active" : ""} href={`/ops-pulse/performance?view=daily&from=${from}&to=${to}`}>Daily EDSP</Link>
          <Link className={view === "sls" ? "active" : ""} href={`/ops-pulse/performance?view=sls&week=${selectedWeek}`}>Amazon SLS</Link>
        </nav>

        {metricResult.error || shipmentResult.error ? <section className="panel message-panel error"><div className="panel-body">{metricResult.error?.message ?? shipmentResult.error?.message}</div></section> : null}

        {view === "daily" ? (
          <>
            <section className="ops-control-strip">
              <div className="ops-context-summary"><span>Daily review</span><strong>{from} to {to}</strong><small>{selectedCodes.length} permitted stations</small></div>
              <form className="ops-date-controls"><input type="hidden" name="view" value="daily" /><label>From<input type="date" name="from" defaultValue={from} /></label><label>To<input type="date" name="to" defaultValue={to} /></label><button>Apply range</button></form>
            </section>
            <section className="performance-summary-grid">
              <article><span>Delivered</span><strong>{totalDelivered.toLocaleString("en-IN")}</strong><small>Amazon delivery count</small></article>
              <article><span>C-Return</span><strong>{totalCReturn.toLocaleString("en-IN")}</strong><small>Customer return activity</small></article>
              <article><span>MFN</span><strong>{totalMfn.toLocaleString("en-IN")}</strong><small>MFN activity</small></article>
              <article><span>Stations reported</span><strong>{dailyRows.length}</strong><small>Daily EDSP metric rows</small></article>
            </section>
            <section className="panel">
              <div className="panel-head"><div><h2>Station daily performance</h2><p className="subtle">Shipment counts follow the selected date range. EDSP metrics are from the latest imported Daily EDSP report.</p></div></div>
              <div className="table-wrap"><table><thead><tr><th>Station</th><th>City</th><th>Delivered</th><th>C-Return</th><th>MFN</th><th>MFN Return</th><th>Total delivery</th><th>EDSP metrics captured</th></tr></thead><tbody>
                {dailyRows.map((row) => { const shipment = shipmentMap.get(row.station_code ?? "") ?? { delivered: 0, cReturn: 0, mfn: 0, mfnReturn: 0, total: 0 }; const values = metricValues(row); return <tr key={`${row.batch_id}-${row.station_code}`}><td><strong>{row.station_code}</strong></td><td>{row.row_label || "—"}</td><td>{shipment.delivered.toLocaleString("en-IN")}</td><td>{shipment.cReturn.toLocaleString("en-IN")}</td><td>{shipment.mfn.toLocaleString("en-IN")}</td><td>{shipment.mfnReturn.toLocaleString("en-IN")}</td><td>{shipment.total.toLocaleString("en-IN")}</td><td><span className="metric-capture">{values.slice(1).map((value) => value <= 1 ? percent(value) : value.toLocaleString("en-IN")).join(" · ")}</span></td></tr>; })}
                {!dailyRows.length ? <tr><td colSpan={8} className="empty-cell">No Daily EDSP Metrics were found for the selected scope.</td></tr> : null}
              </tbody></table></div>
            </section>
          </>
        ) : (
          <>
            <section className="ops-control-strip">
              <div className="ops-context-summary"><span>Amazon SLS review</span><strong>Week {selectedWeek}</strong><small>{weekRange.start} to {weekRange.end} · Sunday–Saturday</small></div>
              <form className="ops-date-controls"><input type="hidden" name="view" value="sls" /><label>Week<select name="week" defaultValue={selectedWeek}>{availableWeeks.map((week) => <option key={week} value={week}>Week {week}</option>)}</select></label><button>Open week</button></form>
            </section>
            <section className="performance-summary-grid">
              <article><span>Average SLS score</span><strong>{percent(averageSls)}</strong><small>{slsRows.length} station scores</small></article>
              {standingCounts.slice(0, 3).map((entry) => <article key={entry.label}><span>{entry.label}</span><strong>{entry.count}</strong><small>Stations</small></article>)}
            </section>
            <section className="ops-visual-grid">
              <article className="ops-visual-card">
                <header><div><span>STANDING MIX</span><h2>Week {selectedWeek} distribution</h2></div></header>
                <div className="performance-standing-chart">{standingCounts.map((entry) => <div key={entry.label}><span>{entry.label}</span><i><b style={{ width: `${Math.max(3, entry.count / maxStanding * 100)}%` }} /></i><strong>{entry.count}</strong></div>)}</div>
              </article>
              <article className="ops-visual-card wide">
                <header><div><span>SLS SCORECARD</span><h2>Station ranking</h2></div><strong>{weekRange.start}–{weekRange.end}</strong></header>
                <div className="table-wrap"><table><thead><tr><th>Rank</th><th>Station</th><th>City</th><th>Standing</th><th>SLS score</th><th>Performance detail</th></tr></thead><tbody>
                  {slsRows.sort((a, b) => metricValues(b)[1] - metricValues(a)[1]).map((row, index) => <tr key={`${row.batch_id}-${row.station_code}`}><td>{index + 1}</td><td><strong>{row.station_code}</strong></td><td>{row.row_label || "—"}</td><td><span className={`performance-standing ${standing(row.raw_text).toLowerCase()}`}>{standing(row.raw_text)}</span></td><td><strong>{percent(metricValues(row)[1])}</strong></td><td><span className="metric-capture">{row.raw_text}</span></td></tr>)}
                  {!slsRows.length ? <tr><td colSpan={6} className="empty-cell">No SLS scorecard was imported for this week and scope.</td></tr> : null}
                </tbody></table></div>
              </article>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
