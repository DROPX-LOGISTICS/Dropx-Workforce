import { AppShell } from "@/components/app-shell";
import { CapacityWorkspaceTabs } from "@/components/capacity-workspace-tabs";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadCapacityRules } from "@/lib/ops-pulse/capacity";
import { loadCodLocations } from "@/lib/ops-pulse/cod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
type SearchParams = { station?: string; from?: string; to?: string };
type Row = { work_date: string; station_code: string; provider_employee_id: string; provider_employee_name: string | null; total_delivery: number | string | null };
function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()); }
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
  const end = valid(searchParams?.to) ? String(searchParams?.to) : today();
  const start = valid(searchParams?.from) ? String(searchParams?.from) : `${end.slice(0, 8)}01`;
  const [shipmentResult, ruleResult] = await Promise.all([
    supabaseAdmin ? supabaseAdmin.from("cps_shipment_daily").select("work_date,station_code,provider_employee_id,provider_employee_name,total_delivery")
      .eq("company_id", companyId).eq("station_code", station).eq("provider_employee_id", id).gte("work_date", start).lte("work_date", end)
      .order("work_date", { ascending: true }).limit(1000) : { data: [] as Row[], error: null },
    loadCapacityRules(companyId)
  ]);
  const rows = (shipmentResult.data ?? []) as Row[];
  const dates = [...new Set(rows.map((row) => row.work_date))].sort();
  const daily = dates.map((date) => ({ date, delivered: rows.filter((row) => row.work_date === date).reduce((sum, row) => sum + num(row.total_delivery), 0) }));
  const total = daily.reduce((sum, row) => sum + row.delivered, 0);
  const average = daily.length ? total / daily.length : 0;
  const peak = Math.max(0, ...daily.map((row) => row.delivered));
  const safe = ruleResult.rows.find((rule) => rule.stationCode === station)?.maxSafeSpr ?? 70;
  const name = rows.find((row) => row.provider_employee_name)?.provider_employee_name || id;
  const highDays = daily.filter((row) => row.delivered > safe).length;

  return <AppShell active="Capacity" pageCode="cps_associates"><div className="ops-command-center capacity-workspace">
    <PageHead eyebrow="Associate Allocation" title={name} subtitle={`${id} · ${station}`} />
    <CapacityWorkspaceTabs active="associates" />
    <div className="capacity-station-toolbar"><a className="button secondary compact" href={`/capacity/associates?from=${start}&to=${end}`}>← High SPR list</a><form method="get"><input type="hidden" name="station" value={station}/><label>From<input type="date" name="from" defaultValue={start}/></label><label>To<input type="date" name="to" defaultValue={end}/></label><button className="button compact">Apply</button></form></div>
    <section className="performance-summary-grid"><article><span>Days worked</span><strong>{daily.length}</strong><small>Shipment-active days</small></article><article><span>Total delivered</span><strong>{fmt(total)}</strong><small>Selected period</small></article><article><span>Average allocation</span><strong>{fmt(average, 1)}</strong><small>Delivered per active day</small></article><article><span>High-load days</span><strong>{highDays}</strong><small>Above safe SPR {fmt(safe)}</small></article></section>
    <section className="panel"><div className="panel-head"><div><h2>Daily allocation trend</h2><p className="subtle">Use repeated high-load days to review route design and workload distribution.</p></div></div><div className="capacity-associate-trend">{daily.map((row) => <div key={row.date}><span>{row.date.slice(5)}</span><i style={{ width: `${peak ? Math.max(3, row.delivered / peak * 100) : 0}%` }} className={row.delivered > safe ? "risk" : ""}/><strong>{fmt(row.delivered)}</strong></div>)}</div><div className="table-wrap"><table className="capacity-daily-table"><thead><tr><th>Date</th><th>Delivered</th><th>Safe SPR</th><th>Status</th></tr></thead><tbody>{daily.map((row) => <tr key={row.date}><td>{row.date.split("-").reverse().join("/")}</td><td><strong>{fmt(row.delivered)}</strong></td><td>{fmt(safe)}</td><td><span className={`capacity-decision ${row.delivered > safe ? "risk" : "balanced"}`}>{row.delivered > safe ? `High +${fmt(row.delivered - safe)}` : "Within safe"}</span></td></tr>)}</tbody></table></div></section>
  </div></AppShell>;
}
