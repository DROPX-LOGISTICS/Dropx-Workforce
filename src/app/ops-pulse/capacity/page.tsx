import { AppShell } from "@/components/app-shell";
import { CapacityAiAction, CapacityAiActionProvider, type CapacityAiFact } from "@/components/capacity-ai-actions";
import { CapacityScopeFilter } from "@/components/capacity-scope-filter";
import { CapacityWorkspaceTabs } from "@/components/capacity-workspace-tabs";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadCapacityRules } from "@/lib/ops-pulse/capacity";
import { loadCapacityGroundUpdates } from "@/lib/ops-pulse/capacity-ground";
import { loadCapacityAssociateDays, loadCapacityStationDays } from "@/lib/ops-pulse/capacity-shipments";
import { loadCodLocations } from "@/lib/ops-pulse/cod";
import { isAmazonEdspXptLocation } from "@/lib/ops-pulse/operating-context";

export const dynamic = "force-dynamic";

type SearchParams = { lens?: string; station?: string; stations?: string; from?: string; to?: string; sort?: string; dir?: string };
type CapacityView = {
  stationCode: string; stationName: string; latestDate: string | null; operationalHeadcount: number; consistentHeadcount: number; occasionalHeadcount: number;
  consistencyDays: number; currentHeadcount: number; averageHeadcount: number;
  averageVolume: number; averageInbound: number; sourceLabel: string; currentSpr: number; targetSpr: number | null; maxSafeSpr: number | null; requiredHeadcount: number | null;
  gap: number | null; additions: number; leavers: number; attritionRate: number; status: "hire" | "surplus" | "balanced" | "risk" | "unconfigured" | "no_data";
  reason: string;
};

function dateShift(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()); }
function num(value: unknown) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function fmt(value: number, digits = 0) { return value.toLocaleString("en-IN", { maximumFractionDigits: digits }); }
function scopeCodes(value: string | undefined, allowed: string[]) {
  if (!value) return allowed;
  if (value === "_none") return [];
  const requested = value.split(",").map((code) => code.trim().toUpperCase());
  return allowed.filter((code) => requested.includes(code));
}

export default async function CapacityPage({ searchParams }: { searchParams?: SearchParams }) {
  const authorization = await requirePagePermission("cps_associates", "access");
  const companyId = requireCompanyId(authorization);
  const locationResult = await loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess);
  const permittedLocations = locationResult.locations.filter(isAmazonEdspXptLocation);
  const selectedCodes = scopeCodes(searchParams?.stations, permittedLocations.map((location) => location.station_code));
  const locations = permittedLocations.filter((location) => selectedCodes.includes(location.station_code));
  const codes = locations.map((location) => location.station_code);
  const sort = ["station", "system", "regular", "adhoc", "consistent", "delivered", "inbound", "spr", "required", "source", "decision"].includes(String(searchParams?.sort)) ? String(searchParams?.sort) : "station";
  const dir = searchParams?.dir === "desc" ? "desc" : "asc";
  const lens = ["movement", "outlook"].includes(String(searchParams?.lens)) ? String(searchParams?.lens) : "current";
  const end = today();
  const reportingDate = dateShift(end, -1);
  const selectedStationCode = codes.includes(String(searchParams?.station ?? "").toUpperCase()) ? String(searchParams?.station).toUpperCase() : null;
  const detailFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(searchParams?.from)) ? String(searchParams?.from) : `${end.slice(0, 8)}01`;
  const detailTo = /^\d{4}-\d{2}-\d{2}$/.test(String(searchParams?.to)) ? String(searchParams?.to) : end;
  const periodDays = lens === "current" ? 6 : lens === "movement" ? 7 : 30;
  const start = dateShift(end, -(periodDays - 1));
  const [ruleResult, shipmentResult, associateResult, reviewResult] = await Promise.all([
    loadCapacityRules(companyId),
    loadCapacityStationDays(companyId, codes, start, end),
    selectedStationCode
      ? loadCapacityAssociateDays(companyId, [selectedStationCode], detailFrom, detailTo)
      : Promise.resolve({ data: [], error: null }),
    loadCapacityGroundUpdates(companyId, "2000-01-01", reportingDate)
  ]);
  const rules = new Map(ruleResult.rows.map((rule) => [rule.stationCode, rule]));
  const allRows = shipmentResult.data ?? [];
  const allAssociateRows = associateResult.data ?? [];
  const allReviews = reviewResult.rows;
  const latestReviewByStation = new Map<string, typeof allReviews[number]>();
  allReviews.forEach((review) => {
    if (num(review.classifiedIds) <= 0) return;
    const stationCode = review.stationCode;
    const current = latestReviewByStation.get(stationCode);
    if (!current || review.workDate > current.workDate) latestReviewByStation.set(stationCode, review);
  });
  const regularCount = (review: typeof allReviews[number] | undefined) => review ? num(review.regularBike) + num(review.regularVan) : 0;
  const adHocCount = (review: typeof allReviews[number] | undefined) => review ? num(review.adHocBike) + num(review.adHocVan) : 0;
  const views: CapacityView[] = locations.map((location) => {
    const rule = rules.get(location.station_code);
    const rows = allRows.filter((row) => row.station_code === location.station_code);
    const associateRows = allAssociateRows.filter((row) => row.station_code === location.station_code);
    const dates = [...new Set(rows.map((row) => row.work_date))].sort();
    const latestDate = dates.at(-1) ?? null;
    const baselineDays = rule?.recentDays ?? 5;
    const baselineDates = dates.slice(-baselineDays);
    const periodDates = dates.filter((date) => date >= dateShift(end, -(periodDays - 1)));
    const selectedDates = periodDates.length ? periodDates : baselineDates;
    const daily = selectedDates.map((date) => {
      const day = rows.find((row) => row.work_date === date);
      return {
        associates: num(day?.active_ids),
        volume: num(day?.delivered),
        inbound: num(day?.inbound)
      };
    });
    const operationalHeadcount = num(latestDate ? rows.find((row) => row.work_date === latestDate)?.active_ids : 0);
    const consistencyDates = dates.slice(-6);
    const consistencyThreshold = Math.max(1, Math.ceil(consistencyDates.length * 2 / 3));
    const idDayCounts = new Map<string, number>();
    associateRows.filter((row) => consistencyDates.includes(row.work_date) && row.associate_id).forEach((row) => {
      const key = `${row.work_date}:${row.associate_id}`;
      if (!idDayCounts.has(key)) idDayCounts.set(key, 1);
    });
    const associateDays = new Map<string, number>();
    [...idDayCounts.keys()].forEach((key) => {
      const associateId = key.slice(key.indexOf(":") + 1);
      associateDays.set(associateId, (associateDays.get(associateId) ?? 0) + 1);
    });
    const measuredConsistentHeadcount = [...associateDays.values()].filter((days) => days >= consistencyThreshold).length;
    const occasionalHeadcount = [...associateDays.values()].filter((days) => days < consistencyThreshold).length;
    const consistentHeadcount = measuredConsistentHeadcount || operationalHeadcount;
    const currentHeadcount = consistentHeadcount;
    const averageHeadcount = daily.length ? daily.reduce((sum, day) => sum + day.associates, 0) / daily.length : 0;
    const averageVolume = daily.length ? daily.reduce((sum, day) => sum + day.volume, 0) / daily.length : 0;
    const averageInbound = daily.length ? daily.reduce((sum, day) => sum + day.inbound, 0) / daily.length : 0;
    const sourceLabels = [...new Set(rows.map((row) => row.volume_source).filter(Boolean))];
    const sourceLabel = sourceLabels.length > 1 ? "Blended" : sourceLabels[0] || "No source";
    const currentSpr = averageHeadcount ? averageVolume / averageHeadcount : 0;
    const recentStart = dateShift(end, -6);
    const previousStart = dateShift(end, -13);
    const recentAssociates = new Set(associateRows.filter((row) => row.work_date >= recentStart).map((row) => row.associate_id).filter(Boolean));
    const previousAssociates = new Set(associateRows.filter((row) => row.work_date >= previousStart && row.work_date < recentStart).map((row) => row.associate_id).filter(Boolean));
    const additions = [...recentAssociates].filter((id) => !previousAssociates.has(id)).length;
    const leavers = [...previousAssociates].filter((id) => !recentAssociates.has(id)).length;
    const attritionRate = previousAssociates.size ? leavers / previousAssociates.size * 100 : 0;
    const hasOperationalData = rows.length > 0 && averageVolume > 0;
    const requiredHeadcount = rule && hasOperationalData ? Math.ceil(averageVolume / rule.targetSpr * (1 + rule.bufferPercent / 100)) : null;
    const gap = requiredHeadcount == null ? null : requiredHeadcount - currentHeadcount;
    const status: CapacityView["status"] = !hasOperationalData ? "no_data" : !rule ? "unconfigured" : currentSpr > rule.maxSafeSpr ? "risk" : gap && gap > 0 ? "hire" : gap != null && gap < -1 ? "surplus" : "balanced";
    const reason = status === "no_data" ? "No recent shipment activity is available; no headcount decision should be made for this station."
      : status === "unconfigured" ? "Configure station SPR and buffer assumptions to generate a workforce recommendation."
      : status === "risk" ? `Recent SPR ${fmt(currentSpr, 1)} exceeds the configured safe limit ${fmt(rule!.maxSafeSpr, 1)}; rebalance volume or add capacity.`
      : status === "hire" ? `Recent demand supports ${requiredHeadcount} associates, leaving a ${gap}-person hiring requirement.`
      : status === "surplus" ? `Current headcount is ${Math.abs(gap ?? 0)} above the demand-based requirement; review deployment before further hiring.`
      : `Headcount is aligned to recent demand at ${fmt(currentSpr, 1)} SPR.`;
    return { stationCode: location.station_code, stationName: location.station_name || location.city || location.station_code, latestDate, operationalHeadcount, consistentHeadcount, occasionalHeadcount, consistencyDays: consistencyDates.length, currentHeadcount, averageHeadcount, averageVolume, averageInbound, sourceLabel, currentSpr, targetSpr: rule?.targetSpr ?? null, maxSafeSpr: rule?.maxSafeSpr ?? null, requiredHeadcount, gap, additions, leavers, attritionRate, status, reason };
  });
  const overviewSortValue = (row: CapacityView) => {
    const review = latestReviewByStation.get(row.stationCode);
    if (sort === "station") return row.stationCode;
    if (sort === "system") return row.operationalHeadcount;
    if (sort === "regular") return review ? regularCount(review) : -1;
    if (sort === "adhoc") return review ? adHocCount(review) : -1;
    if (sort === "consistent") return row.consistentHeadcount;
    if (sort === "delivered") return row.averageVolume;
    if (sort === "inbound") return row.averageInbound;
    if (sort === "spr") return row.currentSpr;
    if (sort === "required") return row.requiredHeadcount ?? -1;
    if (sort === "source") return row.sourceLabel;
    return row.gap ?? 0;
  };
  views.sort((left, right) => {
    const a = overviewSortValue(left);
    const b = overviewSortValue(right);
    const compared = typeof a === "string" ? a.localeCompare(String(b)) : Number(a) - Number(b);
    return dir === "asc" ? compared : -compared;
  });
  const sortParams = new URLSearchParams();
  if (searchParams?.stations) sortParams.set("stations", searchParams.stations);
  if (searchParams?.lens) sortParams.set("lens", searchParams.lens);
  const sortHref = (key: string) => {
    const params = new URLSearchParams(sortParams);
    params.set("sort", key);
    params.set("dir", sort === key && dir === "asc" ? "desc" : "asc");
    return `/ops-pulse/capacity?${params.toString()}`;
  };
  const sortMark = (key: string) => sort === key ? (dir === "asc" ? "↑" : "↓") : "↕";
  const scopeStations = permittedLocations.map((location) => ({ code: location.station_code, name: location.station_name || location.city || location.station_code, cluster: location.cluster || "", region: location.region || "" }));
  const aiDefaults = Object.fromEntries(views.map((row) => [row.stationCode, row.reason]));
  const aiFacts: CapacityAiFact[] = views.map((row) => {
    const review = latestReviewByStation.get(row.stationCode);
    return {
      stationCode: row.stationCode,
      systemIds: row.operationalHeadcount,
      regularIds: review ? regularCount(review) : null,
      adHocIds: review ? adHocCount(review) : null,
      averageDelivered: Number(row.averageVolume.toFixed(1)),
      averageInbound: Number(row.averageInbound.toFixed(1)),
      spr: Number(row.currentSpr.toFixed(1)),
      targetSpr: row.targetSpr,
      maxSafeSpr: row.maxSafeSpr,
      requiredIds: row.requiredHeadcount,
      gap: row.gap,
      status: row.status
    };
  });
  const selectedStation = selectedStationCode ? views.find((row) => row.stationCode === selectedStationCode) ?? null : null;
  const selectedDailyRows = selectedStationCode
    ? allRows.filter((row) => row.station_code === selectedStationCode && row.work_date >= detailFrom && row.work_date <= detailTo)
    : [];
  const selectedRows = selectedStationCode
    ? allAssociateRows.filter((row) => row.station_code === selectedStationCode && row.work_date >= detailFrom && row.work_date <= detailTo)
    : [];
  const detailDates = [...new Set(selectedDailyRows.map((row) => row.work_date))].sort();
  const dailyDetail = detailDates.map((date) => {
    const row = selectedDailyRows.find((candidate) => candidate.work_date === date);
    const associates = num(row?.active_ids);
    const delivered = num(row?.delivered);
    return { date, associates, delivered, inbound: num(row?.inbound), source: row?.volume_source || "No source", spr: associates ? delivered / associates : 0 };
  });
  const associateIds = [...new Set(selectedRows.map((row) => row.associate_id).filter(Boolean))];
  const associateDetail = associateIds.map((associateId) => {
    const rows = selectedRows.filter((row) => row.associate_id === associateId);
    const dates = [...new Set(rows.map((row) => row.work_date))].sort();
    const dailyAllocations = dates.map((date) => rows.filter((row) => row.work_date === date).reduce((sum, row) => sum + num(row.delivered), 0));
    const delivered = dailyAllocations.reduce((sum, value) => sum + value, 0);
    return {
      associateId,
      daysWorked: dates.length,
      delivered,
      averageAllocation: dates.length ? delivered / dates.length : 0,
      peakAllocation: Math.max(0, ...dailyAllocations),
      latestDate: dates.at(-1) ?? null,
      latestAllocation: dailyAllocations.at(-1) ?? 0
    };
  }).sort((a, b) => b.averageAllocation - a.averageAllocation);
  const maxDailyDelivery = Math.max(1, ...dailyDetail.map((day) => day.delivered));
  const totalRoadActive = views.reduce((sum, row) => sum + row.operationalHeadcount, 0);
  const totalConsistent = views.reduce((sum, row) => sum + row.consistentHeadcount, 0);
  const totalOccasional = views.reduce((sum, row) => sum + row.occasionalHeadcount, 0);
  const totalRequired = views.reduce((sum, row) => sum + (row.requiredHeadcount ?? 0), 0);
  const hiringNeed = views.reduce((sum, row) => sum + Math.max(0, row.gap ?? 0), 0);
  const overloaded = views.filter((row) => row.status === "risk").length;
  const reviewedStations = views.filter((row) => latestReviewByStation.has(row.stationCode));
  const actualRegular = reviewedStations.reduce((sum, row) => sum + regularCount(latestReviewByStation.get(row.stationCode)), 0);
  const adHocTotal = reviewedStations.reduce((sum, row) => sum + adHocCount(latestReviewByStation.get(row.stationCode)), 0);
  const classifiedTotal = reviewedStations.reduce((sum, row) => sum + num(latestReviewByStation.get(row.stationCode)?.classifiedIds), 0);

  return <AppShell active="Capacity" pageCode="cps_associates"><div className="ops-command-center capacity-workspace">
    <PageHead eyebrow="Workforce Planning" title="Capacity" subtitle="Headcount, allocation productivity, attrition signals and demand-based hiring recommendations." />
    <CapacityWorkspaceTabs active="overview" />
    <div className="capacity-filter-row"><CapacityScopeFilter selectedCodes={codes} stations={scopeStations}/></div>
    <div className="capacity-basis-strip"><strong>Planning basis</strong><span>Blended road IDs from Daily Shipment Count + delivered detail · delivered volume prefers tracking detail · inbound remains a separate demand signal</span></div>
    {locationResult.error || ruleResult.error || shipmentResult.error || associateResult.error || reviewResult.error ? <div className="message-panel error">{locationResult.error || ruleResult.error || shipmentResult.error?.message || associateResult.error?.message || reviewResult.error}</div> : null}
    <section className="performance-summary-grid"><article><span>Road-active IDs</span><strong>{fmt(totalRoadActive)}</strong><small>Latest system shipment IDs</small></article><article><span>Ground classified</span><strong>{reviewedStations.length ? fmt(classifiedTotal) : "—"}</strong><small>Latest · {reviewedStations.length}/{views.length} updated</small></article><article><span>Regular IDs</span><strong>{reviewedStations.length ? fmt(actualRegular) : "—"}</strong><small>Regular bike + regular van</small></article><article><span>Ad hoc IDs</span><strong>{reviewedStations.length ? fmt(adHocTotal) : "—"}</strong><small>Ad hoc bike + ad hoc van</small></article><article><span>Additional hiring</span><strong>{fmt(hiringNeed)}</strong><small>Rolling demand requirement {fmt(totalRequired)}</small></article></section>
    <CapacityAiActionProvider defaults={aiDefaults} facts={aiFacts}><section className="panel"><div className="panel-head"><div><h2>Station capacity plan</h2><p className="subtle">Latest ground update with recent demand and SPR.</p></div><div className="capacity-panel-actions"><a className="button secondary compact" href={`/ops-pulse/capacity/daily?date=${reportingDate}${searchParams?.stations ? `&stations=${encodeURIComponent(searchParams.stations)}` : ""}`}>Update ground data</a><a className="button secondary compact" href="/master/capacity">Capacity Master</a></div></div>
      <div className="table-wrap"><table className="capacity-table"><thead><tr><th><a href={sortHref("station")}>Station {sortMark("station")}</a></th><th><a href={sortHref("system")}>System IDs {sortMark("system")}</a></th><th><a href={sortHref("regular")}>Regular {sortMark("regular")}</a></th><th><a href={sortHref("adhoc")}>Ad hoc {sortMark("adhoc")}</a></th><th><a href={sortHref("consistent")}>Consistent IDs {sortMark("consistent")}</a></th><th><a href={sortHref("delivered")}>Avg delivered {sortMark("delivered")}</a></th><th><a href={sortHref("inbound")}>Avg inbound {sortMark("inbound")}</a></th><th><a href={sortHref("spr")}>SPR {sortMark("spr")}</a></th><th><a href={sortHref("required")}>Required HC {sortMark("required")}</a></th><th><a href={sortHref("decision")}>Position {sortMark("decision")}</a></th><th>AI action</th></tr></thead><tbody>
        {views.map((row) => { const review = latestReviewByStation.get(row.stationCode); const reliableHeadcount = review ? regularCount(review) : row.consistentHeadcount || row.operationalHeadcount; const reliableGap = row.requiredHeadcount == null ? null : row.requiredHeadcount - reliableHeadcount; const reliableStatus = row.status === "no_data" ? "No data" : reliableGap && reliableGap > 0 ? `${review ? "Hire" : "System: hire"} ${reliableGap}` : reliableGap != null && reliableGap < -1 ? `${review ? "Surplus" : "System: surplus"} ${Math.abs(reliableGap)}` : review ? "Balanced" : "System: balanced"; return <tr key={row.stationCode}><td><a className="capacity-station-link" href={`/ops-pulse/capacity/${row.stationCode}?from=${detailFrom}&to=${detailTo}`}><strong>{row.stationCode}</strong><small>{row.stationName}<br/>{review ? `Ground updated · ${review.workDate}` : "No ground update"}</small></a></td><td><strong>{fmt(row.operationalHeadcount)}</strong><small>{row.latestDate || "No source day"}</small></td><td>{review ? fmt(regularCount(review)) : "—"}</td><td>{review ? fmt(adHocCount(review)) : "—"}</td><td><strong>{fmt(row.consistentHeadcount)}</strong><small>{row.consistencyDays ? `≥ ${Math.ceil(row.consistencyDays * 2 / 3)} of ${row.consistencyDays} days` : "No source days"}</small></td><td>{fmt(row.averageVolume)}</td><td>{row.averageInbound ? fmt(row.averageInbound) : "—"}</td><td><strong className={row.status === "risk" ? "metric-bad-text" : ""}>{row.status === "no_data" ? "—" : fmt(row.currentSpr, 1)}</strong></td><td>{row.requiredHeadcount ?? "—"}</td><td><span className={`capacity-decision ${reliableGap && reliableGap > 0 ? "hire" : reliableGap != null && reliableGap < -1 ? "surplus" : row.status === "no_data" ? "unconfigured" : "balanced"}`}>{reliableStatus}</span></td><td><CapacityAiAction stationCode={row.stationCode}/></td></tr>; })}
      </tbody></table></div>
    </section></CapacityAiActionProvider>
    {selectedStation ? <section className="panel capacity-detail" id="station-detail">
      <div className="panel-head"><div><span className="eyebrow">Station detail</span><h2>{selectedStation.stationCode} · {selectedStation.stationName}</h2></div><a className="button secondary compact" href={`/ops-pulse/capacity?lens=${lens}`}>Close</a></div>
      <form className="capacity-detail-filter" method="get"><input type="hidden" name="lens" value={lens}/><input type="hidden" name="station" value={selectedStation.stationCode}/><label>From<input type="date" name="from" defaultValue={detailFrom}/></label><label>To<input type="date" name="to" defaultValue={detailTo}/></label><button className="button compact" type="submit">Apply</button></form>
      <div className="capacity-action-line"><strong>Action</strong><span>{selectedStation.reason}</span></div>
      {dailyDetail.length ? <div className="capacity-detail-grid">
        <div className="capacity-trend" aria-label="Daily delivery trend">{dailyDetail.map((day) => <div className="capacity-trend-column" key={day.date} title={`${day.date}: ${fmt(day.delivered)} delivered, ${day.associates} associates, ${fmt(day.spr, 1)} SPR`}><span>{fmt(day.delivered)}</span><i style={{ height: `${Math.max(4, day.delivered / maxDailyDelivery * 100)}%` }}/><small>{day.date.slice(8)}</small></div>)}</div>
        <div className="table-wrap"><table className="capacity-daily-table"><thead><tr><th>Date</th><th>Road IDs</th><th>Delivered</th><th>Inbound</th><th>SPR</th><th>Source</th></tr></thead><tbody>{dailyDetail.map((day) => <tr key={day.date}><td>{day.date.split("-").reverse().join("/")}</td><td>{day.associates}</td><td>{fmt(day.delivered)}</td><td>{day.inbound ? fmt(day.inbound) : "—"}</td><td><strong>{fmt(day.spr, 1)}</strong></td><td><small>{day.source}</small></td></tr>)}</tbody></table></div>
      </div> : <div className="empty-state">No shipment activity is available for this station and date range.</div>}
      {associateDetail.length ? <div className="capacity-associate-section"><div className="capacity-section-title"><div><h3>Associate allocation</h3><p>Productivity for each shipment-active associate in the selected period.</p></div><span>{associateDetail.length} associates</span></div>
        <div className="table-wrap"><table className="capacity-daily-table capacity-associate-table"><thead><tr><th>Associate ID</th><th>Days worked</th><th>Total delivered</th><th>Average allocation/day</th><th>Peak allocation</th><th>Latest allocation</th></tr></thead><tbody>
          {associateDetail.map((associate) => <tr key={associate.associateId}><td><strong>{associate.associateId}</strong></td><td>{associate.daysWorked}</td><td>{fmt(associate.delivered)}</td><td><strong>{fmt(associate.averageAllocation, 1)}</strong></td><td>{fmt(associate.peakAllocation)}</td><td>{fmt(associate.latestAllocation)}<small>{associate.latestDate ? associate.latestDate.split("-").reverse().join("/") : ""}</small></td></tr>)}
        </tbody></table></div>
      </div> : null}
    </section> : null}
  </div></AppShell>;
}
