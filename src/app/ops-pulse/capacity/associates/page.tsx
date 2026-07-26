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
type SearchParams = { from?: string; to?: string; preset?: string };
type Row = { work_date: string; station_code: string; provider_employee_id: string; provider_employee_name: string | null; total_delivery: number | string | null };
function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()); }
function shift(value: string, days: number) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function valid(value: unknown) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")); }
function num(value: unknown) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function fmt(value: number, digits = 0) { return value.toLocaleString("en-IN", { maximumFractionDigits: digits }); }

export default async function HighSprAssociatesPage({ searchParams }: { searchParams?: SearchParams }) {
  const authorization = await requirePagePermission("cps_associates", "access");
  const companyId = requireCompanyId(authorization);
  const locationResult = await loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess);
  const locations = resolveOperatingContext(locationResult.locations).selectedLocations.filter((location) => operatingModeForLocation(location) !== "amazon_now");
  const end = valid(searchParams?.to) ? String(searchParams?.to) : today();
  const preset = ["wtd", "mtd", "ytd", "custom"].includes(String(searchParams?.preset)) ? String(searchParams?.preset) : "mtd";
  const weekday = new Date(`${end}T00:00:00Z`).getUTCDay();
  const start = valid(searchParams?.from) ? String(searchParams?.from)
    : preset === "wtd" ? shift(end, -((weekday + 6) % 7))
    : preset === "ytd" ? `${end.slice(0, 4)}-01-01` : `${end.slice(0, 8)}01`;
  const [ruleResult, ...stationResults] = await Promise.all([
    loadCapacityRules(companyId),
    ...locations.map((location) => supabaseAdmin ? supabaseAdmin.from("cps_shipment_daily")
      .select("work_date,station_code,provider_employee_id,provider_employee_name,total_delivery")
      .eq("company_id", companyId).eq("station_code", location.station_code).gte("work_date", start).lte("work_date", end)
      .order("work_date", { ascending: false }).limit(5000) : Promise.resolve({ data: [] as Row[], error: null }))
  ]);
  const rows = stationResults.flatMap((result) => (result.data ?? []) as Row[]);
  const ruleMap = new Map(ruleResult.rows.map((rule) => [rule.stationCode, rule]));
  const keys = [...new Set(rows.map((row) => `${row.station_code}|${row.provider_employee_id}`))];
  const associates = keys.map((key) => {
    const [stationCode, id] = key.split("|");
    const idRows = rows.filter((row) => row.station_code === stationCode && row.provider_employee_id === id);
    const dates = [...new Set(idRows.map((row) => row.work_date))].sort();
    const delivered = idRows.reduce((sum, row) => sum + num(row.total_delivery), 0);
    const daily = dates.map((date) => idRows.filter((row) => row.work_date === date).reduce((sum, row) => sum + num(row.total_delivery), 0));
    const average = dates.length ? delivered / dates.length : 0;
    const safe = ruleMap.get(stationCode)?.maxSafeSpr ?? 70;
    return { stationCode, id, name: idRows.find((row) => row.provider_employee_name)?.provider_employee_name || "Unmapped name", dates: dates.length, delivered, average, peak: Math.max(0, ...daily), highDays: daily.filter((value) => value > safe).length, safe };
  }).filter((row) => row.average > row.safe).sort((a, b) => b.average - a.average);
  const totalHighDays = associates.reduce((sum, row) => sum + row.highDays, 0);
  const extreme = associates.filter((row) => row.average > 90).length;

  return <AppShell active="Capacity" pageCode="cps_associates"><div className="ops-command-center capacity-workspace">
    <PageHead eyebrow="Workload Risk" title="High SPR Associates" subtitle="Associates whose average daily delivered allocation exceeds their station’s safe SPR." />
    <CapacityWorkspaceTabs active="associates" />
    <form className="capacity-period-filter" method="get"><label>Period<select name="preset" defaultValue={preset}><option value="wtd">Week to date</option><option value="mtd">Month to date</option><option value="ytd">Year to date</option><option value="custom">Custom</option></select></label><label>From<input type="date" name="from" defaultValue={start}/></label><label>To<input type="date" name="to" defaultValue={end}/></label><button className="button compact">Apply</button></form>
    <section className="performance-summary-grid"><article><span>High-SPR associates</span><strong>{associates.length}</strong><small>Average above station safe limit</small></article><article><span>Extreme allocation</span><strong>{extreme}</strong><small>Average above 90 deliveries</small></article><article><span>High-load days</span><strong>{totalHighDays}</strong><small>Associate-days above safe limit</small></article><article><span>Coverage</span><strong>{locations.length}</strong><small>Eligible stations</small></article></section>
    <section className="panel"><div className="panel-head"><div><h2>Allocation risk register</h2><p className="subtle">Average is total delivered divided by days the ID appeared in shipment data.</p></div></div><div className="table-wrap"><table className="capacity-daily-table"><thead><tr><th>Associate</th><th>Station</th><th>Days worked</th><th>Total delivered</th><th>Average/day</th><th>Peak</th><th>High-load days</th><th>Safe SPR</th></tr></thead><tbody>
      {associates.map((row) => <tr key={`${row.stationCode}-${row.id}`}><td><a className="capacity-station-link" href={`/capacity/associates/${encodeURIComponent(row.id)}?station=${row.stationCode}&from=${start}&to=${end}`}><strong>{row.name}</strong><small>{row.id}</small></a></td><td><a href={`/capacity/${row.stationCode}`}>{row.stationCode}</a></td><td>{row.dates}</td><td>{fmt(row.delivered)}</td><td><strong className="metric-bad-text">{fmt(row.average, 1)}</strong></td><td>{fmt(row.peak)}</td><td>{row.highDays}</td><td>{fmt(row.safe, 1)}</td></tr>)}
      {!associates.length ? <tr><td className="empty-cell" colSpan={8}>No associate exceeds the safe SPR in this period.</td></tr> : null}
    </tbody></table></div></section>
  </div></AppShell>;
}
