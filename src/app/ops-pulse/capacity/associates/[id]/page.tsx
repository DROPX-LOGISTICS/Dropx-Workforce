import { AppShell } from "@/components/app-shell";
import { CapacityWorkspaceTabs } from "@/components/capacity-workspace-tabs";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadCapacityRules } from "@/lib/ops-pulse/capacity";
import {
  capacityWorkload,
  loadCapacityAssociateDeliveredDaily,
  loadCapacityAssociatePincodes,
  loadShipmentCountAssociateDays
} from "@/lib/ops-pulse/capacity-shipments";
import { loadCodLocations } from "@/lib/ops-pulse/cod";
import { associateMatches } from "@/lib/ops-pulse/associate-identity";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
type SearchParams = { station?: string; from?: string; to?: string; name?: string };
function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()); }
function yesterday() { const date = new Date(`${today()}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - 1); return date.toISOString().slice(0, 10); }
function valid(value: unknown) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")); }
function fmt(value: number, digits = 0) { return value.toLocaleString("en-IN", { maximumFractionDigits: digits }); }

export default async function AssociateCapacityPage({ params, searchParams }: { params: { id: string }; searchParams?: SearchParams }) {
  const authorization = await requirePagePermission("cps_associates", "access");
  const companyId = requireCompanyId(authorization);
  const id = decodeURIComponent(params.id);
  const locationResult = await loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess);
  const allowedCodes = locationResult.locations.map((location) => location.station_code);
  const station = String(searchParams?.station ?? "").toUpperCase();
  if (!allowedCodes.includes(station)) notFound();
  const end = valid(searchParams?.to) ? String(searchParams?.to) : yesterday();
  const start = valid(searchParams?.from) ? String(searchParams?.from) : end;
  const requestedName = String(searchParams?.name ?? "").trim();
  const monthStart = `${end.slice(0, 8)}01`;
  const [shipmentResult, ruleResult, selectedDetailResult, mtdDetailResult, pincodeResult] = await Promise.all([
    loadShipmentCountAssociateDays(companyId, [station], start, end),
    loadCapacityRules(companyId),
    loadCapacityAssociateDeliveredDaily(companyId, station, id, requestedName, start, end),
    loadCapacityAssociateDeliveredDaily(companyId, station, id, requestedName, monthStart, end),
    loadCapacityAssociatePincodes(companyId, station, id, requestedName, monthStart, end)
  ]);
  const rows = (shipmentResult.data ?? []).filter((row) => associateMatches(id, requestedName, row.provider_employee_id, row.provider_employee_name));
  const totalsByIdentityDay = new Map<string, number>();
  rows.forEach((row) => {
    const key = `${row.work_date}|${row.provider_employee_id}`;
    totalsByIdentityDay.set(key, (totalsByIdentityDay.get(key) ?? 0) + capacityWorkload(row));
  });
  const dailyMap = new Map<string, number>();
  totalsByIdentityDay.forEach((value, key) => {
    const date = key.slice(0, 10);
    dailyMap.set(date, Math.max(dailyMap.get(date) ?? 0, value));
  });
  const daily = [...dailyMap.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, delivered]) => ({ date, delivered }));
  const total = daily.reduce((sum, row) => sum + row.delivered, 0);
  const average = daily.length ? total / daily.length : 0;
  const peak = Math.max(0, ...daily.map((row) => row.delivered));
  const safe = ruleResult.rows.find((rule) => rule.stationCode === station)?.maxSafeSpr ?? 70;
  const name = requestedName || rows.find((row) => row.provider_employee_name)?.provider_employee_name || id;
  const highDays = daily.filter((row) => row.delivered > safe).length;
  const selectedDetail = selectedDetailResult.data ?? [];
  const mtdDetail = mtdDetailResult.data ?? [];
  const pincodes = pincodeResult.data ?? [];
  const selectedDetailDelivered = selectedDetail.reduce((sum, row) => sum + Number(row.delivered), 0);
  const mtdDelivered = mtdDetail.reduce((sum, row) => sum + Number(row.delivered), 0);
  const mtdVolumetric = mtdDetail.reduce((sum, row) => sum + Number(row.volumetric), 0);
  const mtdSmall = mtdDetail.reduce((sum, row) => sum + Number(row.small), 0);
  const mtdUnclassified = mtdDetail.reduce((sum, row) => sum + Number(row.unclassified), 0);
  const latestDetail = mtdDetail.at(-1);
  const detailError = selectedDetailResult.error?.message || mtdDetailResult.error?.message || pincodeResult.error?.message;

  return <AppShell active="Capacity" pageCode="cps_associates"><div className="ops-command-center capacity-workspace">
    <PageHead eyebrow="Associate Allocation" title={name} subtitle={`${id} · ${station}`} />
    <CapacityWorkspaceTabs active="associates" />
    {locationResult.error || shipmentResult.error || ruleResult.error || detailError ? <div className="message-panel error">{locationResult.error || shipmentResult.error?.message || ruleResult.error || detailError}</div> : null}
    <div className="capacity-station-toolbar"><a className="button secondary compact" href={`/ops-pulse/capacity/associates?station=${station}&from=${start}&to=${end}`}>← Associate SPR</a><form method="get"><input type="hidden" name="station" value={station}/>{requestedName ? <input type="hidden" name="name" value={requestedName}/> : null}<label>From<input type="date" name="from" defaultValue={start}/></label><label>To<input type="date" name="to" defaultValue={end}/></label><button className="button compact">Apply</button></form></div>
    <section className="performance-summary-grid"><article><span>Days worked</span><strong>{daily.length}</strong><small>Shipment-active days</small></article><article><span>Total workload</span><strong>{fmt(total)}</strong><small>Amazon + SMD + SWA + C-return</small></article><article><span>Average allocation</span><strong>{fmt(average, 1)}</strong><small>Workload per active day</small></article><article><span>High-load days</span><strong>{highDays}</strong><small>Above safe SPR {fmt(safe)}</small></article></section>
    <section className="panel"><div className="panel-head"><div><h2>Daily allocation trend</h2><p className="subtle">Use repeated high-load days to review route design and workload distribution.</p></div></div><div className="capacity-associate-trend">{daily.map((row) => <div key={row.date}><span>{row.date.slice(5)}</span><i style={{ width: `${peak ? Math.max(3, row.delivered / peak * 100) : 0}%` }} className={row.delivered > safe ? "risk" : ""}/><strong>{fmt(row.delivered)}</strong></div>)}</div><div className="table-wrap"><table className="capacity-daily-table"><thead><tr><th>Date</th><th>Workload</th><th>Safe SPR</th><th>Status</th></tr></thead><tbody>{daily.map((row) => <tr key={row.date}><td>{row.date.split("-").reverse().join("/")}</td><td><strong>{fmt(row.delivered)}</strong></td><td>{fmt(safe)}</td><td><span className={`capacity-decision ${row.delivered > safe ? "risk" : "balanced"}`}>{row.delivered > safe ? `High +${fmt(row.delivered - safe)}` : "Within safe"}</span></td></tr>)}</tbody></table></div></section>
    <section className="panel capacity-associate-delivery-detail">
      <div className="panel-head"><div><h2>Delivered-detail mix</h2><p className="subtle">Pincode and package-size evidence from the tracking-level delivered report.</p></div><span className="status-pill neutral">MTD · {monthStart.split("-").reverse().join("/")}–{end.split("-").reverse().join("/")}</span></div>
      <div className="performance-summary-grid">
        <article><span>Selected period</span><strong>{fmt(selectedDetailDelivered)}</strong><small>{start === end ? start.split("-").reverse().join("/") : `${start.split("-").reverse().join("/")}–${end.split("-").reverse().join("/")}`}</small></article>
        <article><span>Latest detailed day</span><strong>{latestDetail ? fmt(Number(latestDetail.delivered)) : "—"}</strong><small>{latestDetail ? latestDetail.work_date.split("-").reverse().join("/") : "No delivered detail"}</small></article>
        <article><span>MTD delivered</span><strong>{fmt(mtdDelivered)}</strong><small>{pincodes.length} pincodes served</small></article>
        <article><span>Small mix</span><strong>{mtdDelivered ? `${fmt(mtdSmall / mtdDelivered * 100, 1)}%` : "—"}</strong><small>{fmt(mtdSmall)} shipments</small></article>
        <article><span>Volumetric mix</span><strong>{mtdDelivered ? `${fmt(mtdVolumetric / mtdDelivered * 100, 1)}%` : "—"}</strong><small>{fmt(mtdVolumetric)} shipments</small></article>
      </div>
      <div className="table-wrap"><table className="capacity-daily-table"><thead><tr><th>Pincode</th><th>Delivered</th><th>MTD share</th><th>Active days</th><th>Small</th><th>Small mix</th><th>Volumetric</th><th>Volumetric mix</th></tr></thead><tbody>
        {pincodes.map((row) => {
          const delivered = Number(row.delivered);
          const small = Number(row.small);
          const volumetric = Number(row.volumetric);
          const base = `/ops-pulse/capacity/shipments?station=${station}&associate=${encodeURIComponent(id)}&pincode=${row.postal_code}&from=${monthStart}&to=${end}`;
          return <tr key={row.postal_code}><td><strong>{row.postal_code}</strong></td><td><a href={base}>{fmt(delivered)}</a></td><td>{mtdDelivered ? `${fmt(delivered / mtdDelivered * 100, 1)}%` : "—"}</td><td>{fmt(Number(row.active_days))}</td><td><a href={`${base}&size=small`}>{fmt(small)}</a></td><td>{delivered ? `${fmt(small / delivered * 100, 1)}%` : "—"}</td><td><a href={`${base}&size=volumetric`}>{fmt(volumetric)}</a></td><td>{delivered ? `${fmt(volumetric / delivered * 100, 1)}%` : "—"}</td></tr>;
        })}
        {!pincodes.length ? <tr><td className="empty-cell" colSpan={8}>No tracking-level delivered detail is available for this associate and month.</td></tr> : null}
      </tbody></table></div>
      {mtdUnclassified ? <div className="capacity-source-gap"><strong>{fmt(mtdUnclassified)} shipments are unclassified</strong><span>Weight or dimensions are missing in the delivered-detail source.</span></div> : null}
    </section>
  </div></AppShell>;
}
