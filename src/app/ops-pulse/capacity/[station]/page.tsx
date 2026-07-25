import { AppShell } from "@/components/app-shell";
import { CapacityWorkspaceTabs } from "@/components/capacity-workspace-tabs";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadCapacityRules } from "@/lib/ops-pulse/capacity";
import { loadCodLocations } from "@/lib/ops-pulse/cod";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { notFound } from "next/navigation";
import { submitCapacityRequest } from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = { from?: string; to?: string; saved?: string; error?: string };
type ShipmentRow = { work_date: string; provider_employee_id: string; total_delivery: number | string | null };
type RequestRow = { id: string; description: string | null; updated_at: string };
function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()); }
function validDate(value: unknown) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")); }
function num(value: unknown) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function fmt(value: number, digits = 0) { return value.toLocaleString("en-IN", { maximumFractionDigits: digits }); }
async function generateAction(facts: Record<string, unknown>, fallback: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || String(process.env.CAPACITY_AI_REASONING_ENABLED ?? "true").toLowerCase() === "false") return fallback;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_VALIDATION_MODEL || "gpt-4o-mini",
        temperature: 0.1,
        max_tokens: 80,
        messages: [
          { role: "system", content: "Give one concise logistics capacity action. Use only supplied facts. Do not invent causes. Mention the numeric staffing gap or data limitation." },
          { role: "user", content: JSON.stringify(facts) }
        ]
      })
    });
    clearTimeout(timeout);
    if (!response.ok) return fallback;
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return body.choices?.[0]?.message?.content?.trim() || fallback;
  } catch { return fallback; }
}

export default async function CapacityStationPage({ params, searchParams }: { params: { station: string }; searchParams?: SearchParams }) {
  const authorization = await requirePagePermission("cps_associates", "access");
  const companyId = requireCompanyId(authorization);
  const stationCode = decodeURIComponent(params.station).trim().toUpperCase();
  const locationResult = await loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess);
  const location = locationResult.locations.find((entry) => entry.station_code === stationCode);
  if (!location) notFound();
  const end = validDate(searchParams?.to) ? String(searchParams?.to) : today();
  const start = validDate(searchParams?.from) ? String(searchParams?.from) : `${end.slice(0, 8)}01`;
  const [shipmentResult, ruleResult, requestResult] = await Promise.all([
    supabaseAdmin ? supabaseAdmin.from("cps_shipment_daily").select("work_date,provider_employee_id,total_delivery")
      .eq("company_id", companyId).eq("station_code", stationCode).gte("work_date", start).lte("work_date", end)
      .order("work_date", { ascending: true }).limit(10000) : { data: [] as ShipmentRow[], error: null },
    loadCapacityRules(companyId),
    supabaseAdmin ? supabaseAdmin.from("report_import_master").select("id,description,updated_at")
      .eq("company_id", companyId).eq("parser_type", "capacity_ops_request")
      .like("source_code", `capacity_request_${stationCode.toLowerCase()}_%`).order("updated_at", { ascending: false }).limit(10)
      : { data: [] as RequestRow[], error: null }
  ]);
  const rows = (shipmentResult.data ?? []) as ShipmentRow[];
  const dates = [...new Set(rows.map((row) => row.work_date))].sort();
  const daily = dates.map((date) => {
    const dayRows = rows.filter((row) => row.work_date === date);
    const ids = new Set(dayRows.map((row) => row.provider_employee_id).filter(Boolean));
    const delivered = dayRows.reduce((sum, row) => sum + num(row.total_delivery), 0);
    return { date, ids: ids.size, delivered, spr: ids.size ? delivered / ids.size : 0 };
  });
  const rule = ruleResult.rows.find((entry) => entry.stationCode === stationCode);
  const targetSpr = rule?.targetSpr ?? null;
  const buffer = rule?.bufferPercent ?? 0;
  const totalDelivered = daily.reduce((sum, day) => sum + day.delivered, 0);
  const averageIds = daily.length ? daily.reduce((sum, day) => sum + day.ids, 0) / daily.length : 0;
  const averageVolume = daily.length ? totalDelivered / daily.length : 0;
  const averageSpr = averageIds ? averageVolume / averageIds : 0;
  const requiredIds = targetSpr && averageVolume ? Math.ceil(averageVolume / targetSpr * (1 + buffer / 100)) : null;
  const allIds = [...new Set(rows.map((row) => row.provider_employee_id).filter(Boolean))];
  const allocations = allIds.map((id) => {
    const idRows = rows.filter((row) => row.provider_employee_id === id);
    const workedDates = [...new Set(idRows.map((row) => row.work_date))];
    const delivered = idRows.reduce((sum, row) => sum + num(row.total_delivery), 0);
    return { id, days: workedDates.length, delivered, average: workedDates.length ? delivered / workedDates.length : 0 };
  }).sort((a, b) => b.average - a.average);
  const requests = ((requestResult.data ?? []) as RequestRow[]).map((row) => {
    try { return { id: row.id, updatedAt: row.updated_at, ...(JSON.parse(row.description ?? "{}") as Record<string, unknown>) }; }
    catch { return null; }
  }).filter(Boolean) as Array<Record<string, unknown>>;
  const fallbackAction = !daily.length ? "No shipment-ID data is available for this date range."
    : requiredIds != null && requiredIds > averageIds ? `Average demand requires ${requiredIds} IDs including ${buffer}% buffer; current daily average is ${fmt(averageIds, 1)}.`
    : requiredIds != null ? `Average road-active capacity covers demand; validate ad hoc IDs before closing hiring requirements.` : "Configure target SPR in Capacity Master to calculate required IDs.";
  const action = await generateAction({ stationCode, start, end, shipmentDays: daily.length, averageRoadIds: Number(averageIds.toFixed(1)), averageDelivered: Number(averageVolume.toFixed(1)), averageSpr: Number(averageSpr.toFixed(1)), targetSpr, bufferPercent: buffer, requiredIds }, fallbackAction);

  return <AppShell active="Capacity" pageCode="cps_associates"><div className="ops-command-center capacity-workspace">
    <PageHead eyebrow="Station Capacity" title={`${stationCode} · ${location.station_name || location.city || stationCode}`} subtitle="Shipment-ID headcount, delivered volume and allocation productivity." />
    <CapacityWorkspaceTabs active="overview" />
    <div className="capacity-station-toolbar"><a className="button secondary compact" href="/capacity">← All stations</a><form method="get"><label>From<input type="date" name="from" defaultValue={start}/></label><label>To<input type="date" name="to" defaultValue={end}/></label><button className="button compact">Apply</button></form></div>
    {searchParams?.saved ? <div className="message-panel success">Operations update submitted.</div> : null}
    {searchParams?.error || shipmentResult.error || requestResult.error ? <div className="message-panel error">{searchParams?.error || shipmentResult.error?.message || requestResult.error?.message}</div> : null}
    <section className="performance-summary-grid"><article><span>Average road IDs</span><strong>{fmt(averageIds, 1)}</strong><small>{daily.length} shipment days</small></article><article><span>Average delivered</span><strong>{fmt(averageVolume)}</strong><small>Packages per source day</small></article><article><span>Average SPR</span><strong>{fmt(averageSpr, 1)}</strong><small>Delivered ÷ road-active IDs</small></article><article><span>Required IDs</span><strong>{requiredIds ?? "—"}</strong><small>{targetSpr ? `SPR ${fmt(targetSpr, 1)} + ${fmt(buffer)}% buffer` : "Configure master"}</small></article></section>
    <div className="capacity-action-line"><strong>Action</strong><span>{action}</span></div>
    <section className="panel"><div className="panel-head"><div><h2>Day-level capacity</h2><p className="subtle">Each row uses unique associate IDs present in shipment data for that date.</p></div></div><div className="table-wrap"><table className="capacity-daily-table"><thead><tr><th>Date</th><th>Road-active IDs</th><th>Delivered packages</th><th>SPR</th><th>Required IDs</th><th>Position</th></tr></thead><tbody>
      {daily.map((day) => { const required = targetSpr ? Math.ceil(day.delivered / targetSpr * (1 + buffer / 100)) : null; const gap = required == null ? null : required - day.ids; return <tr key={day.date}><td>{day.date.split("-").reverse().join("/")}</td><td><strong>{day.ids}</strong></td><td>{fmt(day.delivered)}</td><td><strong>{fmt(day.spr, 1)}</strong></td><td>{required ?? "—"}</td><td><span className={`capacity-decision ${gap == null ? "unconfigured" : gap > 0 ? "hire" : gap < -1 ? "surplus" : "balanced"}`}>{gap == null ? "Configure" : gap > 0 ? `Short ${gap}` : gap < -1 ? `Above ${Math.abs(gap)}` : "Covered"}</span></td></tr>; })}
      {!daily.length ? <tr><td className="empty-cell" colSpan={6}>No shipment data in this range.</td></tr> : null}
    </tbody></table></div></section>
    <section className="capacity-station-columns"><div className="panel"><div className="panel-head"><div><h2>Associate allocation</h2><p className="subtle">IDs and average delivered allocation in this range.</p></div></div><div className="table-wrap"><table className="capacity-daily-table"><thead><tr><th>Associate ID</th><th>Days worked</th><th>Delivered</th><th>Average/day</th></tr></thead><tbody>{allocations.map((row) => <tr key={row.id}><td><strong>{row.id}</strong></td><td>{row.days}</td><td>{fmt(row.delivered)}</td><td><strong>{fmt(row.average, 1)}</strong></td></tr>)}</tbody></table></div></div>
      <div className="panel"><div className="panel-head"><div><h2>Operations update</h2><p className="subtle">Record ad hoc IDs or request additional capacity with ground context.</p></div></div><form action={submitCapacityRequest} className="capacity-request-form"><input type="hidden" name="station_code" value={stationCode}/><input type="hidden" name="from" value={start}/><input type="hidden" name="to" value={end}/><label>Ad hoc IDs used<input name="ad_hoc_ids" type="number" min="0" defaultValue="0"/></label><label>Additional IDs requested<input name="requested_additional" type="number" min="0" defaultValue="0"/></label><label className="wide">Reason / ground update<textarea name="reason" maxLength={1000} placeholder="Example: Three regular IDs are ad hoc and may not continue next week; request three permanent associates." required/></label><button className="button">Submit update</button></form>
      <div className="capacity-request-log">{requests.map((request) => <article key={String(request.id)}><strong>Request {Number(request.requestedAdditional ?? 0) ? `+${request.requestedAdditional} IDs` : "update"}</strong><span>{String(request.reason ?? "")}</span><small>{String(request.createdAt ?? request.updatedAt ?? "").slice(0, 10)} · {Number(request.adHocIds ?? 0)} ad hoc IDs</small></article>)}{!requests.length ? <p className="empty-cell">No operations updates yet.</p> : null}</div></div>
    </section>
  </div></AppShell>;
}
