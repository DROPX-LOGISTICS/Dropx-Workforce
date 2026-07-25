import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { CapacityWorkspaceTabs } from "@/components/capacity-workspace-tabs";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadCodLocations } from "@/lib/ops-pulse/cod";
import { resolveOperatingContext } from "@/lib/ops-pulse/operating-context";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type SearchParams = { from?: string; to?: string; station?: string; day?: string; sort?: string; dir?: string };
type ShipmentRow = {
  work_date: string;
  station_code: string;
  provider_employee_id: string;
  provider_employee_name: string | null;
  assigned_count: number | string | null;
  amazon_delivery: number | string | null;
  swa_delivery: number | string | null;
  c_return: number | string | null;
  mfn: number | string | null;
  mfn_return: number | string | null;
  total_delivery: number | string | null;
  total_activity: number | string | null;
};
type Totals = { assigned: number; delivery: number; swa: number; cReturn: number; mfn: number; mfnReturn: number; totalDelivery: number; totalActivity: number };
const shipmentPageSize = 1000;

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}
function date(value: string | undefined, fallback: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? String(value) : fallback;
}
function n(value: unknown) { return Number(value ?? 0); }
function emptyTotals(): Totals { return { assigned: 0, delivery: 0, swa: 0, cReturn: 0, mfn: 0, mfnReturn: 0, totalDelivery: 0, totalActivity: 0 }; }
function add(total: Totals, row: ShipmentRow) {
  total.assigned += n(row.assigned_count); total.delivery += n(row.amazon_delivery); total.swa += n(row.swa_delivery);
  total.cReturn += n(row.c_return); total.mfn += n(row.mfn); total.mfnReturn += n(row.mfn_return);
  total.totalDelivery += n(row.total_delivery); total.totalActivity += n(row.total_activity);
  return total;
}
function fmt(value: number) { return value.toLocaleString("en-IN", { maximumFractionDigits: 0 }); }
function deliveryRate(row: Totals) { return row.assigned ? row.totalDelivery / row.assigned : 0; }

async function loadShipmentRows(companyId: string, stationCodes: string[], from: string, to: string) {
  const rows: ShipmentRow[] = [];
  for (let start = 0; ; start += shipmentPageSize) {
    const result = await supabaseAdmin!
      .from("cps_shipment_daily")
      .select("work_date,station_code,provider_employee_id,provider_employee_name,assigned_count,amazon_delivery,swa_delivery,c_return,mfn,mfn_return,total_delivery,total_activity")
      .eq("company_id", companyId)
      .in("station_code", stationCodes)
      .gte("work_date", from)
      .lte("work_date", to)
      .order("work_date", { ascending: false })
      .order("station_code")
      .order("provider_employee_id")
      .range(start, start + shipmentPageSize - 1);
    if (result.error) return { data: rows, error: result.error };
    const page = (result.data ?? []) as ShipmentRow[];
    rows.push(...page);
    if (page.length < shipmentPageSize) return { data: rows, error: null };
  }
}

export default async function DeliveryDataPage({ searchParams }: { searchParams?: SearchParams }) {
  const authorization = await requirePagePermission("cps_shipments", "access");
  const companyId = requireCompanyId(authorization);
  const locationsResult = await loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess);
  const context = resolveOperatingContext(locationsResult.locations);
  const permitted = context.selectedLocations;
  const permittedCodes = permitted.map((location) => location.station_code);
  const selectedStation = permittedCodes.includes(String(searchParams?.station ?? "").toUpperCase()) ? String(searchParams?.station).toUpperCase() : "";
  const selectedDay = date(searchParams?.day, "");
  const to = date(searchParams?.to, today());
  const from = date(searchParams?.from, `${to.slice(0, 7)}-01`);
  const sort = searchParams?.sort || "totalDelivery";
  const direction = searchParams?.dir === "asc" ? 1 : -1;

  const result = !supabaseAdmin || !permittedCodes.length
    ? { data: [] as ShipmentRow[], error: null }
    : await loadShipmentRows(companyId, permittedCodes, from, to);
  const rows = (result.data ?? []) as ShipmentRow[];
  const locationMap = new Map(permitted.map((location) => [location.station_code, location]));
  const stationMap = new Map<string, Totals>();
  rows.forEach((row) => stationMap.set(row.station_code, add(stationMap.get(row.station_code) ?? emptyTotals(), row)));
  const stationRows = [...stationMap.entries()].map(([code, totals]) => ({ code, name: locationMap.get(code)?.station_name || locationMap.get(code)?.city || code, ...totals }))
    .sort((a, b) => direction * (n(a[sort as keyof typeof a]) - n(b[sort as keyof typeof b])));
  const stationFacts = selectedStation ? rows.filter((row) => row.station_code === selectedStation) : [];
  const dayMap = new Map<string, Totals>();
  stationFacts.forEach((row) => dayMap.set(row.work_date, add(dayMap.get(row.work_date) ?? emptyTotals(), row)));
  const dayRows = [...dayMap.entries()].map(([workDate, totals]) => ({ workDate, ...totals })).sort((a, b) => b.workDate.localeCompare(a.workDate));
  const daRows = selectedStation && selectedDay ? stationFacts.filter((row) => row.work_date === selectedDay) : [];
  const grandTotal = rows.reduce((total, row) => add(total, row), emptyTotals());
  const base = `from=${from}&to=${to}`;
  const sortable = (label: string, field: string) => <Link href={`/ops-pulse/performance/shipments?${base}&sort=${field}&dir=${sort === field && direction === -1 ? "asc" : "desc"}`}>{label}{sort === field ? direction === -1 ? " ↓" : " ↑" : ""}</Link>;

  return (
    <AppShell active="Capacity" pageCode="cps_shipments">
      <div className="ops-command-center shipment-workspace">
        <PageHead eyebrow="Capacity" title="Delivery Data" subtitle="Station, day and delivery-associate workload detail supporting capacity decisions." />
        <CapacityWorkspaceTabs active="delivery" />
        <section className="ops-control-strip">
          <div className="ops-context-summary"><span>{selectedDay ? "DA detail" : selectedStation ? "Daily detail" : "Station overview"}</span><strong>{selectedDay || selectedStation || `${stationRows.length} stations`}</strong><small>{from} to {to}</small></div>
          <form className="ops-date-controls"><label>From<input name="from" type="date" defaultValue={from} /></label><label>To<input name="to" type="date" defaultValue={to} /></label><button>Apply range</button></form>
        </section>
        <nav className="shipment-breadcrumbs"><Link href={`/ops-pulse/performance/shipments?${base}`}>All stations</Link>{selectedStation ? <><span>›</span><Link href={`/ops-pulse/performance/shipments?${base}&station=${selectedStation}`}>{selectedStation}</Link></> : null}{selectedDay ? <><span>›</span><strong>{selectedDay}</strong></> : null}</nav>
        {result.error ? <section className="panel message-panel error"><div className="panel-body">{result.error.message}</div></section> : null}
        <section className="performance-summary-grid shipment-summary-grid">
          <article><span>Assigned</span><strong>{fmt(grandTotal.assigned)}</strong><small>Assigned packages</small></article>
          <article><span>Delivered</span><strong>{fmt(grandTotal.delivery)}</strong><small>Delivered packages</small></article>
          <article><span>SWA</span><strong>{fmt(grandTotal.swa)}</strong><small>Ship With Amazon</small></article>
          <article><span>Total activity</span><strong>{fmt(grandTotal.totalActivity)}</strong><small>All package activity</small></article>
        </section>

        {!selectedStation ? <section className="panel"><div className="panel-head"><div><h2>Station shipment table</h2><p className="subtle">Select a station to open its day-level activity.</p></div></div><div className="performance-matrix-wrap"><table className="shipment-table"><thead><tr><th>Station</th><th>{sortable("Assigned", "assigned")}</th><th>{sortable("Delivered", "delivery")}</th><th>{sortable("SWA", "swa")}</th><th>{sortable("C-Return", "cReturn")}</th><th>{sortable("MFN", "mfn")}</th><th>{sortable("MFN Return", "mfnReturn")}</th><th>{sortable("Total delivery", "totalDelivery")}</th><th>{sortable("Total activity", "totalActivity")}</th><th>Delivery rate</th></tr></thead><tbody>{stationRows.map((row) => <tr key={row.code}><td><Link href={`/ops-pulse/performance/shipments?${base}&station=${row.code}`}><strong>{row.code}</strong><small>{row.name}</small></Link></td><td>{fmt(row.assigned)}</td><td>{fmt(row.delivery)}</td><td>{fmt(row.swa)}</td><td>{fmt(row.cReturn)}</td><td>{fmt(row.mfn)}</td><td>{fmt(row.mfnReturn)}</td><td>{fmt(row.totalDelivery)}</td><td>{fmt(row.totalActivity)}</td><td>{row.assigned ? `${(deliveryRate(row) * 100).toFixed(1)}%` : "—"}</td></tr>)}</tbody></table></div></section> : null}

        {selectedStation && !selectedDay ? <section className="panel"><div className="panel-head"><div><h2>{selectedStation} day-level activity</h2><p className="subtle">Select a date to open DA-level delivery and return activity.</p></div></div><div className="table-wrap"><table className="shipment-table"><thead><tr><th>Date</th><th>Assigned</th><th>Delivered</th><th>SWA</th><th>C-Return</th><th>MFN</th><th>MFN Return</th><th>Total activity</th><th>Delivery rate</th></tr></thead><tbody>{dayRows.map((row) => <tr key={row.workDate}><td><Link href={`/ops-pulse/performance/shipments?${base}&station=${selectedStation}&day=${row.workDate}`}><strong>{row.workDate}</strong></Link></td><td>{fmt(row.assigned)}</td><td>{fmt(row.delivery)}</td><td>{fmt(row.swa)}</td><td>{fmt(row.cReturn)}</td><td>{fmt(row.mfn)}</td><td>{fmt(row.mfnReturn)}</td><td>{fmt(row.totalActivity)}</td><td>{row.assigned ? `${(deliveryRate(row) * 100).toFixed(1)}%` : "—"}</td></tr>)}</tbody></table></div></section> : null}

        {selectedStation && selectedDay ? <section className="panel"><div className="panel-head"><div><h2>DA shipment detail</h2><p className="subtle">{selectedStation} · {selectedDay}. This row is ready to link with DA-level CPS when payout costs are opened from CPS.</p></div></div><div className="performance-matrix-wrap"><table className="shipment-table"><thead><tr><th>Provider ID / DA</th><th>Assigned</th><th>Delivered</th><th>SWA</th><th>C-Return</th><th>MFN</th><th>MFN Return</th><th>Total delivery</th><th>Total activity</th><th>Delivery rate</th></tr></thead><tbody>{daRows.map((row) => { const totals = add(emptyTotals(), row); return <tr key={`${row.provider_employee_id}-${row.work_date}`}><td><strong>{row.provider_employee_name || row.provider_employee_id}</strong><small>{row.provider_employee_name ? row.provider_employee_id : "Provider ID"}</small></td><td>{fmt(totals.assigned)}</td><td>{fmt(totals.delivery)}</td><td>{fmt(totals.swa)}</td><td>{fmt(totals.cReturn)}</td><td>{fmt(totals.mfn)}</td><td>{fmt(totals.mfnReturn)}</td><td>{fmt(totals.totalDelivery)}</td><td>{fmt(totals.totalActivity)}</td><td>{totals.assigned ? `${(deliveryRate(totals) * 100).toFixed(1)}%` : "—"}</td></tr>; })}</tbody></table></div></section> : null}
      </div>
    </AppShell>
  );
}
