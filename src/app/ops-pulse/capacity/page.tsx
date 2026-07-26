import { AppShell } from "@/components/app-shell";
import { CapacityWorkspaceTabs } from "@/components/capacity-workspace-tabs";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadCapacityRules } from "@/lib/ops-pulse/capacity";
import { loadCodLocations } from "@/lib/ops-pulse/cod";
import { operatingModeForLocation, resolveOperatingContext } from "@/lib/ops-pulse/operating-context";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type SearchParams = { lens?: string; station?: string; from?: string; to?: string };
type ShipmentRow = { work_date: string; station_code: string; provider_employee_id: string; total_delivery: number | string | null };
type ReviewRow = { id: string; description: string | null; updated_at: string };
type CapacityView = {
  stationCode: string; stationName: string; latestDate: string | null; operationalHeadcount: number; consistentHeadcount: number; occasionalHeadcount: number;
  consistencyDays: number; currentHeadcount: number; averageHeadcount: number;
  averageVolume: number; currentSpr: number; targetSpr: number | null; maxSafeSpr: number | null; requiredHeadcount: number | null;
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

async function loadShipmentCapacityRows(companyId: string, codes: string[], start: string, end: string) {
  if (!supabaseAdmin) return { data: [] as ShipmentRow[], error: null };
  const admin = supabaseAdmin;
  const results = await Promise.all(codes.map((code) => admin.from("cps_shipment_daily")
    .select("work_date,station_code,provider_employee_id,total_delivery")
    .eq("company_id", companyId).eq("station_code", code).gte("work_date", start).lte("work_date", end)
    .order("work_date", { ascending: false }).limit(5000)));
  return { data: results.flatMap((result) => (result.data ?? []) as ShipmentRow[]), error: results.find((result) => result.error)?.error ?? null };
}

async function aiReasons(rows: CapacityView[]) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || String(process.env.CAPACITY_AI_REASONING_ENABLED ?? "true").toLowerCase() === "false" || !rows.length) return {};
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_VALIDATION_MODEL || "gpt-4o-mini",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are a logistics workforce planning analyst. Return JSON mapping stationCode to one concise operational sentence. Use only supplied facts. Never invent causes. Mention hire, surplus, balanced, risk, attrition or missing configuration as applicable." },
          { role: "user", content: JSON.stringify(rows.map(({ reason, ...row }) => row)) }
        ]
      })
    });
    clearTimeout(timeout);
    if (!response.ok) return {};
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return JSON.parse(body.choices?.[0]?.message?.content ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export default async function CapacityPage({ searchParams }: { searchParams?: SearchParams }) {
  const authorization = await requirePagePermission("cps_associates", "access");
  const companyId = requireCompanyId(authorization);
  const locationResult = await loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess);
  const locations = resolveOperatingContext(locationResult.locations).selectedLocations.filter((location) => operatingModeForLocation(location) !== "amazon_now");
  const codes = locations.map((location) => location.station_code);
  const lens = ["movement", "outlook"].includes(String(searchParams?.lens)) ? String(searchParams?.lens) : "current";
  const end = today();
  const selectedStationCode = codes.includes(String(searchParams?.station ?? "").toUpperCase()) ? String(searchParams?.station).toUpperCase() : null;
  const detailFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(searchParams?.from)) ? String(searchParams?.from) : `${end.slice(0, 8)}01`;
  const detailTo = /^\d{4}-\d{2}-\d{2}$/.test(String(searchParams?.to)) ? String(searchParams?.to) : end;
  const periodDays = lens === "current" ? 6 : lens === "movement" ? 7 : 30;
  const start = dateShift(end, -(Math.max(30, periodDays) + 14));
  const [ruleResult, shipmentResult, reviewResult] = await Promise.all([
    loadCapacityRules(companyId),
    loadShipmentCapacityRows(companyId, codes, start, end),
    supabaseAdmin ? supabaseAdmin.from("report_import_master").select("id,description,updated_at")
      .eq("company_id", companyId).eq("parser_type", "capacity_daily_review").order("updated_at", { ascending: false }).limit(5000)
      : { data: [] as ReviewRow[], error: null }
  ]);
  const rules = new Map(ruleResult.rows.map((rule) => [rule.stationCode, rule]));
  const allRows = (shipmentResult.data ?? []) as ShipmentRow[];
  const allReviews = ((reviewResult.data ?? []) as ReviewRow[]).map((row) => {
    try { return { id: row.id, updatedAt: row.updated_at, ...(JSON.parse(row.description ?? "{}") as Record<string, unknown>) }; }
    catch { return null; }
  }).filter(Boolean) as Array<Record<string, unknown>>;
  const latestReviewByStation = new Map<string, Record<string, unknown>>();
  allReviews.forEach((review) => {
    const stationCode = String(review.stationCode ?? "");
    const current = latestReviewByStation.get(stationCode);
    if (!current || String(review.reviewDate ?? "") > String(current.reviewDate ?? "")) latestReviewByStation.set(stationCode, review);
  });
  const views: CapacityView[] = locations.map((location) => {
    const rule = rules.get(location.station_code);
    const rows = allRows.filter((row) => row.station_code === location.station_code);
    const dates = [...new Set(rows.map((row) => row.work_date))].sort();
    const latestDate = dates.at(-1) ?? null;
    const baselineDays = rule?.recentDays ?? 5;
    const baselineDates = dates.slice(-baselineDays);
    const periodDates = dates.filter((date) => date >= dateShift(end, -(periodDays - 1)));
    const selectedDates = periodDates.length ? periodDates : baselineDates;
    const daily = selectedDates.map((date) => {
      const dayRows = rows.filter((row) => row.work_date === date);
      return {
        associates: new Set(dayRows.map((row) => row.provider_employee_id).filter(Boolean)).size,
        volume: dayRows.reduce((sum, row) => sum + num(row.total_delivery), 0)
      };
    });
    const currentRows = latestDate ? rows.filter((row) => row.work_date === latestDate) : [];
    const operationalHeadcount = new Set(currentRows.map((row) => row.provider_employee_id).filter(Boolean)).size;
    const consistencyDates = dates.slice(-6);
    const consistencyThreshold = Math.max(1, Math.ceil(consistencyDates.length * 2 / 3));
    const idDayCounts = new Map<string, number>();
    rows.filter((row) => consistencyDates.includes(row.work_date) && row.provider_employee_id).forEach((row) => {
      const key = `${row.work_date}:${row.provider_employee_id}`;
      if (!idDayCounts.has(key)) idDayCounts.set(key, 1);
    });
    const associateDays = new Map<string, number>();
    [...idDayCounts.keys()].forEach((key) => {
      const associateId = key.slice(key.indexOf(":") + 1);
      associateDays.set(associateId, (associateDays.get(associateId) ?? 0) + 1);
    });
    const consistentHeadcount = [...associateDays.values()].filter((days) => days >= consistencyThreshold).length;
    const occasionalHeadcount = [...associateDays.values()].filter((days) => days < consistencyThreshold).length;
    const currentHeadcount = consistentHeadcount || operationalHeadcount;
    const averageHeadcount = daily.length ? daily.reduce((sum, day) => sum + day.associates, 0) / daily.length : 0;
    const averageVolume = daily.length ? daily.reduce((sum, day) => sum + day.volume, 0) / daily.length : 0;
    const currentSpr = averageHeadcount ? averageVolume / averageHeadcount : 0;
    const recentStart = dateShift(end, -6);
    const previousStart = dateShift(end, -13);
    const recentAssociates = new Set(rows.filter((row) => row.work_date >= recentStart).map((row) => row.provider_employee_id).filter(Boolean));
    const previousAssociates = new Set(rows.filter((row) => row.work_date >= previousStart && row.work_date < recentStart).map((row) => row.provider_employee_id).filter(Boolean));
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
    return { stationCode: location.station_code, stationName: location.station_name || location.city || location.station_code, latestDate, operationalHeadcount, consistentHeadcount, occasionalHeadcount, consistencyDays: consistencyDates.length, currentHeadcount, averageHeadcount, averageVolume, currentSpr, targetSpr: rule?.targetSpr ?? null, maxSafeSpr: rule?.maxSafeSpr ?? null, requiredHeadcount, gap, additions, leavers, attritionRate, status, reason };
  });
  const generatedReasons = await aiReasons(views);
  const selectedStation = selectedStationCode ? views.find((row) => row.stationCode === selectedStationCode) ?? null : null;
  const selectedRows = selectedStationCode
    ? allRows.filter((row) => row.station_code === selectedStationCode && row.work_date >= detailFrom && row.work_date <= detailTo)
    : [];
  const detailDates = [...new Set(selectedRows.map((row) => row.work_date))].sort();
  const dailyDetail = detailDates.map((date) => {
    const rows = selectedRows.filter((row) => row.work_date === date);
    const associates = new Set(rows.map((row) => row.provider_employee_id).filter(Boolean)).size;
    const delivered = rows.reduce((sum, row) => sum + num(row.total_delivery), 0);
    return { date, associates, delivered, spr: associates ? delivered / associates : 0 };
  });
  const associateIds = [...new Set(selectedRows.map((row) => row.provider_employee_id).filter(Boolean))];
  const associateDetail = associateIds.map((associateId) => {
    const rows = selectedRows.filter((row) => row.provider_employee_id === associateId);
    const dates = [...new Set(rows.map((row) => row.work_date))].sort();
    const dailyAllocations = dates.map((date) => rows.filter((row) => row.work_date === date).reduce((sum, row) => sum + num(row.total_delivery), 0));
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
  const actualRegular = reviewedStations.reduce((sum, row) => sum + num(latestReviewByStation.get(row.stationCode)?.regularPresent), 0);
  const adHocTotal = reviewedStations.reduce((sum, row) => sum + num(latestReviewByStation.get(row.stationCode)?.adHocPresent), 0);
  const regularStrength = reviewedStations.reduce((sum, row) => sum + num(latestReviewByStation.get(row.stationCode)?.regularStrength), 0);
  const absentTotal = reviewedStations.reduce((sum, row) => sum + num(latestReviewByStation.get(row.stationCode)?.absent), 0);
  const networkAbsenteeism = regularStrength ? absentTotal / regularStrength * 100 : 0;

  return <AppShell active="Capacity" pageCode="cps_associates"><div className="ops-command-center capacity-workspace">
    <PageHead eyebrow="Workforce Planning" title="Capacity" subtitle="Headcount, allocation productivity, attrition signals and demand-based hiring recommendations." />
    <CapacityWorkspaceTabs active="overview" />
    <div className="capacity-basis-strip"><strong>Planning basis</strong><span>Latest six shipment days · unique road-active IDs · delivered packages · station master SPR and buffer</span></div>
    {locationResult.error || ruleResult.error || shipmentResult.error || reviewResult.error ? <div className="message-panel error">{locationResult.error || ruleResult.error || shipmentResult.error?.message || reviewResult.error?.message}</div> : null}
    <section className="performance-summary-grid"><article><span>Road-active IDs</span><strong>{fmt(totalRoadActive)}</strong><small>System shipment IDs</small></article><article><span>Ops-confirmed regular</span><strong>{reviewedStations.length ? fmt(actualRegular) : "—"}</strong><small>{reviewedStations.length}/{views.length} stations reviewed</small></article><article><span>Ad hoc dependency</span><strong>{reviewedStations.length ? fmt(adHocTotal) : "—"}</strong><small>Temporary resources confirmed</small></article><article><span>Absenteeism</span><strong>{reviewedStations.length ? `${fmt(networkAbsenteeism, 1)}%` : "—"}</strong><small>Based on Ops-confirmed regular strength</small></article><article><span>Additional hiring</span><strong>{fmt(hiringNeed)}</strong><small>System demand requirement {fmt(totalRequired)}</small></article></section>
    <section className="panel"><div className="panel-head"><div><h2>Station capacity plan</h2><p className="subtle">Attrition is inferred from associate IDs active in the previous seven days but absent in the latest seven days.</p></div><a className="button secondary compact" href="/master/capacity">Capacity Master</a></div>
      <div className="table-wrap"><table className="capacity-table"><thead><tr><th>Station</th><th>System IDs</th><th>Actual regular</th><th>Ad hoc</th><th>Absent</th><th>Consistent IDs</th><th>Average volume</th><th>SPR</th><th>Required HC</th><th>Decision</th><th>Reason</th></tr></thead><tbody>
        {views.map((row) => { const review = latestReviewByStation.get(row.stationCode); const reliableHeadcount = review ? num(review.regularPresent) : row.consistentHeadcount; const reliableGap = row.requiredHeadcount == null ? null : row.requiredHeadcount - reliableHeadcount; const reliableStatus = !review ? "Review actuals" : reliableGap && reliableGap > 0 ? `Hire ${reliableGap}` : reliableGap != null && reliableGap < -1 ? `Surplus ${Math.abs(reliableGap)}` : "Balanced"; return <tr key={row.stationCode}><td><a className="capacity-station-link" href={`/capacity/${row.stationCode}?from=${detailFrom}&to=${detailTo}`}><strong>{row.stationCode}</strong><small>{row.stationName}<br/>{review ? `Ops reviewed · ${review.reviewDate}` : row.latestDate ? `Awaiting Ops review · ${row.latestDate}` : "No shipment IDs"}</small></a></td><td><strong>{fmt(row.operationalHeadcount)}</strong></td><td>{review ? fmt(num(review.regularPresent)) : "—"}</td><td>{review ? fmt(num(review.adHocPresent)) : "—"}</td><td className={num(review?.absent) ? "metric-bad-text" : ""}>{review ? fmt(num(review.absent)) : "—"}</td><td><strong>{fmt(row.consistentHeadcount)}</strong><small>{row.consistencyDays ? `≥ ${Math.ceil(row.consistencyDays * 2 / 3)} of ${row.consistencyDays} days` : "No source days"}</small></td><td>{fmt(row.averageVolume)}</td><td><strong className={row.status === "risk" ? "metric-bad-text" : ""}>{row.status === "no_data" ? "—" : fmt(row.currentSpr, 1)}</strong></td><td>{row.requiredHeadcount ?? "—"}</td><td><span className={`capacity-decision ${!review ? "unconfigured" : reliableGap && reliableGap > 0 ? "hire" : reliableGap != null && reliableGap < -1 ? "surplus" : "balanced"}`}>{reliableStatus}</span></td><td className="capacity-reason">{review ? String(review.note || generatedReasons[row.stationCode] || row.reason) : "Complete the next-day Ops review before hiring or surplus action."}</td></tr>; })}
      </tbody></table></div>
    </section>
    {selectedStation ? <section className="panel capacity-detail" id="station-detail">
      <div className="panel-head"><div><span className="eyebrow">Station detail</span><h2>{selectedStation.stationCode} · {selectedStation.stationName}</h2></div><a className="button secondary compact" href={`/capacity?lens=${lens}`}>Close</a></div>
      <form className="capacity-detail-filter" method="get"><input type="hidden" name="lens" value={lens}/><input type="hidden" name="station" value={selectedStation.stationCode}/><label>From<input type="date" name="from" defaultValue={detailFrom}/></label><label>To<input type="date" name="to" defaultValue={detailTo}/></label><button className="button compact" type="submit">Apply</button></form>
      <div className="capacity-action-line"><strong>Action</strong><span>{generatedReasons[selectedStation.stationCode] || selectedStation.reason}</span></div>
      {dailyDetail.length ? <div className="capacity-detail-grid">
        <div className="capacity-trend" aria-label="Daily delivery trend">{dailyDetail.map((day) => <div className="capacity-trend-column" key={day.date} title={`${day.date}: ${fmt(day.delivered)} delivered, ${day.associates} associates, ${fmt(day.spr, 1)} SPR`}><span>{fmt(day.delivered)}</span><i style={{ height: `${Math.max(4, day.delivered / maxDailyDelivery * 100)}%` }}/><small>{day.date.slice(8)}</small></div>)}</div>
        <div className="table-wrap"><table className="capacity-daily-table"><thead><tr><th>Date</th><th>Associates worked</th><th>Delivered</th><th>SPR</th></tr></thead><tbody>{dailyDetail.map((day) => <tr key={day.date}><td>{day.date.split("-").reverse().join("/")}</td><td>{day.associates}</td><td>{fmt(day.delivered)}</td><td><strong>{fmt(day.spr, 1)}</strong></td></tr>)}</tbody></table></div>
      </div> : <div className="empty-state">No shipment activity is available for this station and date range.</div>}
      {associateDetail.length ? <div className="capacity-associate-section"><div className="capacity-section-title"><div><h3>Associate allocation</h3><p>Productivity for each shipment-active associate in the selected period.</p></div><span>{associateDetail.length} associates</span></div>
        <div className="table-wrap"><table className="capacity-daily-table capacity-associate-table"><thead><tr><th>Associate ID</th><th>Days worked</th><th>Total delivered</th><th>Average allocation/day</th><th>Peak allocation</th><th>Latest allocation</th></tr></thead><tbody>
          {associateDetail.map((associate) => <tr key={associate.associateId}><td><strong>{associate.associateId}</strong></td><td>{associate.daysWorked}</td><td>{fmt(associate.delivered)}</td><td><strong>{fmt(associate.averageAllocation, 1)}</strong></td><td>{fmt(associate.peakAllocation)}</td><td>{fmt(associate.latestAllocation)}<small>{associate.latestDate ? associate.latestDate.split("-").reverse().join("/") : ""}</small></td></tr>)}
        </tbody></table></div>
      </div> : null}
    </section> : null}
  </div></AppShell>;
}
