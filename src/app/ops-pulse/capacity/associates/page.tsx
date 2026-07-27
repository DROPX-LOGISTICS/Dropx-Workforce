import { AppShell } from "@/components/app-shell";
import { CapacityScopeFilter } from "@/components/capacity-scope-filter";
import { CapacityAssociateFilters } from "@/components/capacity-associate-filters";
import { CapacityWorkspaceTabs } from "@/components/capacity-workspace-tabs";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadCapacityRules } from "@/lib/ops-pulse/capacity";
import { capacityWorkload, loadShipmentCountAssociateDays } from "@/lib/ops-pulse/capacity-shipments";
import { loadCodLocations } from "@/lib/ops-pulse/cod";
import { isAmazonEdspXptLocation } from "@/lib/ops-pulse/operating-context";
import { associateIdentityKey, isScientificAssociateId, normalizeAssociateName } from "@/lib/ops-pulse/associate-identity";

export const dynamic = "force-dynamic";
type SearchParams = { from?: string; to?: string; preset?: string; station?: string; stations?: string; band?: string; sort?: string; dir?: string };
function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()); }
function shift(value: string, days: number) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function yesterday() { return shift(today(), -1); }
function valid(value: unknown) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")); }
function fmt(value: number, digits = 0) { return value.toLocaleString("en-IN", { maximumFractionDigits: digits }); }
function scopeCodes(value: string | undefined, allowed: string[]) {
  if (!value) return allowed;
  if (value === "_none") return [];
  const requested = value.split(",").map((code) => code.trim().toUpperCase());
  return allowed.filter((code) => requested.includes(code));
}

export default async function SprAssociatesPage({ searchParams }: { searchParams?: SearchParams }) {
  const authorization = await requirePagePermission("cps_associates", "access");
  const companyId = requireCompanyId(authorization);
  const locationResult = await loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess);
  const locations = locationResult.locations.filter(isAmazonEdspXptLocation);
  const requestedStation = String(searchParams?.station ?? "").trim().toUpperCase();
  const selectedStation = locations.some((location) => location.station_code === requestedStation) ? requestedStation : "";
  const selectedCodes = selectedStation ? [selectedStation] : scopeCodes(searchParams?.stations, locations.map((location) => location.station_code));
  const queryLocations = locations.filter((location) => selectedCodes.includes(location.station_code));
  const band = ["all", "low", "target", "high"].includes(String(searchParams?.band)) ? String(searchParams?.band) : "all";
  const sort = ["name", "average", "peak", "delivered", "days", "highDays", "station", "level"].includes(String(searchParams?.sort)) ? String(searchParams?.sort) : "average";
  const dir = searchParams?.dir === "asc" ? "asc" : "desc";
  const end = valid(searchParams?.to) ? String(searchParams?.to) : yesterday();
  const preset = ["yesterday", "wtd", "mtd", "ytd", "custom"].includes(String(searchParams?.preset)) ? String(searchParams?.preset) : "yesterday";
  const weekday = new Date(`${end}T00:00:00Z`).getUTCDay();
  const start = preset === "custom" && valid(searchParams?.from) ? String(searchParams?.from)
    : preset === "yesterday" ? end
    : preset === "wtd" ? shift(end, -((weekday + 6) % 7))
    : preset === "ytd" ? `${end.slice(0, 4)}-01-01` : `${end.slice(0, 8)}01`;
  const [ruleResult, associateResult] = await Promise.all([
    loadCapacityRules(companyId),
    loadShipmentCountAssociateDays(companyId, queryLocations.map((location) => location.station_code), start, end)
  ]);
  const rows = associateResult.data ?? [];
  const ruleMap = new Map(ruleResult.rows.map((rule) => [rule.stationCode, rule]));
  const aggregateMap = new Map<string, { stationCode: string; id: string; name: string; daily: Map<string, number>; delivered: number }>();
  rows.forEach((row) => {
    const associateId = String(row.provider_employee_id ?? "").trim();
    if (!associateId) return;
    const key = associateIdentityKey(row.station_code, associateId, row.provider_employee_name);
    const current = aggregateMap.get(key) ?? {
      stationCode: row.station_code,
      id: associateId,
      name: row.provider_employee_name || "Unmapped name",
      daily: new Map<string, number>(),
      delivered: 0
    };
    const delivered = capacityWorkload(row);
    current.delivered += delivered;
    current.daily.set(row.work_date, (current.daily.get(row.work_date) ?? 0) + delivered);
    if (current.name === "Unmapped name" && row.provider_employee_name) current.name = row.provider_employee_name;
    aggregateMap.set(key, current);
  });
  const personMap = new Map<string, { stationCode: string; id: string; name: string; daily: Map<string, number> }>();
  aggregateMap.forEach((aggregate) => {
    const normalizedName = normalizeAssociateName(aggregate.name);
    const personKey = normalizedName && aggregate.name !== "Unmapped name"
      ? `${aggregate.stationCode}|${normalizedName}`
      : associateIdentityKey(aggregate.stationCode, aggregate.id, null);
    const current = personMap.get(personKey) ?? {
      stationCode: aggregate.stationCode,
      id: aggregate.id,
      name: aggregate.name,
      daily: new Map<string, number>()
    };
    aggregate.daily.forEach((value, date) => current.daily.set(date, Math.max(current.daily.get(date) ?? 0, value)));
    if (isScientificAssociateId(current.id) && !isScientificAssociateId(aggregate.id)) current.id = aggregate.id;
    personMap.set(personKey, current);
  });
  const allAssociates = [...personMap.values()].map((aggregate) => {
    const daily = [...aggregate.daily.values()];
    const delivered = daily.reduce((sum, value) => sum + value, 0);
    const average = daily.length ? delivered / daily.length : 0;
    const target = ruleMap.get(aggregate.stationCode)?.targetSpr ?? 60;
    const safe = ruleMap.get(aggregate.stationCode)?.maxSafeSpr ?? 70;
    const level = average > safe ? "high" : average < target ? "low" : "target";
    return {
      stationCode: aggregate.stationCode,
      id: aggregate.id,
      name: aggregate.name,
      dates: daily.length,
      delivered,
      average,
      peak: Math.max(0, ...daily),
      highDays: daily.filter((value) => value > safe).length,
      target,
      safe,
      level
    };
  });
  const filteredAssociates = allAssociates.filter((row) => band === "all" || row.level === band);
  const sortValue = (row: typeof allAssociates[number]) => sort === "name" ? row.name : sort === "peak" ? row.peak : sort === "delivered" ? row.delivered : sort === "days" ? row.dates : sort === "highDays" ? row.highDays : sort === "station" ? row.stationCode : sort === "level" ? row.level : row.average;
  const associates = filteredAssociates.sort((a, b) => {
    const left = sortValue(a);
    const right = sortValue(b);
    const compared = typeof left === "string" ? left.localeCompare(String(right)) : Number(left) - Number(right);
    return dir === "asc" ? compared : -compared;
  });
  const lowCount = allAssociates.filter((row) => row.level === "low").length;
  const targetCount = allAssociates.filter((row) => row.level === "target").length;
  const highCount = allAssociates.filter((row) => row.level === "high").length;
  const paramsForSort = new URLSearchParams({ preset, from: start, to: end, band });
  if (selectedStation) paramsForSort.set("station", selectedStation);
  if (searchParams?.stations) paramsForSort.set("stations", searchParams.stations);
  const sortHref = (key: string) => {
    const next = new URLSearchParams(paramsForSort);
    next.set("sort", key);
    next.set("dir", sort === key && dir === "desc" ? "asc" : "desc");
    return `/ops-pulse/capacity/associates?${next.toString()}`;
  };
  const sortMark = (key: string) => sort === key ? (dir === "asc" ? "↑" : "↓") : "↕";
  const scopeStations = locations.map((location) => ({ code: location.station_code, name: location.station_name || location.city || location.station_code, cluster: location.cluster || "", region: location.region || "" }));

  return <AppShell active="Capacity" pageCode="cps_associates"><div className="ops-command-center capacity-workspace">
    <PageHead eyebrow="Associate Productivity" title="Associate SPR" subtitle="Amazon Daily Shipment Count productivity across any station and date range." />
    <div className="capacity-tabs-toolbar"><CapacityWorkspaceTabs active="associates" /><CapacityScopeFilter selectedCodes={selectedCodes} stations={scopeStations}/></div>
    {locationResult.error || ruleResult.error || associateResult.error ? <div className="message-panel error">{locationResult.error || ruleResult.error || associateResult.error?.message}</div> : null}
    <CapacityAssociateFilters band={band} end={end} preset={preset} start={start} stations={searchParams?.stations ?? ""}/>
    <section className="performance-summary-grid"><article><span>All associates</span><strong>{allAssociates.length}</strong><small>{`${queryLocations.length} stations`}</small></article><article><span>Below target</span><strong>{lowCount}</strong><small>Average below station target SPR</small></article><article><span>Target to safe</span><strong>{targetCount}</strong><small>Within configured range</small></article><article><span>Above safe</span><strong>{highCount}</strong><small>Average above safe SPR</small></article></section>
    <section className="panel"><div className="panel-head"><div><h2>Associate productivity</h2><p className="subtle">Source: Amazon Daily Shipment Count. Workload = Delivery + C-Return + SWA; SPR = workload ÷ active days.</p></div><span className="status-pill neutral">{associates.length} shown</span></div><div className="table-wrap"><table className="capacity-daily-table"><thead><tr><th><a href={sortHref("name")}>Associate <small>{sortMark("name")}</small></a></th><th><a href={sortHref("station")}>Station <small>{sortMark("station")}</small></a></th><th><a href={sortHref("days")}>Active days <small>{sortMark("days")}</small></a></th><th><a href={sortHref("delivered")}>Total workload <small>{sortMark("delivered")}</small></a></th><th><a href={sortHref("average")}>Average SPR <small>{sortMark("average")}</small></a></th><th><a href={sortHref("peak")}>Peak <small>{sortMark("peak")}</small></a></th><th><a href={sortHref("highDays")}>High days <small>{sortMark("highDays")}</small></a></th><th><a href={sortHref("level")}>SPR position <small>{sortMark("level")}</small></a></th></tr></thead><tbody>
      {associates.map((row) => <tr key={associateIdentityKey(row.stationCode, row.id, row.name)}><td><a className="capacity-station-link" href={`/ops-pulse/capacity/associates/${encodeURIComponent(row.id)}?station=${row.stationCode}&from=${start}&to=${end}&name=${encodeURIComponent(row.name)}`}><strong>{row.name}</strong><small>{row.id}</small></a></td><td><a href={`/ops-pulse/capacity/${row.stationCode}`}>{row.stationCode}</a></td><td>{row.dates}</td><td>{fmt(row.delivered)}</td><td><strong className={row.level === "high" ? "metric-bad-text" : row.level === "low" ? "metric-warn-text" : "metric-good-text"}>{fmt(row.average, 1)}</strong></td><td>{fmt(row.peak)}</td><td>{row.highDays}</td><td><span className={`capacity-decision ${row.level === "high" ? "risk" : row.level === "low" ? "unconfigured" : "balanced"}`}>{row.level === "high" ? `Above ${fmt(row.safe, 1)}` : row.level === "low" ? `Below ${fmt(row.target, 1)}` : `${fmt(row.target, 1)}–${fmt(row.safe, 1)}`}</span></td></tr>)}
      {!associates.length ? <tr><td className="empty-cell" colSpan={8}>No associates match these filters.</td></tr> : null}
    </tbody></table></div></section>
  </div></AppShell>;
}
