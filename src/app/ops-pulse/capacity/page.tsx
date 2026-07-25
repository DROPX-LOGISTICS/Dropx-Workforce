import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadCapacityRules } from "@/lib/ops-pulse/capacity";
import { loadCodLocations } from "@/lib/ops-pulse/cod";
import { resolveOperatingContext } from "@/lib/ops-pulse/operating-context";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type SearchParams = { period?: string };
type ShipmentRow = { work_date: string; station_code: string; provider_employee_id: string; total_delivery: number | string | null };
type CapacityView = {
  stationCode: string; stationName: string; latestDate: string | null; currentHeadcount: number; averageHeadcount: number;
  averageVolume: number; currentSpr: number; targetSpr: number | null; maxSafeSpr: number | null; requiredHeadcount: number | null;
  gap: number | null; additions: number; leavers: number; attritionRate: number; status: "hire" | "surplus" | "balanced" | "risk" | "unconfigured";
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
  const locations = resolveOperatingContext(locationResult.locations).selectedLocations;
  const codes = locations.map((location) => location.station_code);
  const period = ["day", "month"].includes(String(searchParams?.period)) ? String(searchParams?.period) : "week";
  const end = today();
  const periodDays = period === "day" ? 1 : period === "month" ? 30 : 7;
  const start = dateShift(end, -(Math.max(30, periodDays) + 14));
  const [ruleResult, shipmentResult] = await Promise.all([
    loadCapacityRules(companyId),
    supabaseAdmin && codes.length ? supabaseAdmin.from("cps_shipment_daily")
      .select("work_date,station_code,provider_employee_id,total_delivery")
      .eq("company_id", companyId).in("station_code", codes).gte("work_date", start).lte("work_date", end).limit(25000)
      : { data: [] as ShipmentRow[], error: null }
  ]);
  const rules = new Map(ruleResult.rows.map((rule) => [rule.stationCode, rule]));
  const allRows = (shipmentResult.data ?? []) as ShipmentRow[];
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
    const currentHeadcount = new Set(currentRows.map((row) => row.provider_employee_id).filter(Boolean)).size;
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
    const requiredHeadcount = rule ? Math.ceil(averageVolume / rule.targetSpr * (1 + rule.bufferPercent / 100)) : null;
    const gap = requiredHeadcount == null ? null : requiredHeadcount - currentHeadcount;
    const status: CapacityView["status"] = !rule ? "unconfigured" : currentSpr > rule.maxSafeSpr ? "risk" : gap && gap > 0 ? "hire" : gap != null && gap < -1 ? "surplus" : "balanced";
    const reason = status === "unconfigured" ? "Configure station SPR and buffer assumptions to generate a workforce recommendation."
      : status === "risk" ? `Recent SPR ${fmt(currentSpr, 1)} exceeds the configured safe limit ${fmt(rule!.maxSafeSpr, 1)}; rebalance volume or add capacity.`
      : status === "hire" ? `Recent demand supports ${requiredHeadcount} associates, leaving a ${gap}-person hiring requirement.`
      : status === "surplus" ? `Current headcount is ${Math.abs(gap ?? 0)} above the demand-based requirement; review deployment before further hiring.`
      : `Headcount is aligned to recent demand at ${fmt(currentSpr, 1)} SPR.`;
    return { stationCode: location.station_code, stationName: location.station_name || location.city || location.station_code, latestDate, currentHeadcount, averageHeadcount, averageVolume, currentSpr, targetSpr: rule?.targetSpr ?? null, maxSafeSpr: rule?.maxSafeSpr ?? null, requiredHeadcount, gap, additions, leavers, attritionRate, status, reason };
  });
  const generatedReasons = await aiReasons(views);
  const totalHeadcount = views.reduce((sum, row) => sum + row.currentHeadcount, 0);
  const totalRequired = views.reduce((sum, row) => sum + (row.requiredHeadcount ?? 0), 0);
  const hiringNeed = views.reduce((sum, row) => sum + Math.max(0, row.gap ?? 0), 0);
  const overloaded = views.filter((row) => row.status === "risk").length;

  return <AppShell active="Capacity" pageCode="cps_associates"><div className="ops-command-center capacity-workspace">
    <PageHead eyebrow="Workforce Planning" title="Capacity" subtitle="Headcount, allocation productivity, attrition signals and demand-based hiring recommendations." />
    <nav className="performance-tabs"><a className={period === "day" ? "active" : ""} href="/capacity?period=day">Day</a><a className={period === "week" ? "active" : ""} href="/capacity?period=week">Week</a><a className={period === "month" ? "active" : ""} href="/capacity?period=month">Month</a></nav>
    {locationResult.error || ruleResult.error || shipmentResult.error ? <div className="message-panel error">{locationResult.error || ruleResult.error || shipmentResult.error?.message}</div> : null}
    <section className="performance-summary-grid"><article><span>Current headcount</span><strong>{fmt(totalHeadcount)}</strong><small>Latest available station dates</small></article><article><span>Demand requirement</span><strong>{fmt(totalRequired)}</strong><small>Configured stations</small></article><article><span>Additional hiring</span><strong>{fmt(hiringNeed)}</strong><small>Positive station gaps</small></article><article><span>Workload risk</span><strong>{overloaded}</strong><small>Above maximum safe SPR</small></article></section>
    <section className="panel"><div className="panel-head"><div><h2>Station capacity plan</h2><p className="subtle">Attrition is inferred from associate IDs active in the previous seven days but absent in the latest seven days.</p></div><a className="button secondary compact" href="/master/capacity">Capacity Master</a></div>
      <div className="table-wrap"><table className="capacity-table"><thead><tr><th>Station</th><th>Latest HC</th><th>Average HC</th><th>Average volume</th><th>SPR</th><th>Target / safe</th><th>Additions</th><th>Leavers</th><th>Attrition</th><th>Required HC</th><th>Decision</th><th>Reason</th></tr></thead><tbody>
        {views.map((row) => <tr key={row.stationCode}><td><strong>{row.stationCode}</strong><small>{row.stationName}<br/>{row.latestDate || "No shipment data"}</small></td><td><strong>{fmt(row.currentHeadcount)}</strong></td><td>{fmt(row.averageHeadcount, 1)}</td><td>{fmt(row.averageVolume)}</td><td><strong className={row.status === "risk" ? "metric-bad-text" : ""}>{fmt(row.currentSpr, 1)}</strong></td><td>{row.targetSpr == null ? "—" : `${fmt(row.targetSpr, 1)} / ${fmt(row.maxSafeSpr ?? 0, 1)}`}</td><td className="metric-good-text">+{row.additions}</td><td className={row.leavers ? "metric-bad-text" : ""}>-{row.leavers}</td><td>{fmt(row.attritionRate, 1)}%</td><td>{row.requiredHeadcount ?? "—"}</td><td><span className={`capacity-decision ${row.status}`}>{row.status === "hire" ? `Hire ${row.gap}` : row.status === "surplus" ? `Surplus ${Math.abs(row.gap ?? 0)}` : row.status === "risk" ? "Overloaded" : row.status === "balanced" ? "Balanced" : "Configure"}</span></td><td className="capacity-reason">{generatedReasons[row.stationCode] || row.reason}</td></tr>)}
      </tbody></table></div>
    </section>
  </div></AppShell>;
}
