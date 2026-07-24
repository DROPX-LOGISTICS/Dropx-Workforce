import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import {
  inferFormTypeFromLocation,
  loadCodLocations,
  locationLabel,
  locationModelName
} from "@/lib/ops-pulse/cod";
import { supabaseAdmin } from "@/lib/supabase-admin";

type SearchParams = {
  client?: string;
  cluster?: string;
  date?: string;
  region?: string;
  station?: string;
  type?: string;
};

type ShipmentFact = {
  client: string | null;
  shipment_type: string | null;
  station_code: string;
  total_activity: number | string | null;
  total_delivery: number | string | null;
  work_date: string;
};

export const dynamic = "force-dynamic";

function istDate() {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Kolkata",
    year: "numeric"
  }).format(new Date());
}

function safeDate(value: string | undefined) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? String(value) : istDate();
}

function dateParts(value: string) {
  const [year, month] = value.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    monthEnd: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    monthStart: `${year}-${String(month).padStart(2, "0")}-01`,
    yearStart: `${year}-01-01`
  };
}

function volume(rows: ShipmentFact[], from: string, to: string) {
  return rows.reduce((sum, row) => {
    if (row.work_date < from || row.work_date > to) return sum;
    return sum + Number(row.total_delivery ?? 0);
  }, 0);
}

function activity(rows: ShipmentFact[], from: string, to: string) {
  return rows.reduce((sum, row) => {
    if (row.work_date < from || row.work_date > to) return sum;
    return sum + Number(row.total_activity ?? 0);
  }, 0);
}

function formatCount(value: number) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value);
}

async function loadShipmentFacts(
  companyId: string,
  stationCodes: string[],
  filters: { client: string; from: string; to: string; type: string }
) {
  if (!supabaseAdmin || !stationCodes.length) {
    return { error: supabaseAdmin ? null : "Supabase administration connection is unavailable.", rows: [] as ShipmentFact[] };
  }

  const rows: ShipmentFact[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 50000; from += pageSize) {
    let query = supabaseAdmin
      .from("cps_shipment_daily")
      .select("client,shipment_type,station_code,total_activity,total_delivery,work_date")
      .eq("company_id", companyId)
      .in("station_code", stationCodes)
      .gte("work_date", filters.from)
      .lte("work_date", filters.to)
      .order("work_date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (filters.client) query = query.ilike("client", filters.client);
    if (filters.type) query = query.ilike("shipment_type", filters.type);
    const { data, error } = await query;
    if (error) return { error: error.message, rows };
    const page = (data ?? []) as ShipmentFact[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return { error: null, rows };
}

export default async function OpsPulsePage({ searchParams }: { searchParams?: SearchParams }) {
  const authorization = await requirePagePermission("ops_pulse", "access");
  const companyId = requireCompanyId(authorization);
  const { locations, error: locationsError } = await loadCodLocations(
    companyId,
    authorization.locationScopeIds,
    authorization.hasAllLocationAccess
  );

  const selectedDate = safeDate(searchParams?.date);
  const selectedRegion = String(searchParams?.region ?? "");
  const selectedCluster = String(searchParams?.cluster ?? "");
  const selectedStation = String(searchParams?.station ?? "");
  const selectedClient = ["amazon", "flipkart"].includes(searchParams?.client ?? "") ? String(searchParams?.client) : "";
  const selectedType = String(searchParams?.type ?? "");
  const { monthEnd, monthStart, yearStart } = dateParts(selectedDate);

  const regions = [...new Set(locations.map((row) => row.region?.trim()).filter(Boolean) as string[])].sort();
  const regionLocations = selectedRegion ? locations.filter((row) => row.region === selectedRegion) : locations;
  const clusters = [...new Set(regionLocations.map((row) => row.cluster?.trim()).filter(Boolean) as string[])].sort();
  const clusterLocations = selectedCluster ? regionLocations.filter((row) => row.cluster === selectedCluster) : regionLocations;
  const clientLocations = selectedClient
    ? clusterLocations.filter((row) => inferFormTypeFromLocation(row) === selectedClient)
    : clusterLocations;
  const stationLocations = selectedStation
    ? clientLocations.filter((row) => row.station_code === selectedStation)
    : clientLocations;
  const modelLocations = selectedType
    ? stationLocations.filter((row) => locationModelName(row) === selectedType)
    : stationLocations;
  const stationCodes = [...new Set(modelLocations.map((row) => row.station_code).filter(Boolean))];
  const types = [...new Set(clusterLocations.map(locationModelName).filter(Boolean))].sort();

  const factsResult = await loadShipmentFacts(companyId, stationCodes, {
    client: selectedClient,
    from: yearStart,
    to: monthEnd > selectedDate ? monthEnd : selectedDate,
    type: selectedType
  });
  const facts = factsResult.rows;
  const dayVolume = volume(facts, selectedDate, selectedDate);
  const monthVolume = volume(facts, monthStart, monthEnd);
  const mtdVolume = volume(facts, monthStart, selectedDate);
  const ytdVolume = volume(facts, yearStart, selectedDate);
  const dayActivity = activity(facts, selectedDate, selectedDate);

  const stationRows = modelLocations.map((location) => {
    const rows = facts.filter((row) => row.station_code === location.station_code);
    return {
      client: inferFormTypeFromLocation(location) || "Unmapped",
      cluster: location.cluster || "-",
      day: volume(rows, selectedDate, selectedDate),
      mtd: volume(rows, monthStart, selectedDate),
      month: volume(rows, monthStart, monthEnd),
      region: location.region || "-",
      station: location,
      type: locationModelName(location) || "-"
    };
  }).sort((a, b) => b.day - a.day || b.mtd - a.mtd);

  return (
    <AppShell active="Dashboard" pageCode="ops_pulse">
      <PageHead
        eyebrow="DropX Operations"
        title="Operations Dashboard"
        subtitle="Permission-scoped shipment volume across stations, regions, clusters, clients, and operation types."
        action={<a className="button secondary" href="https://dashboard.dropxlogistics.com/dashboard">Open main dashboard</a>}
      />

      {locationsError || factsResult.error ? (
        <section className="panel message-panel error">
          <div className="panel-body"><strong>Some dashboard data could not be loaded</strong><p className="subtle">{locationsError ?? factsResult.error}</p></div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-head"><div><h2>Volume filters</h2><p className="subtle">Region and Cluster come directly from Station Master and remain permission-scoped.</p></div></div>
        <div className="panel-body">
          <form action="/ops-pulse" className="form-grid five report-filter-grid">
            <label>As of date<input className="field" name="date" type="date" defaultValue={selectedDate} /></label>
            <label>Region
              <select className="field" name="region" defaultValue={selectedRegion}>
                <option value="">All regions</option>
                {regions.map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label>Cluster
              <select className="field" name="cluster" defaultValue={selectedCluster}>
                <option value="">All clusters</option>
                {clusters.map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label>Station
              <select className="field" name="station" defaultValue={selectedStation}>
                <option value="">All permitted stations</option>
                {clientLocations.map((location) => <option key={location.id} value={location.station_code}>{locationLabel(location)}</option>)}
              </select>
            </label>
            <label>Client
              <select className="field" name="client" defaultValue={selectedClient}>
                <option value="">All clients</option>
                <option value="amazon">Amazon</option>
                <option value="flipkart">Flipkart</option>
              </select>
            </label>
            <label>Type / Model
              <select className="field" name="type" defaultValue={selectedType}>
                <option value="">All types</option>
                {types.map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <div className="form-actions span-5 align-right">
              <Link className="button ghost" href="/ops-pulse">Reset</Link>
              <button className="button secondary" type="submit">Apply filters</button>
            </div>
          </form>
        </div>
      </section>

      <section className="summary-grid">
        <div className="metric-card"><span>Day volume</span><strong>{formatCount(dayVolume)}</strong><small>{selectedDate} · activity {formatCount(dayActivity)}</small></div>
        <div className="metric-card"><span>Month volume</span><strong>{formatCount(monthVolume)}</strong><small>Full calendar month</small></div>
        <div className="metric-card"><span>MTD volume</span><strong>{formatCount(mtdVolume)}</strong><small>{monthStart} to {selectedDate}</small></div>
        <div className="metric-card"><span>YTD volume</span><strong>{formatCount(ytdVolume)}</strong><small>{yearStart} to {selectedDate}</small></div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div><h2>Station performance</h2><p className="subtle">Delivery volume from imported shipment data; zero is retained when a permitted station has no matching rows.</p></div>
          <span className="count-badge">{stationRows.length} stations</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Station</th><th>Region</th><th>Cluster</th><th>Client</th><th>Type</th><th>Day</th><th>Month</th><th>MTD</th><th>YTD</th></tr></thead>
            <tbody>
              {stationRows.map((row) => (
                <tr key={row.station.id}>
                  <td><strong>{locationLabel(row.station)}</strong></td><td>{row.region}</td><td>{row.cluster}</td>
                  <td style={{ textTransform: "capitalize" }}>{row.client}</td><td>{row.type}</td>
                  <td>{formatCount(row.day)}</td><td>{formatCount(row.month)}</td><td>{formatCount(row.mtd)}</td>
                  <td>{formatCount(volume(facts.filter((fact) => fact.station_code === row.station.station_code), yearStart, selectedDate))}</td>
                </tr>
              ))}
              {!stationRows.length ? <tr><td colSpan={9} className="empty-state">No permitted stations match these filters.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><div><h2>Client workflows</h2><p className="subtle">Continue into the client-specific daily operations and COD controls.</p></div></div>
        <div className="panel-body">
          <div className="form-actions">
            {locations.some((row) => inferFormTypeFromLocation(row) === "amazon") ? <Link className="button" href="/ops-pulse/client/amazon">Amazon Operations</Link> : null}
            {locations.some((row) => inferFormTypeFromLocation(row) === "flipkart") ? <Link className="button secondary" href="/ops-pulse/client/flipkart">Flipkart Operations</Link> : null}
          </div>
        </div>
      </section>
    </AppShell>
  );
}
