import { AppShell } from "@/components/app-shell";
import { CapacityScopeFilter } from "@/components/capacity-scope-filter";
import { CapacityViewTabs } from "@/components/capacity-view-tabs";
import { CapacityWorkspaceTabs } from "@/components/capacity-workspace-tabs";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadCapacitySnapshot, type CapacityStationSnapshot } from "@/lib/ops-pulse/capacity-snapshot";
import { loadCodLocations } from "@/lib/ops-pulse/cod";
import { isAmazonEdspXptLocation } from "@/lib/ops-pulse/operating-context";

export const dynamic = "force-dynamic";

type SearchParams = { stations?: string; sort?: string; dir?: string };

function dateShift(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function fmt(value: number, digits = 0) {
  return value.toLocaleString("en-IN", { maximumFractionDigits: digits });
}

function shortDate(value: string | null) {
  return value ? value.slice(8, 10) + "/" + value.slice(5, 7) : "—";
}

function scopeCodes(value: string | undefined, allowed: string[]) {
  if (!value) return allowed;
  if (value === "_none") return [];
  const requested = value.split(",").map((code) => code.trim().toUpperCase());
  return allowed.filter((code) => requested.includes(code));
}

function decisionTone(row: CapacityStationSnapshot) {
  if (row.dataState !== "ready" || row.decision.status === "ground_required" || row.decision.status === "unconfigured") return "unconfigured";
  if (row.decision.status === "hire_candidate" || row.decision.status === "temporary_surge") return "risk";
  if (row.decision.status === "monitor" || row.decision.status === "flex") return "warn";
  if (row.decision.status === "surplus") return "surplus";
  return "balanced";
}

function portfolioPosition(row: CapacityStationSnapshot) {
  const gap = Math.max(-8, Math.min(8, row.modelledGap ?? 0));
  const ratio = row.targetSpr ? row.spr / row.targetSpr : 1;
  return {
    left: `${Math.max(3, Math.min(97, 50 + gap / 8 * 45))}%`,
    top: `${Math.max(5, Math.min(95, 78 - (ratio - 0.65) / 0.75 * 68))}%`,
    size: Math.max(24, Math.min(44, 22 + Math.sqrt(Math.max(0, row.averageWorkload)) / 3))
  };
}

function trendPath(values: number[], width: number, height: number, scaleMaximum?: number) {
  const maximum = scaleMaximum ?? Math.max(1, ...values);
  return values.map((value, index) => {
    const x = values.length <= 1 ? width / 2 : index / (values.length - 1) * width;
    const y = height - value / maximum * (height - 16) - 8;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

export default async function CapacityPage({ searchParams }: { searchParams?: SearchParams }) {
  const authorization = await requirePagePermission("cps_associates", "access");
  const companyId = requireCompanyId(authorization);
  const locationResult = await loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess);
  const permittedLocations = locationResult.locations.filter(isAmazonEdspXptLocation);
  const selectedCodes = scopeCodes(searchParams?.stations, permittedLocations.map((location) => location.station_code));
  const locations = permittedLocations.filter((location) => selectedCodes.includes(location.station_code));
  const reportingDate = dateShift(today(), -1);
  const snapshot = await loadCapacitySnapshot({ companyId, locations, reportingDate });
  const allowedSorts = new Set(["station", "freshness", "workload", "spr", "required", "gap", "confidence", "decision"]);
  const sort = allowedSorts.has(String(searchParams?.sort)) ? String(searchParams?.sort) : "decision";
  const dir = searchParams?.dir === "asc" ? "asc" : "desc";
  const priority: Record<string, number> = {
    hire_candidate: 8,
    temporary_surge: 7,
    ground_required: 6,
    monitor: 5,
    flex: 4,
    unconfigured: 3,
    no_data: 2,
    surplus: 1,
    balanced: 0
  };
  const sortValue = (row: CapacityStationSnapshot) => {
    if (sort === "station") return row.stationCode;
    if (sort === "freshness") return row.freshnessDays ?? 999;
    if (sort === "workload") return row.averageWorkload;
    if (sort === "spr") return row.spr;
    if (sort === "required") return row.requiredIds ?? -1;
    if (sort === "gap") return row.modelledGap ?? -999;
    if (sort === "confidence") return { high: 3, medium: 2, low: 1 }[row.decision.confidence];
    return priority[row.decision.status] ?? 0;
  };
  const stations = [...snapshot.stations].sort((left, right) => {
    const a = sortValue(left);
    const b = sortValue(right);
    const comparison = typeof a === "string" ? a.localeCompare(String(b)) : Number(a) - Number(b);
    return dir === "asc" ? comparison : -comparison;
  });
  const actionQueue = [...snapshot.stations]
    .filter((row) => priority[row.decision.status] >= 3 || row.dataState !== "ready")
    .sort((a, b) => (a.dataState !== "ready" ? 20 : priority[a.decision.status]) - (b.dataState !== "ready" ? 20 : priority[b.decision.status]))
    .reverse()
    .slice(0, 8);
  const sortHref = (key: string) => {
    const params = new URLSearchParams();
    if (searchParams?.stations) params.set("stations", searchParams.stations);
    params.set("sort", key);
    params.set("dir", sort === key && dir === "desc" ? "asc" : "desc");
    return `/ops-pulse/capacity?${params.toString()}`;
  };
  const sortMark = (key: string) => sort === key ? (dir === "asc" ? "↑" : "↓") : "↕";
  const scopeStations = permittedLocations.map((location) => ({
    code: location.station_code,
    name: location.station_name || location.city || location.station_code,
    cluster: location.cluster || "",
    region: location.region || ""
  }));
  const sourceFreshPct = snapshot.summary.stations ? Math.round(snapshot.summary.sourceReady / snapshot.summary.stations * 100) : 0;
  const groundReadyPct = snapshot.summary.stations ? Math.round(snapshot.summary.groundReady / snapshot.summary.stations * 100) : 0;
  const trend = snapshot.trend.slice(-14);
  const trendMaximum = Math.max(1, ...trend.flatMap((row) => [row.workload, row.supportedWorkload]));
  const workloadPath = trendPath(trend.map((row) => row.workload), 720, 180, trendMaximum);
  const supportedPath = trendPath(trend.map((row) => row.supportedWorkload), 720, 180, trendMaximum);
  const error = [locationResult.error, ...snapshot.errors].filter(Boolean).join(" · ");

  return <AppShell active="Capacity" pageCode="cps_associates"><div className="ops-command-center capacity-workspace capacity-control-tower">
    <PageHead eyebrow="Workforce Planning" title="Capacity Control Tower" subtitle="One trusted view of readiness, workload, workforce position and required actions." />
    <div className="capacity-tabs-toolbar"><CapacityWorkspaceTabs active="overview" /><CapacityScopeFilter selectedCodes={selectedCodes} stations={scopeStations}/></div>
    <CapacityViewTabs active="operations" />
    {error ? <div className="message-panel error">{error}</div> : null}

    <section className={`capacity-readiness-banner ${snapshot.summary.stale ? "warning" : "ready"}`}>
      <div><span>As of</span><strong>{snapshot.scopeDataDate ? snapshot.scopeDataDate.split("-").reverse().join("/") : "No complete date"}</strong></div>
      <div><span>Source coverage</span><strong>{snapshot.scopeCoverage}%</strong></div>
      <div><span>Fresh stations</span><strong>{snapshot.summary.sourceReady}/{snapshot.summary.stations}</strong></div>
      <div><span>Ground ready</span><strong>{snapshot.summary.groundReady}/{snapshot.summary.stations}</strong></div>
      <p>{snapshot.summary.stale
        ? `${snapshot.summary.stale} station${snapshot.summary.stale === 1 ? "" : "s"} have stale or missing source data. Hiring remains evidence-gated.`
        : "All selected stations have current workload data. Ground-matched stations can proceed to workforce review."}</p>
    </section>

    <section className="capacity-hero-grid">
      <article><span>Action required</span><strong>{snapshot.summary.actionRequired}</strong><small>Across selected scope</small></article>
      <article><span>Hiring candidates</span><strong>{snapshot.summary.hireCandidates}</strong><small>{snapshot.summary.permanentGap} sustained positions</small></article>
      <article><span>Peak flex</span><strong>{snapshot.summary.peakFlex}</strong><small>Temporary resources at P90</small></article>
      <article><span>Scope SPR</span><strong>{fmt(snapshot.summary.averageSpr, 1)}</strong><small>Canonical 14-day workload SPR</small></article>
      <article><span>Data readiness</span><strong>{sourceFreshPct}%</strong><small>Ground evidence {groundReadyPct}%</small></article>
    </section>

    <section className="capacity-control-grid">
      <article className="panel capacity-portfolio-panel">
        <div className="panel-head"><div><h2>Capacity position</h2><p className="subtle">SPR versus modelled headcount gap. Bubble size represents workload.</p></div><div className="capacity-chart-legend"><span className="risk">Action</span><span className="warn">Monitor</span><span className="balanced">Balanced</span></div></div>
        <div className="capacity-portfolio-chart">
          <span className="axis-label y-high">High SPR</span><span className="axis-label y-low">Low SPR</span>
          <span className="axis-label x-left">Surplus</span><span className="axis-label x-right">Shortage</span>
          <i className="axis vertical"/><i className="axis horizontal"/>
          {snapshot.stations.map((row) => {
            const position = portfolioPosition(row);
            return <a
              aria-label={`${row.stationCode}: ${fmt(row.spr, 1)} SPR, ${row.modelledGap ?? 0} modelled gap`}
              className={`capacity-portfolio-bubble ${decisionTone(row)}`}
              href={`/ops-pulse/capacity/${row.stationCode}?from=${snapshot.from}&to=${reportingDate}`}
              key={row.stationCode}
              style={{ height: position.size, left: position.left, top: position.top, width: position.size }}
              title={`${row.stationCode} · SPR ${fmt(row.spr, 1)} · gap ${row.modelledGap == null ? "—" : row.modelledGap}`}
            >{row.stationCode}</a>;
          })}
        </div>
      </article>

      <article className="panel capacity-action-queue">
        <div className="panel-head"><div><h2>Action queue</h2><p className="subtle">Highest-priority evidence and capacity actions.</p></div><a href="/ops-pulse/capacity/hiring">Full review →</a></div>
        <div className="capacity-action-list">
          {actionQueue.map((row) => <a href={`/ops-pulse/capacity/${row.stationCode}?from=${snapshot.from}&to=${reportingDate}`} key={row.stationCode}>
            <span className={`capacity-action-code ${decisionTone(row)}`}>{row.stationCode}</span>
            <span><strong>{row.dataState !== "ready" ? "Data refresh required" : row.decision.label}</strong><small>{row.action}</small></span>
            <b>›</b>
          </a>)}
          {!actionQueue.length ? <p className="empty-cell">No current Capacity actions.</p> : null}
        </div>
      </article>
    </section>

    <section className="panel capacity-scope-trend">
      <div className="panel-head"><div><h2>14-day operating trend</h2><p className="subtle">Actual workload versus the workload supportable at configured target SPR.</p></div><div className="capacity-chart-legend"><span className="workload">Workload</span><span className="required">Capacity at target</span></div></div>
      <div className="capacity-trend-chart">
        <svg preserveAspectRatio="none" role="img" viewBox="0 0 720 180">
          <line x1="0" x2="720" y1="45" y2="45"/><line x1="0" x2="720" y1="90" y2="90"/><line x1="0" x2="720" y1="135" y2="135"/>
          <polyline className="workload" fill="none" points={workloadPath}/>
          <polyline className="required" fill="none" points={supportedPath}/>
        </svg>
        <div className="capacity-trend-dates">{trend.map((row, index) => <span key={row.date}>{index % 2 === 0 || index === trend.length - 1 ? shortDate(row.date) : ""}</span>)}</div>
      </div>
    </section>

    <section className="panel">
      <div className="panel-head"><div><h2>Station evidence</h2><p className="subtle">Hiring is enabled only after the configured ground-match and sustained-shortage gates are met.</p></div><div className="capacity-panel-actions"><a className="button secondary compact" href={`/ops-pulse/capacity/daily?date=${reportingDate}${searchParams?.stations ? `&stations=${encodeURIComponent(searchParams.stations)}` : ""}`}>Update ground</a><a className="button secondary compact" href="/master/capacity">Capacity Master</a></div></div>
      <div className="table-wrap"><table className="capacity-table capacity-control-table"><thead><tr>
        <th><a href={sortHref("station")}>Station {sortMark("station")}</a></th>
        <th><a href={sortHref("freshness")}>Data {sortMark("freshness")}</a></th>
        <th><a href={sortHref("workload")}>14-day base {sortMark("workload")}</a></th>
        <th>System IDs</th><th>Ground regular</th>
        <th><a href={sortHref("spr")}>SPR {sortMark("spr")}</a></th>
        <th><a href={sortHref("required")}>Required {sortMark("required")}</a></th>
        <th><a href={sortHref("gap")}>Gap {sortMark("gap")}</a></th>
        <th><a href={sortHref("confidence")}>Confidence {sortMark("confidence")}</a></th>
        <th><a href={sortHref("decision")}>Decision {sortMark("decision")}</a></th>
        <th>Action</th>
      </tr></thead><tbody>
        {stations.map((row) => <tr key={row.stationCode}>
          <td><a className="capacity-station-link" href={`/ops-pulse/capacity/${row.stationCode}?from=${snapshot.from}&to=${reportingDate}`}><strong>{row.stationCode}</strong><small>{row.stationName} · {row.cluster || row.region || "—"}</small></a></td>
          <td><span className={`capacity-data-state ${row.dataState}`}>{row.dataState === "ready" ? "Current" : row.dataState === "stale" ? `${row.freshnessDays}d stale` : "Missing"}</span><small>{row.latestDate || "No source date"}</small></td>
          <td><strong>{fmt(row.averageWorkload)}</strong><small>P90 {fmt(row.decision.peakWorkload)}</small></td>
          <td><strong>{fmt(row.latestSystemIds)}</strong><small>Avg {fmt(row.averageSystemIds, 1)}</small></td>
          <td>{row.groundRegular == null ? "—" : <><strong>{fmt(row.groundRegular)}</strong><small>{row.groundDate}</small></>}</td>
          <td><strong className={row.maxSafeSpr && row.spr > row.maxSafeSpr ? "metric-bad-text" : ""}>{row.averageWorkload ? fmt(row.spr, 1) : "—"}</strong><small>{row.targetSpr ? `Target ${fmt(row.targetSpr, 1)}` : "Target pending"}</small></td>
          <td>{row.requiredIds ?? "—"}</td>
          <td><strong className={(row.modelledGap ?? 0) > 0 ? "metric-bad-text" : (row.modelledGap ?? 0) < -1 ? "metric-warn-text" : "metric-good-text"}>{row.modelledGap == null ? "—" : `${row.modelledGap > 0 ? "+" : ""}${row.modelledGap}`}</strong><small>{row.groundRegular == null ? "Modelled" : "Ground based"}</small></td>
          <td><span className={`capacity-confidence ${row.decision.confidence}`}>{row.decision.confidence}</span><small>{row.decision.matchedDays}/{row.decision.minimumMatchedDays} ground days</small></td>
          <td><span className={`capacity-decision ${decisionTone(row)}`}>{row.dataState === "ready" ? row.decision.label : "Data required"}</span></td>
          <td><span className="capacity-ai-action" title={row.action}>{row.action}</span></td>
        </tr>)}
        {!stations.length ? <tr><td className="empty-cell" colSpan={11}>No permitted stations are selected.</td></tr> : null}
      </tbody></table></div>
    </section>
  </div></AppShell>;
}
