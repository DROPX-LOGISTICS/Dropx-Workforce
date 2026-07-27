import { AppShell } from "@/components/app-shell";
import { CapacityServiceMap } from "@/components/capacity-service-map";
import { CapacityStationLayerMap } from "@/components/capacity-station-layer-map";
import { CapacityWorkspaceTabs } from "@/components/capacity-workspace-tabs";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { capacityMapEmbedUrl, loadCapacityRegionMaps, loadCapacityRules, loadCapacityServiceRoutes, loadGoogleMyMapsStationLayer, loadShipmentSizeRule } from "@/lib/ops-pulse/capacity";
import { loadCapacityGroundUpdates } from "@/lib/ops-pulse/capacity-ground";
import { loadCapacityAssociateDays, loadCapacityPincodes, loadCapacityStationDays } from "@/lib/ops-pulse/capacity-shipments";
import { loadCodLocations } from "@/lib/ops-pulse/cod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { notFound } from "next/navigation";
import { submitCapacityRequest } from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = { from?: string; to?: string; saved?: string; error?: string };
type RequestRow = { id: string; description: string | null; updated_at: string };
type RateCardRow = { id: string; name: string; pay_type: string | null; status: string; effective_from: string; effective_to: string | null; rate_card_lines?: Array<{ metric_code: string; rate: number | string; unit: string | null }> | null };
type StationMapRow = { latitude: number | string | null; longitude: number | string | null; postal_code: string | null; address: string | null };
function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()); }
function validDate(value: unknown) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")); }
function num(value: unknown) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function fmt(value: number, digits = 0) { return value.toLocaleString("en-IN", { maximumFractionDigits: digits }); }

export default async function CapacityStationPage({ params, searchParams }: { params: { station: string }; searchParams?: SearchParams }) {
  const authorization = await requirePagePermission("cps_associates", "access");
  const companyId = requireCompanyId(authorization);
  const stationCode = decodeURIComponent(params.station).trim().toUpperCase();
  const locationResult = await loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess);
  const location = locationResult.locations.find((entry) => entry.station_code === stationCode);
  if (!location) notFound();
  const end = validDate(searchParams?.to) ? String(searchParams?.to) : today();
  const start = validDate(searchParams?.from) ? String(searchParams?.from) : `${end.slice(0, 8)}01`;
  const [stationDailyResult, associateResult, pincodeResult, ruleResult, sizeResult, requestResult, reviewResult, stationMapResult, rateCardResult, capacityMapResult, serviceRouteResult] = await Promise.all([
    loadCapacityStationDays(companyId, [stationCode], start, end),
    loadCapacityAssociateDays(companyId, [stationCode], start, end),
    loadCapacityPincodes(companyId, stationCode, start, end),
    loadCapacityRules(companyId),
    loadShipmentSizeRule(companyId),
    supabaseAdmin ? supabaseAdmin.from("report_import_master").select("id,description,updated_at")
      .eq("company_id", companyId).eq("parser_type", "capacity_ops_request")
      .like("source_code", `capacity_request_${stationCode.toLowerCase()}_%`).order("updated_at", { ascending: false }).limit(10)
      : { data: [] as RequestRow[], error: null },
    loadCapacityGroundUpdates(companyId, start, end),
    supabaseAdmin ? supabaseAdmin.from("stations").select("latitude,longitude,postal_code,address")
      .eq("company_id", companyId).eq("station_code", stationCode).maybeSingle()
      : { data: null as StationMapRow | null, error: null },
    supabaseAdmin ? supabaseAdmin.from("rate_cards").select("id,name,pay_type,status,effective_from,effective_to,rate_card_lines(metric_code,rate,unit)")
      .eq("station_id", location.id).in("status", ["active", "approved"]).order("effective_from", { ascending: false }).limit(10)
      : { data: [] as RateCardRow[], error: null },
    loadCapacityRegionMaps(companyId),
    loadCapacityServiceRoutes(companyId, stationCode)
  ]);
  const rows = associateResult.data ?? [];
  const daily = (stationDailyResult.data ?? []).map((row) => {
    const ids = num(row.active_ids);
    const delivered = num(row.delivered);
    return { date: row.work_date, ids, lowVolumeIds: num(row.low_volume_ids), delivered, inbound: num(row.inbound), source: row.volume_source || "No source", spr: ids ? delivered / ids : 0 };
  }).sort((a, b) => a.date.localeCompare(b.date));
  const dates = daily.map((row) => row.date);
  const reviews = reviewResult.rows.filter((row) => row.stationCode === stationCode);
  const reviewMap = new Map(reviews.map((review) => [review.workDate, review]));
  const rule = ruleResult.rows.find((entry) => entry.stationCode === stationCode);
  const minimumActive = sizeResult.rule?.minActiveShipments ?? 5;
  const targetSpr = rule?.targetSpr ?? null;
  const buffer = rule?.bufferPercent ?? 0;
  const totalDelivered = daily.reduce((sum, day) => sum + day.delivered, 0);
  const averageIds = daily.length ? daily.reduce((sum, day) => sum + day.ids, 0) / daily.length : 0;
  const averageVolume = daily.length ? totalDelivered / daily.length : 0;
  const averageInbound = daily.length ? daily.reduce((sum, day) => sum + day.inbound, 0) / daily.length : 0;
  const averageSpr = averageIds ? averageVolume / averageIds : 0;
  const requiredIds = targetSpr && averageVolume ? Math.ceil(averageVolume / targetSpr * (1 + buffer / 100)) : null;
  const allIds = [...new Set(rows.map((row) => row.associate_id).filter(Boolean))];
  const allocations = allIds.map((id) => {
    const idRows = rows.filter((row) => row.associate_id === id);
    const workedDates = [...new Set(idRows.filter((row) => num(row.delivered) >= minimumActive).map((row) => row.work_date))];
    const lowVolumeDays = idRows.filter((row) => num(row.delivered) < minimumActive).length;
    const delivered = idRows.reduce((sum, row) => sum + num(row.delivered), 0);
    const volumetric = idRows.reduce((sum, row) => sum + num(row.volumetric), 0);
    const small = idRows.reduce((sum, row) => sum + num(row.small), 0);
    const activeDelivered = idRows.filter((row) => num(row.delivered) >= minimumActive).reduce((sum, row) => sum + num(row.delivered), 0);
    return { id, name: idRows.find((row) => row.associate_name)?.associate_name || "Unmapped name", days: workedDates.length, lowVolumeDays, delivered, volumetric, small, average: workedDates.length ? activeDelivered / workedDates.length : 0 };
  }).sort((a, b) => b.average - a.average);
  const requests = ((requestResult.data ?? []) as RequestRow[]).map((row) => {
    try { return { id: row.id, updatedAt: row.updated_at, ...(JSON.parse(row.description ?? "{}") as Record<string, unknown>) }; }
    catch { return null; }
  }).filter(Boolean) as Array<Record<string, unknown>>;
  const reviewedDays = daily.filter((day) => reviewMap.has(day.date)).length;
  const averageActualRegular = reviews.length ? reviews.reduce((sum, review) => sum + num(review.regularBike) + num(review.regularVan), 0) / reviews.length : 0;
  const averageAdHoc = reviews.length ? reviews.reduce((sum, review) => sum + num(review.adHocBike) + num(review.adHocVan), 0) / reviews.length : 0;
  const averageRegularVans = reviews.length ? reviews.reduce((sum, review) => sum + num(review.regularVanVehicle), 0) / reviews.length : 0;
  const averageAdHocVans = reviews.length ? reviews.reduce((sum, review) => sum + num(review.adHocVanVehicle), 0) / reviews.length : 0;
  const averageBike = reviews.length ? reviews.reduce((sum, review) => sum + num(review.regularBike) + num(review.adHocBike), 0) / reviews.length : 0;
  const averageVan = reviews.length ? reviews.reduce((sum, review) => sum + num(review.regularVan) + num(review.adHocVan), 0) / reviews.length : 0;
  const stationMap = stationMapResult.data as StationMapRow | null;
  const latitude = num(stationMap?.latitude);
  const longitude = num(stationMap?.longitude);
  const rateCards = (rateCardResult.data ?? []) as unknown as RateCardRow[];
  const pincodes = pincodeResult.data ?? [];
  const pincodeDelivered = pincodes.reduce((sum, row) => sum + num(row.delivered), 0);
  const weightReady = pincodes.reduce((sum, row) => sum + num(row.weight_ready), 0);
  const dimensionReady = pincodes.reduce((sum, row) => sum + num(row.dimension_ready), 0);
  const normalized = (value: string | null | undefined) => String(value ?? "").trim().toLowerCase();
  const capacityMap = capacityMapResult.rows.find((map) => normalized(map.matchValue) === normalized(
    map.matchField === "station" ? stationCode : map.matchField === "state" ? location.state : location.region
  ));
  const capacityMapUrl = capacityMap ? capacityMapEmbedUrl(capacityMap.mapUrl) : null;
  const stationLayer = capacityMap ? await loadGoogleMyMapsStationLayer(companyId, capacityMap.mapUrl, stationCode) : { features: [], error: null };
  const fallbackAction = !daily.length ? "No shipment-ID data is available for this date range."
    : requiredIds != null && requiredIds > averageIds ? `Average demand requires ${requiredIds} IDs including ${buffer}% buffer; current daily average is ${fmt(averageIds, 1)}.`
    : requiredIds != null ? `Average road-active capacity covers demand; validate ad hoc IDs before closing hiring requirements.` : "Configure target SPR in Capacity Master to calculate required IDs.";
  const action = fallbackAction;

  return <AppShell active="Capacity" pageCode="cps_associates"><div className="ops-command-center capacity-workspace">
    <PageHead eyebrow="Station Capacity" title={`${stationCode} · ${location.station_name || location.city || stationCode}`} subtitle="Road-ID headcount, capacity workload, inbound demand and allocation productivity." />
    <CapacityWorkspaceTabs active="overview" />
    <div className="capacity-station-toolbar"><a className="button secondary compact" href="/ops-pulse/capacity">← All stations</a><form method="get"><label>From<input type="date" name="from" defaultValue={start}/></label><label>To<input type="date" name="to" defaultValue={end}/></label><button className="button compact">Apply</button></form></div>
    {searchParams?.saved ? <div className="message-panel success">Operations update submitted.</div> : null}
    {searchParams?.error || stationDailyResult.error || associateResult.error || pincodeResult.error || requestResult.error || reviewResult.error || stationMapResult.error || rateCardResult.error || capacityMapResult.error || serviceRouteResult.error ? <div className="message-panel error">{searchParams?.error || stationDailyResult.error?.message || associateResult.error?.message || pincodeResult.error?.message || requestResult.error?.message || reviewResult.error || stationMapResult.error?.message || rateCardResult.error?.message || capacityMapResult.error || serviceRouteResult.error}</div> : null}
    <section className="performance-summary-grid"><article><span>Average road IDs</span><strong>{fmt(averageIds, 1)}</strong><small>Daily active IDs</small></article><article><span>Average workload</span><strong>{fmt(averageVolume)}</strong><small>Amazon + SMD + SWA + C-return</small></article><article><span>Average inbound</span><strong>{averageInbound ? fmt(averageInbound) : "—"}</strong><small>Expected packages at station</small></article><article><span>Average SPR</span><strong>{fmt(averageSpr, 1)}</strong><small>Workload ÷ road-active IDs</small></article><article><span>Required IDs</span><strong>{requiredIds ?? "—"}</strong><small>{targetSpr ? `SPR ${fmt(targetSpr, 1)} + ${fmt(buffer)}% buffer` : "Configure master"}</small></article></section>
    <section className="performance-summary-grid capacity-actual-summary"><article><span>Updated days</span><strong>{reviewedDays}/{daily.length}</strong><small>Ground updates saved</small></article><article><span>Regular DAs</span><strong>{reviews.length ? fmt(averageActualRegular, 1) : "—"}</strong><small>Average bike + van DAs</small></article><article><span>External DAs</span><strong>{reviews.length ? fmt(averageAdHoc, 1) : "—"}</strong><small>Temporary bike + van DAs</small></article><article><span>DA mode mix</span><strong>{reviews.length ? `${fmt(averageBike, 1)} / ${fmt(averageVan, 1)}` : "—"}</strong><small>Average bike / van DAs</small></article><article><span>Van count</span><strong>{reviews.length ? `${fmt(averageRegularVans, 1)} / ${fmt(averageAdHocVans, 1)}` : "—"}</strong><small>Regular / external ad hoc vans</small></article></section>
    <div className="capacity-action-line"><strong>Action</strong><span>{action}</span></div>
    <section className="panel capacity-ground-entry-link"><div className="panel-head"><div><h2>Daily ground update</h2><p className="subtle">Assigned packages, delivery associates and temporary vans are maintained in one shared workspace.</p></div><a className="button compact" href={`/ops-pulse/capacity/daily?date=${dates.at(-1) ?? end}&stations=${stationCode}`}>Update {stationCode}</a></div></section>
    <section className="panel"><div className="panel-head"><div><h2>Day-level capacity</h2><p className="subtle">System demand and saved ground staffing in one timeline.</p></div></div><div className="table-wrap"><table className="capacity-daily-table"><thead><tr><th>Date</th><th>IDs used</th><th>Regular Bike DA</th><th>Regular Van DA</th><th>Regular Van Count</th><th>External Bike DA</th><th>External Van DA</th><th>External Ad hoc Van Count</th><th>Assigned</th><th>Workload</th><th>Inbound</th><th>SPR</th><th>Status</th></tr></thead><tbody>
      {daily.map((day) => { const review = reviewMap.get(day.date); const classified = review ? num(review.classifiedIds) : null; const difference = classified == null ? null : day.ids - classified; return <tr key={day.date}><td><a href={`/ops-pulse/capacity/daily?date=${day.date}&stations=${stationCode}`}>{day.date.split("-").reverse().join("/")}</a></td><td><strong>{day.ids}</strong></td><td>{review ? num(review.regularBike) : "—"}</td><td>{review ? num(review.regularVan) : "—"}</td><td>{review ? num(review.regularVanVehicle) : "—"}</td><td>{review ? num(review.adHocBike) : "—"}</td><td>{review ? num(review.adHocVan) : "—"}</td><td>{review ? num(review.adHocVanVehicle) : "—"}</td><td>{review ? fmt(num(review.assignedPackages)) : "—"}</td><td>{fmt(day.delivered)}</td><td>{day.inbound ? fmt(day.inbound) : "—"}</td><td><strong>{fmt(day.spr, 1)}</strong></td><td><span className={`capacity-entry-status ${difference == null ? "pending" : difference === 0 ? "matched" : "different"}`}>{difference == null ? "Not updated" : difference === 0 ? "Matched" : `Difference ${difference > 0 ? "+" : ""}${difference}`}</span></td></tr>; })}
      {!daily.length ? <tr><td className="empty-cell" colSpan={13}>No capacity source data in this range.</td></tr> : null}
    </tbody></table></div></section>
    <section className="capacity-station-columns"><div className="panel"><div className="panel-head"><div><h2>Associate allocation</h2><p className="subtle">Active days require at least {minimumActive} workload. Select a size count to inspect its tracking IDs.</p></div><a className="button secondary compact" href={`/ops-pulse/capacity/associates?station=${stationCode}&from=${start}&to=${end}&preset=custom`}>Open full SPR view</a></div><div className="table-wrap"><table className="capacity-daily-table"><thead><tr><th>Associate</th><th>Active days</th><th>Low-volume days</th><th>Workload</th><th>Average/day</th><th>Volumetric</th><th>Small</th><th>Workload position</th></tr></thead><tbody>{allocations.map((row) => <tr key={row.id}><td><a className="capacity-station-link" href={`/ops-pulse/capacity/associates/${encodeURIComponent(row.id)}?station=${stationCode}&from=${start}&to=${end}`}><strong>{row.name}</strong><small>{row.id}</small></a></td><td>{row.days}</td><td><span className={row.lowVolumeDays ? "metric-bad-text" : ""}>{row.lowVolumeDays || "—"}</span></td><td>{fmt(row.delivered)}</td><td><strong className={row.average > (rule?.maxSafeSpr ?? 70) ? "metric-bad-text" : ""}>{fmt(row.average, 1)}</strong></td><td><a href={`/ops-pulse/capacity/shipments?station=${stationCode}&associate=${encodeURIComponent(row.id)}&size=volumetric&from=${start}&to=${end}`}>{fmt(row.volumetric)} · {row.delivered ? `${fmt(row.volumetric / row.delivered * 100, 1)}%` : "—"}</a></td><td><a href={`/ops-pulse/capacity/shipments?station=${stationCode}&associate=${encodeURIComponent(row.id)}&size=small&from=${start}&to=${end}`}>{fmt(row.small)} · {row.delivered ? `${fmt(row.small / row.delivered * 100, 1)}%` : "—"}</a></td><td><span className={`capacity-decision ${row.average > (rule?.maxSafeSpr ?? 70) ? "risk" : row.average < (rule?.targetSpr ?? 60) ? "unconfigured" : "balanced"}`}>{row.average > (rule?.maxSafeSpr ?? 70) ? "Above safe" : row.average < (rule?.targetSpr ?? 60) ? "Below target" : "Target range"}</span></td></tr>)}</tbody></table></div></div>
      <div className="panel"><div className="panel-head"><div><h2>Operations update</h2><p className="subtle">Record ad hoc IDs or request additional capacity with ground context.</p></div></div><form action={submitCapacityRequest} className="capacity-request-form"><input type="hidden" name="station_code" value={stationCode}/><input type="hidden" name="from" value={start}/><input type="hidden" name="to" value={end}/><label>Ad hoc IDs used<input name="ad_hoc_ids" type="number" min="0" defaultValue="0"/></label><label>Additional IDs requested<input name="requested_additional" type="number" min="0" defaultValue="0"/></label><label className="wide">Reason / ground update<textarea name="reason" maxLength={1000} placeholder="Example: Three regular IDs are ad hoc and may not continue next week; request three permanent associates." required/></label><button className="button">Submit update</button></form>
      <div className="capacity-request-log">{requests.map((request) => <article key={String(request.id)}><strong>Request {Number(request.requestedAdditional ?? 0) ? `+${request.requestedAdditional} IDs` : "update"}</strong><span>{String(request.reason ?? "")}</span><small>{String(request.createdAt ?? request.updatedAt ?? "").slice(0, 10)} · {Number(request.adHocIds ?? 0)} ad hoc IDs</small></article>)}{!requests.length ? <p className="empty-cell">No operations updates yet.</p> : null}</div></div>
    </section>
    <section className="panel capacity-area-pay"><div className="panel-head"><div><h2>Service-area intelligence</h2><p className="subtle">Use the approved map for service boundaries and the pincode table for actionable volume and ID demand.</p></div><a className="button secondary compact" href="/master/capacity">Manage map data</a></div>
      <div className="capacity-area-grid"><div className="capacity-map-card">
      {stationLayer.features.length ? <CapacityStationLayerMap stationCode={stationCode} features={stationLayer.features}/> : capacityMapUrl ? <iframe title={capacityMap?.name || `${stationCode} service-area map`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" src={capacityMapUrl}/> : latitude && longitude ? <iframe title={`${stationCode} station map`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" src={`https://www.google.com/maps?q=${latitude},${longitude}&z=12&output=embed`}/> : <div className="capacity-map-empty"><strong>Map not configured</strong><span>Add a station or region map in Capacity Master.</span></div>}
      <div className="capacity-map-meta"><strong>{capacityMap?.name || `${stationCode} service area`}</strong><span>{stationMap?.address || location.city || "Station coordinates not configured"}</span>{capacityMap ? <a href={capacityMap.mapUrl} target="_blank" rel="noreferrer">Open full map</a> : null}</div>
      </div>
      <div className="capacity-rate-list">{rateCards.flatMap((card) => (card.rate_card_lines ?? []).map((line) => <article key={`${card.id}-${line.metric_code}`}><div><strong>{line.metric_code.replace(/_/g, " ")}</strong><span>{card.name} · {card.pay_type || "Pay type not set"}</span></div><b>₹{fmt(num(line.rate), 2)} {line.unit || ""}</b></article>))}{!rateCards.length ? <div className="capacity-map-empty"><strong>No approved station rate card</strong><span>Configure bike/van and delivery rates before the hiring team uses pay guidance.</span></div> : null}<div className="capacity-source-gap"><strong>{pincodes.length} delivery pincodes detected</strong><span>{pincodeDelivered ? `${fmt(pincodeDelivered)} shipments mapped by pincode. ` : ""}{weightReady ? `${fmt(weightReady)} have weight; ` : ""}{dimensionReady ? `${fmt(dimensionReady)} have complete dimensions. ` : ""}Vehicle type is not present in the source, so bike/van capacity still requires an Area Capacity Master.</span></div></div>
    </div>{serviceRouteResult.rows.length ? <CapacityServiceMap routes={serviceRouteResult.rows} station={latitude && longitude ? { lat: latitude, lng: longitude, label: stationCode } : null}/> : null}</section>
    <section className="panel"><div className="panel-head"><div><h2>Service-area demand</h2><p className="subtle">Action view: volume concentration, serving IDs and shipment-size mix. Select a count to inspect tracking IDs.</p></div><span className="status-pill neutral">{pincodes.length} pincodes</span></div><div className="table-wrap"><table className="capacity-daily-table"><thead><tr><th>Pincode</th><th>Delivered</th><th>Station share</th><th>Serving IDs</th><th>Volumetric</th><th>Small</th><th>Unclassified</th></tr></thead><tbody>{pincodes.slice(0, 25).map((row) => <tr key={row.postal_code}><td><strong>{row.postal_code}</strong></td><td><a href={`/ops-pulse/capacity/shipments?station=${stationCode}&pincode=${row.postal_code}&from=${start}&to=${end}`}>{fmt(num(row.delivered))}</a></td><td>{pincodeDelivered ? `${fmt(num(row.delivered) / pincodeDelivered * 100, 1)}%` : "—"}</td><td>{fmt(num(row.active_ids))}</td><td><a href={`/ops-pulse/capacity/shipments?station=${stationCode}&pincode=${row.postal_code}&size=volumetric&from=${start}&to=${end}`}>{fmt(num(row.volumetric))} · {num(row.delivered) ? `${fmt(num(row.volumetric) / num(row.delivered) * 100, 1)}%` : "—"}</a></td><td><a href={`/ops-pulse/capacity/shipments?station=${stationCode}&pincode=${row.postal_code}&size=small&from=${start}&to=${end}`}>{fmt(num(row.small))} · {num(row.delivered) ? `${fmt(num(row.small) / num(row.delivered) * 100, 1)}%` : "—"}</a></td><td className={num(row.unclassified) ? "metric-bad-text" : ""}>{fmt(num(row.unclassified))}</td></tr>)}{!pincodes.length ? <tr><td className="empty-cell" colSpan={7}>No pincode-level shipment facts are available for this range.</td></tr> : null}</tbody></table></div></section>
  </div></AppShell>;
}
