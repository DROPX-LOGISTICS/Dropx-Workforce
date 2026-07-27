import { AppShell } from "@/components/app-shell";
import { CapacityWorkspaceTabs } from "@/components/capacity-workspace-tabs";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadCapacityRules } from "@/lib/ops-pulse/capacity";
import { loadCapacityAssociateDays } from "@/lib/ops-pulse/capacity-shipments";
import { loadCodLocations } from "@/lib/ops-pulse/cod";
import { associateMatches } from "@/lib/ops-pulse/associate-identity";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
type SearchParams = { station?: string; from?: string; to?: string; name?: string };
function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()); }
function yesterday() { const date = new Date(`${today()}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - 1); return date.toISOString().slice(0, 10); }
function valid(value: unknown) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")); }
function num(value: unknown) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
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
  const [shipmentResult, ruleResult] = await Promise.all([
    loadCapacityAssociateDays(companyId, [station], start, end),
    loadCapacityRules(companyId)
  ]);
  const requestedName = String(searchParams?.name ?? "").trim();
  const rows = (shipmentResult.data ?? []).filter((row) => associateMatches(id, requestedName, row.associate_id, row.associate_name));
  const dates = [...new Set(rows.map((row) => row.work_date))].sort();
  const daily = dates.map((date) => ({ date, delivered: rows.filter((row) => row.work_date === date).reduce((sum, row) => sum + num(row.delivered), 0) }));
  const total = daily.reduce((sum, row) => sum + row.delivered, 0);
  const average = daily.length ? total / daily.length : 0;
  const peak = Math.max(0, ...daily.map((row) => row.delivered));
  const safe = ruleResult.rows.find((rule) => rule.stationCode === station)?.maxSafeSpr ?? 70;
  const name = requestedName || rows.find((row) => row.associate_name)?.associate_name || id;
  const highDays = daily.filter((row) => row.delivered > safe).length;

  return <AppShell active="Capacity" pageCode="cps_associates"><div className="ops-command-center capacity-workspace">
    <PageHead eyebrow="Associate Allocation" title={name} subtitle={`${id} · ${station}`} />
    <CapacityWorkspaceTabs active="associates" />
    {locationResult.error || shipmentResult.error || ruleResult.error ? <div className="message-panel error">{locationResult.error || shipmentResult.error?.message || ruleResult.error}</div> : null}
    <div className="capacity-station-toolbar"><a className="button secondary compact" href={`/ops-pulse/capacity/associates?station=${station}&from=${start}&to=${end}`}>← Associate SPR</a><form method="get"><input type="hidden" name="station" value={station}/>{requestedName ? <input type="hidden" name="name" value={requestedName}/> : null}<label>From<input type="date" name="from" defaultValue={start}/></label><label>To<input type="date" name="to" defaultValue={end}/></label><button className="button compact">Apply</button></form></div>
    <section className="performance-summary-grid"><article><span>Days worked</span><strong>{daily.length}</strong><small>Shipment-active days</small></article><article><span>Total workload</span><strong>{fmt(total)}</strong><small>Amazon + SMD + SWA + C-return</small></article><article><span>Average allocation</span><strong>{fmt(average, 1)}</strong><small>Workload per active day</small></article><article><span>High-load days</span><strong>{highDays}</strong><small>Above safe SPR {fmt(safe)}</small></article></section>
    <section className="panel"><div className="panel-head"><div><h2>Daily allocation trend</h2><p className="subtle">Use repeated high-load days to review route design and workload distribution.</p></div></div><div className="capacity-associate-trend">{daily.map((row) => <div key={row.date}><span>{row.date.slice(5)}</span><i style={{ width: `${peak ? Math.max(3, row.delivered / peak * 100) : 0}%` }} className={row.delivered > safe ? "risk" : ""}/><strong>{fmt(row.delivered)}</strong></div>)}</div><div className="table-wrap"><table className="capacity-daily-table"><thead><tr><th>Date</th><th>Workload</th><th>Safe SPR</th><th>Status</th></tr></thead><tbody>{daily.map((row) => <tr key={row.date}><td>{row.date.split("-").reverse().join("/")}</td><td><strong>{fmt(row.delivered)}</strong></td><td>{fmt(safe)}</td><td><span className={`capacity-decision ${row.delivered > safe ? "risk" : "balanced"}`}>{row.delivered > safe ? `High +${fmt(row.delivered - safe)}` : "Within safe"}</span></td></tr>)}</tbody></table></div></section>
  </div></AppShell>;
}
