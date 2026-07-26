import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { CapacityWorkspaceTabs } from "@/components/capacity-workspace-tabs";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadCapacityAssociateDays, loadCapacityStationDays } from "@/lib/ops-pulse/capacity-shipments";
import { loadCodLocations } from "@/lib/ops-pulse/cod";
import { operatingModeForLocation, resolveOperatingContext } from "@/lib/ops-pulse/operating-context";

export const dynamic = "force-dynamic";

type SearchParams = { from?: string; to?: string; station?: string; day?: string; sort?: string; dir?: string };
function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()); }
function validDate(value: unknown, fallback: string) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) ? String(value) : fallback; }
function num(value: unknown) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function fmt(value: number, digits = 0) { return value.toLocaleString("en-IN", { maximumFractionDigits: digits }); }

export default async function DeliveryDataPage({ searchParams }: { searchParams?: SearchParams }) {
  const authorization = await requirePagePermission("cps_shipments", "access");
  const companyId = requireCompanyId(authorization);
  const locationsResult = await loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess);
  const locations = resolveOperatingContext(locationsResult.locations).selectedLocations
    .filter((location) => operatingModeForLocation(location) !== "amazon_now");
  const codes = locations.map((location) => location.station_code);
  const selectedStation = codes.includes(String(searchParams?.station ?? "").toUpperCase()) ? String(searchParams?.station).toUpperCase() : "";
  const selectedDay = /^\d{4}-\d{2}-\d{2}$/.test(String(searchParams?.day ?? "")) ? String(searchParams?.day) : "";
  const to = validDate(searchParams?.to, today());
  const from = validDate(searchParams?.from, `${to.slice(0, 7)}-01`);
  const sort = ["delivered", "activeIds", "days", "average", "spr"].includes(String(searchParams?.sort)) ? String(searchParams?.sort) : "delivered";
  const dir = searchParams?.dir === "asc" ? "asc" : "desc";
  const [dailyResult, associateResult] = await Promise.all([
    loadCapacityStationDays(companyId, codes, from, to),
    loadCapacityAssociateDays(companyId, selectedStation ? [selectedStation] : [], from, to)
  ]);
  const daily = dailyResult.data ?? [];
  const associates = associateResult.data ?? [];
  const locationMap = new Map(locations.map((location) => [location.station_code, location]));
  const stationRows = codes.map((code) => {
    const rows = daily.filter((row) => row.station_code === code);
    const delivered = rows.reduce((sum, row) => sum + num(row.delivered), 0);
    const activeIds = Math.max(0, ...rows.map((row) => num(row.active_ids)));
    const average = rows.length ? delivered / rows.length : 0;
    const averageIds = rows.length ? rows.reduce((sum, row) => sum + num(row.active_ids), 0) / rows.length : 0;
    return { code, name: locationMap.get(code)?.station_name || locationMap.get(code)?.city || code, delivered, activeIds, days: rows.length, average, spr: averageIds ? average / averageIds : 0 };
  }).filter((row) => row.days);
  const sortValue = (row: typeof stationRows[number]) => num(row[sort as keyof typeof row]);
  stationRows.sort((a, b) => (sortValue(a) - sortValue(b)) * (dir === "asc" ? 1 : -1));
  const stationDaily = selectedStation ? daily.filter((row) => row.station_code === selectedStation).sort((a, b) => b.work_date.localeCompare(a.work_date)) : [];
  const dayAssociates = selectedStation && selectedDay ? associates.filter((row) => row.work_date === selectedDay).sort((a, b) => num(b.delivered) - num(a.delivered)) : [];
  const totalDelivered = daily.reduce((sum, row) => sum + num(row.delivered), 0);
  const latestDate = daily.map((row) => row.work_date).sort().at(-1) ?? null;
  const latestActiveIds = latestDate ? daily.filter((row) => row.work_date === latestDate).reduce((sum, row) => sum + num(row.active_ids), 0) : 0;
  const sourceDays = new Set(daily.map((row) => row.work_date)).size;
  const base = `from=${from}&to=${to}`;
  const sortHref = (label: string, key: string) => <Link href={`/ops-pulse/performance/shipments?${base}&sort=${key}&dir=${sort === key && dir === "desc" ? "asc" : "desc"}`}>{label}{sort === key ? dir === "desc" ? " ↓" : " ↑" : " ↕"}</Link>;

  return <AppShell active="Capacity" pageCode="cps_shipments"><div className="ops-command-center shipment-workspace">
    <PageHead eyebrow="Capacity" title="Delivery Data" subtitle="Delivered shipment facts, road-active IDs and associate workload supporting capacity decisions." />
    <CapacityWorkspaceTabs active="delivery" />
    <section className="ops-control-strip"><div className="ops-context-summary"><span>{selectedDay ? "Associate detail" : selectedStation ? "Daily detail" : "Station overview"}</span><strong>{selectedDay || selectedStation || `${stationRows.length} stations with data`}</strong><small>{from} to {to}</small></div><form className="ops-date-controls"><label>From<input name="from" type="date" defaultValue={from}/></label><label>To<input name="to" type="date" defaultValue={to}/></label><button>Apply range</button></form></section>
    <nav className="shipment-breadcrumbs"><Link href={`/ops-pulse/performance/shipments?${base}`}>All stations</Link>{selectedStation ? <><span>›</span><Link href={`/ops-pulse/performance/shipments?${base}&station=${selectedStation}`}>{selectedStation}</Link></> : null}{selectedDay ? <><span>›</span><strong>{selectedDay}</strong></> : null}</nav>
    {locationsResult.error || dailyResult.error || associateResult.error ? <section className="panel message-panel error"><div className="panel-body">{locationsResult.error || dailyResult.error?.message || associateResult.error?.message}</div></section> : null}
    <section className="performance-summary-grid shipment-summary-grid"><article><span>Delivered</span><strong>{fmt(totalDelivered)}</strong><small>Tracking shipments in range</small></article><article><span>Latest road IDs</span><strong>{fmt(latestActiveIds)}</strong><small>{latestDate || "No source date"}</small></article><article><span>Source days</span><strong>{sourceDays}</strong><small>Distinct delivered dates</small></article><article><span>Stations covered</span><strong>{stationRows.length}</strong><small>{codes.length} eligible stations</small></article></section>
    {!selectedStation ? <section className="panel"><div className="panel-head"><div><h2>Station delivery capacity</h2><p className="subtle">Select a station for day and associate-level detail. XPT shipments are included under their parent station.</p></div></div><div className="table-wrap"><table className="shipment-table"><thead><tr><th>Station</th><th>{sortHref("Delivered", "delivered")}</th><th>{sortHref("Peak road IDs", "activeIds")}</th><th>{sortHref("Source days", "days")}</th><th>{sortHref("Average/day", "average")}</th><th>{sortHref("Average SPR", "spr")}</th></tr></thead><tbody>{stationRows.map((row) => <tr key={row.code}><td><Link href={`/ops-pulse/performance/shipments?${base}&station=${row.code}`}><strong>{row.code}</strong><small>{row.name}</small></Link></td><td>{fmt(row.delivered)}</td><td>{fmt(row.activeIds)}</td><td>{row.days}</td><td>{fmt(row.average)}</td><td><strong>{fmt(row.spr, 1)}</strong></td></tr>)}{!stationRows.length ? <tr><td className="empty-cell" colSpan={6}>No delivered shipment facts are available in this range.</td></tr> : null}</tbody></table></div></section> : null}
    {selectedStation && !selectedDay ? <section className="panel"><div className="panel-head"><div><h2>{selectedStation} day-level capacity</h2><p className="subtle">Select a date to inspect every road-active associate and allocation.</p></div></div><div className="table-wrap"><table className="shipment-table"><thead><tr><th>Date</th><th>Road-active IDs</th><th>Delivered</th><th>SPR</th></tr></thead><tbody>{stationDaily.map((row) => <tr key={row.work_date}><td><Link href={`/ops-pulse/performance/shipments?${base}&station=${selectedStation}&day=${row.work_date}`}><strong>{row.work_date.split("-").reverse().join("/")}</strong></Link></td><td>{fmt(num(row.active_ids))}</td><td>{fmt(num(row.delivered))}</td><td><strong>{num(row.active_ids) ? fmt(num(row.delivered) / num(row.active_ids), 1) : "—"}</strong></td></tr>)}{!stationDaily.length ? <tr><td className="empty-cell" colSpan={4}>No delivered shipment facts are available for this station.</td></tr> : null}</tbody></table></div></section> : null}
    {selectedStation && selectedDay ? <section className="panel"><div className="panel-head"><div><h2>Associate allocation</h2><p className="subtle">{selectedStation} · {selectedDay}. Sorted by delivered workload.</p></div><span className="status-pill neutral">{dayAssociates.length} road-active IDs</span></div><div className="table-wrap"><table className="shipment-table"><thead><tr><th>Associate</th><th>Delivered</th><th>Workload position</th></tr></thead><tbody>{dayAssociates.map((row) => <tr key={row.associate_id}><td><Link href={`/ops-pulse/capacity/associates/${encodeURIComponent(row.associate_id)}?station=${selectedStation}&from=${from}&to=${to}`}><strong>{row.associate_name || row.associate_id}</strong><small>{row.associate_name ? row.associate_id : "Associate ID"}</small></Link></td><td><strong>{fmt(num(row.delivered))}</strong></td><td><span className={`capacity-decision ${num(row.delivered) > 70 ? "risk" : num(row.delivered) < 60 ? "unconfigured" : "balanced"}`}>{num(row.delivered) > 70 ? "Above safe" : num(row.delivered) < 60 ? "Below target" : "Target range"}</span></td></tr>)}</tbody></table></div></section> : null}
  </div></AppShell>;
}
