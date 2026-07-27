import { AppShell } from "@/components/app-shell";
import { CapacityAiAction, CapacityAiActionProvider, type CapacityAiFact } from "@/components/capacity-ai-actions";
import { CapacityScopeFilter } from "@/components/capacity-scope-filter";
import { CapacityViewTabs } from "@/components/capacity-view-tabs";
import { CapacityWorkspaceTabs } from "@/components/capacity-workspace-tabs";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadCapacityRules } from "@/lib/ops-pulse/capacity";
import { loadCapacityGroundUpdates, type CapacityGroundUpdate } from "@/lib/ops-pulse/capacity-ground";
import { loadCapacityAssociateDays, loadCapacityStationDays } from "@/lib/ops-pulse/capacity-shipments";
import { loadCodLocations } from "@/lib/ops-pulse/cod";
import { isAmazonEdspXptLocation } from "@/lib/ops-pulse/operating-context";

export const dynamic = "force-dynamic";

type SearchParams = { stations?: string; sort?: string; dir?: string };
type OperationalCapacityView = {
  stationCode: string;
  stationName: string;
  latestDate: string | null;
  systemIds: number;
  groundDate: string | null;
  classifiedIds: number | null;
  regularIds: number | null;
  externalIds: number | null;
  consistentIds: number;
  consistencyDays: number;
  averageWorkload: number;
  averageInbound: number;
  spr: number;
  targetSpr: number | null;
  maxSafeSpr: number | null;
  requiredIds: number | null;
  gap: number | null;
  status: "hire" | "surplus" | "balanced" | "risk" | "unconfigured" | "no_data";
  action: string;
};

function dateShift(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fmt(value: number, digits = 0) {
  return value.toLocaleString("en-IN", { maximumFractionDigits: digits });
}

function scopeCodes(value: string | undefined, allowed: string[]) {
  if (!value) return allowed;
  if (value === "_none") return [];
  const requested = value.split(",").map((code) => code.trim().toUpperCase());
  return allowed.filter((code) => requested.includes(code));
}

function regularCount(review: CapacityGroundUpdate | undefined) {
  return review ? num(review.regularBike) + num(review.regularVan) : 0;
}

function externalCount(review: CapacityGroundUpdate | undefined) {
  return review ? num(review.adHocBike) + num(review.adHocVan) : 0;
}

export default async function CapacityPage({ searchParams }: { searchParams?: SearchParams }) {
  const authorization = await requirePagePermission("cps_associates", "access");
  const companyId = requireCompanyId(authorization);
  const locationResult = await loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess);
  const permittedLocations = locationResult.locations.filter(isAmazonEdspXptLocation);
  const selectedCodes = scopeCodes(searchParams?.stations, permittedLocations.map((location) => location.station_code));
  const locations = permittedLocations.filter((location) => selectedCodes.includes(location.station_code));
  const codes = locations.map((location) => location.station_code);
  const reportingDate = dateShift(today(), -1);
  const rollingFrom = dateShift(reportingDate, -5);
  const groundFrom = dateShift(reportingDate, -30);
  const allowedSorts = ["station", "system", "regular", "external", "consistent", "workload", "inbound", "spr", "required", "decision"];
  const sort = allowedSorts.includes(String(searchParams?.sort)) ? String(searchParams?.sort) : "station";
  const dir = searchParams?.dir === "desc" ? "desc" : "asc";

  const [ruleResult, shipmentResult, associateResult, reviewResult] = await Promise.all([
    loadCapacityRules(companyId),
    loadCapacityStationDays(companyId, codes, rollingFrom, reportingDate),
    loadCapacityAssociateDays(companyId, codes, rollingFrom, reportingDate),
    loadCapacityGroundUpdates(companyId, groundFrom, reportingDate)
  ]);

  const rules = new Map(ruleResult.rows.map((rule) => [rule.stationCode, rule]));
  const stationRows = shipmentResult.data ?? [];
  const associateRows = associateResult.data ?? [];
  const latestReviewByStation = new Map<string, CapacityGroundUpdate>();
  reviewResult.rows.forEach((review) => {
    if (num(review.classifiedIds) <= 0) return;
    const current = latestReviewByStation.get(review.stationCode);
    if (!current || review.workDate > current.workDate) latestReviewByStation.set(review.stationCode, review);
  });

  const views: OperationalCapacityView[] = locations.map((location) => {
    const stationCode = location.station_code;
    const rule = rules.get(stationCode);
    const rows = stationRows.filter((row) => row.station_code === stationCode);
    const stationAssociates = associateRows.filter((row) => row.station_code === stationCode && row.associate_id);
    const dates = [...new Set(rows.map((row) => row.work_date))].sort();
    const latestDate = dates.at(-1) ?? null;
    const daily = dates.map((date) => {
      const row = rows.find((candidate) => candidate.work_date === date);
      return { systemIds: num(row?.active_ids), workload: num(row?.delivered), inbound: num(row?.inbound) };
    });
    const systemIds = num(latestDate ? rows.find((row) => row.work_date === latestDate)?.active_ids : 0);
    const averageSystemIds = daily.length ? daily.reduce((sum, day) => sum + day.systemIds, 0) / daily.length : 0;
    const averageWorkload = daily.length ? daily.reduce((sum, day) => sum + day.workload, 0) / daily.length : 0;
    const averageInbound = daily.length ? daily.reduce((sum, day) => sum + day.inbound, 0) / daily.length : 0;

    const consistencyThreshold = Math.max(1, Math.ceil(dates.length * 2 / 3));
    const daysByAssociate = new Map<string, Set<string>>();
    stationAssociates.forEach((row) => {
      const days = daysByAssociate.get(row.associate_id) ?? new Set<string>();
      days.add(row.work_date);
      daysByAssociate.set(row.associate_id, days);
    });
    const measuredConsistent = [...daysByAssociate.values()].filter((days) => days.size >= consistencyThreshold).length;
    const consistentIds = measuredConsistent || systemIds;
    const review = latestReviewByStation.get(stationCode);
    const regularIds = review ? regularCount(review) : null;
    const externalIds = review ? externalCount(review) : null;
    const reliableIds = regularIds ?? consistentIds;
    const spr = averageSystemIds ? averageWorkload / averageSystemIds : 0;
    const hasData = rows.length > 0 && averageWorkload > 0;
    const requiredIds = rule && hasData
      ? Math.ceil(averageWorkload / rule.targetSpr * (1 + rule.bufferPercent / 100))
      : null;
    const gap = requiredIds == null ? null : requiredIds - reliableIds;
    const status: OperationalCapacityView["status"] = !hasData
      ? "no_data"
      : !rule
        ? "unconfigured"
        : spr > rule.maxSafeSpr
          ? "risk"
          : gap != null && gap > 0
            ? "hire"
            : gap != null && gap < -1
              ? "surplus"
              : "balanced";
    const action = status === "no_data"
      ? "No recent workload is available; do not make a capacity decision."
      : status === "unconfigured"
        ? "Configure the station SPR target and buffer in Capacity Master."
        : status === "risk"
          ? `SPR ${fmt(spr, 1)} is above the safe limit ${fmt(rule!.maxSafeSpr, 1)}; rebalance volume or add temporary capacity.`
          : status === "hire"
            ? `Recent operations require ${requiredIds} DAs, a ${gap}-DA gap against ${review ? "ground-confirmed regular capacity" : "consistent system IDs"}.`
            : status === "surplus"
              ? `${Math.abs(gap ?? 0)} DAs are above the current rolling requirement; review deployment before hiring.`
              : `Capacity is aligned to the rolling workload at ${fmt(spr, 1)} SPR.`;

    return {
      stationCode,
      stationName: location.station_name || location.city || stationCode,
      latestDate,
      systemIds,
      groundDate: review?.workDate ?? null,
      classifiedIds: review ? num(review.classifiedIds) : null,
      regularIds,
      externalIds,
      consistentIds,
      consistencyDays: dates.length,
      averageWorkload,
      averageInbound,
      spr,
      targetSpr: rule?.targetSpr ?? null,
      maxSafeSpr: rule?.maxSafeSpr ?? null,
      requiredIds,
      gap,
      status,
      action
    };
  });

  const sortValue = (row: OperationalCapacityView) => {
    if (sort === "station") return row.stationCode;
    if (sort === "system") return row.systemIds;
    if (sort === "regular") return row.regularIds ?? -1;
    if (sort === "external") return row.externalIds ?? -1;
    if (sort === "consistent") return row.consistentIds;
    if (sort === "workload") return row.averageWorkload;
    if (sort === "inbound") return row.averageInbound;
    if (sort === "spr") return row.spr;
    if (sort === "required") return row.requiredIds ?? -1;
    return row.gap ?? 0;
  };
  views.sort((left, right) => {
    const a = sortValue(left);
    const b = sortValue(right);
    const compared = typeof a === "string" ? a.localeCompare(String(b)) : Number(a) - Number(b);
    return dir === "asc" ? compared : -compared;
  });

  const sortHref = (key: string) => {
    const params = new URLSearchParams();
    if (searchParams?.stations) params.set("stations", searchParams.stations);
    params.set("sort", key);
    params.set("dir", sort === key && dir === "asc" ? "desc" : "asc");
    return `/ops-pulse/capacity?${params.toString()}`;
  };
  const sortMark = (key: string) => sort === key ? (dir === "asc" ? "↑" : "↓") : "↕";
  const scopeStations = permittedLocations.map((location) => ({
    code: location.station_code,
    name: location.station_name || location.city || location.station_code,
    cluster: location.cluster || "",
    region: location.region || ""
  }));
  const reviewed = views.filter((row) => row.groundDate);
  const totalSystem = views.reduce((sum, row) => sum + row.systemIds, 0);
  const totalClassified = reviewed.reduce((sum, row) => sum + (row.classifiedIds ?? 0), 0);
  const totalRegular = reviewed.reduce((sum, row) => sum + (row.regularIds ?? 0), 0);
  const totalExternal = reviewed.reduce((sum, row) => sum + (row.externalIds ?? 0), 0);
  const totalRequired = views.reduce((sum, row) => sum + (row.requiredIds ?? 0), 0);
  const hiringGap = views.reduce((sum, row) => sum + Math.max(0, row.gap ?? 0), 0);
  const aiDefaults = Object.fromEntries(views.map((row) => [row.stationCode, row.action]));
  const aiFacts: CapacityAiFact[] = views.map((row) => ({
    stationCode: row.stationCode,
    systemIds: row.systemIds,
    regularIds: row.regularIds,
    adHocIds: row.externalIds,
    averageDelivered: Number(row.averageWorkload.toFixed(1)),
    averageInbound: Number(row.averageInbound.toFixed(1)),
    spr: Number(row.spr.toFixed(1)),
    targetSpr: row.targetSpr,
    maxSafeSpr: row.maxSafeSpr,
    requiredIds: row.requiredIds,
    gap: row.gap,
    status: row.status
  }));
  const error = locationResult.error || ruleResult.error || shipmentResult.error?.message || associateResult.error?.message || reviewResult.error;

  return <AppShell active="Capacity" pageCode="cps_associates"><div className="ops-command-center capacity-workspace">
    <PageHead eyebrow="Workforce Planning" title="Capacity" subtitle="Daily operational headcount, workload, SPR and ground-confirmed capacity." />
    <div className="capacity-tabs-toolbar"><CapacityWorkspaceTabs active="overview" /><CapacityScopeFilter selectedCodes={codes} stations={scopeStations}/></div>
    <CapacityViewTabs active="operations" />
    <div className="capacity-basis-strip"><strong>Operational basis</strong><span>Rolling 6 completed days · workload includes Amazon delivery, SMD, SWA delivery and C-return · MFN excluded from SPR</span></div>
    {error ? <div className="message-panel error">{error}</div> : null}

    <section className="performance-summary-grid">
      <article><span>Road-active IDs</span><strong>{fmt(totalSystem)}</strong><small>Latest system shipment IDs</small></article>
      <article><span>Ground classified</span><strong>{reviewed.length ? fmt(totalClassified) : "—"}</strong><small>{reviewed.length}/{views.length} stations updated</small></article>
      <article><span>Regular IDs</span><strong>{reviewed.length ? fmt(totalRegular) : "—"}</strong><small>Regular bike DA + regular van DA</small></article>
      <article><span>External IDs</span><strong>{reviewed.length ? fmt(totalExternal) : "—"}</strong><small>External bike DA + external van DA</small></article>
      <article><span>Current gap</span><strong>{fmt(hiringGap)}</strong><small>Rolling requirement {fmt(totalRequired)}</small></article>
    </section>

    <CapacityAiActionProvider defaults={aiDefaults} facts={aiFacts}><section className="panel">
      <div className="panel-head"><div><h2>Station capacity plan</h2><p className="subtle">Operational facts first. Use Hiring review for permanent hiring decisions.</p></div><div className="capacity-panel-actions"><a className="button secondary compact" href={`/ops-pulse/capacity/daily?date=${reportingDate}${searchParams?.stations ? `&stations=${encodeURIComponent(searchParams.stations)}` : ""}`}>Update ground data</a><a className="button secondary compact" href="/master/capacity">Capacity Master</a></div></div>
      <div className="table-wrap"><table className="capacity-table"><thead><tr>
        <th><a href={sortHref("station")}>Station {sortMark("station")}</a></th>
        <th><a href={sortHref("system")}>System IDs {sortMark("system")}</a></th>
        <th><a href={sortHref("regular")}>Regular {sortMark("regular")}</a></th>
        <th><a href={sortHref("external")}>External {sortMark("external")}</a></th>
        <th><a href={sortHref("consistent")}>Consistent IDs {sortMark("consistent")}</a></th>
        <th><a href={sortHref("workload")}>Avg workload {sortMark("workload")}</a></th>
        <th><a href={sortHref("inbound")}>Avg inbound {sortMark("inbound")}</a></th>
        <th><a href={sortHref("spr")}>SPR {sortMark("spr")}</a></th>
        <th><a href={sortHref("required")}>Required HC {sortMark("required")}</a></th>
        <th><a href={sortHref("decision")}>Position {sortMark("decision")}</a></th>
        <th>AI action</th>
      </tr></thead><tbody>
        {views.map((row) => {
          const label = row.status === "no_data" ? "No data"
            : row.status === "unconfigured" ? "Master pending"
              : row.gap != null && row.gap > 0 ? `${row.groundDate ? "Gap" : "System gap"} ${row.gap}`
                : row.gap != null && row.gap < -1 ? `${row.groundDate ? "Surplus" : "System surplus"} ${Math.abs(row.gap)}`
                  : row.groundDate ? "Balanced" : "System balanced";
          const decisionStyle = row.gap != null && row.gap > 0 ? "hire" : row.gap != null && row.gap < -1 ? "surplus" : row.status === "no_data" || row.status === "unconfigured" ? "unconfigured" : "balanced";
          return <tr key={row.stationCode}>
            <td><a className="capacity-station-link" href={`/ops-pulse/capacity/${row.stationCode}?from=${rollingFrom}&to=${reportingDate}`}><strong>{row.stationCode}</strong><small>{row.stationName}<br/>{row.groundDate ? `Ground updated · ${row.groundDate}` : "No ground update"}</small></a></td>
            <td><strong>{fmt(row.systemIds)}</strong><small>{row.latestDate || "No source day"}</small></td>
            <td>{row.regularIds == null ? "—" : fmt(row.regularIds)}</td>
            <td>{row.externalIds == null ? "—" : fmt(row.externalIds)}</td>
            <td><strong>{fmt(row.consistentIds)}</strong><small>{row.consistencyDays ? `≥ ${Math.ceil(row.consistencyDays * 2 / 3)} of ${row.consistencyDays} days` : "No source days"}</small></td>
            <td>{fmt(row.averageWorkload)}</td>
            <td>{row.averageInbound ? fmt(row.averageInbound) : "—"}</td>
            <td><strong className={row.status === "risk" ? "metric-bad-text" : ""}>{row.status === "no_data" ? "—" : fmt(row.spr, 1)}</strong></td>
            <td>{row.requiredIds ?? "—"}</td>
            <td><span className={`capacity-decision ${decisionStyle}`}>{label}</span></td>
            <td><CapacityAiAction stationCode={row.stationCode}/></td>
          </tr>;
        })}
        {!views.length ? <tr><td className="empty-cell" colSpan={11}>No permitted stations are available.</td></tr> : null}
      </tbody></table></div>
    </section></CapacityAiActionProvider>
  </div></AppShell>;
}
