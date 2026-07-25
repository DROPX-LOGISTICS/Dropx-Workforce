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

type SearchParams = { lens?: string };
type ShipmentRow = { work_date: string; station_code: string; provider_employee_id: string; total_delivery: number | string | null };
type RosterRow = { id: string; location_id: string; is_active: boolean; date_of_join: string | null };
type AttendanceRow = { punch_date: string; location_id: string | null; field_executive_id: string | null; enrolment_id: string; status: string | null };
type CapacityView = {
  stationCode: string; stationName: string; latestDate: string | null; activeRoster: number; reportedHeadcount: number; operationalHeadcount: number;
  attendanceGap: number | null; attendanceCoverage: number | null; headcountSource: string; currentHeadcount: number; averageHeadcount: number;
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
  const locations = resolveOperatingContext(locationResult.locations).selectedLocations.filter((location) => operatingModeForLocation(location) !== "amazon_now");
  const codes = locations.map((location) => location.station_code);
  const lens = ["movement", "outlook"].includes(String(searchParams?.lens)) ? String(searchParams?.lens) : "current";
  const end = today();
  const periodDays = lens === "current" ? 5 : lens === "movement" ? 7 : 30;
  const start = dateShift(end, -(Math.max(30, periodDays) + 14));
  const [ruleResult, shipmentResult, rosterResult, attendanceResult] = await Promise.all([
    loadCapacityRules(companyId),
    supabaseAdmin && codes.length ? supabaseAdmin.from("cps_shipment_daily")
      .select("work_date,station_code,provider_employee_id,total_delivery")
      .eq("company_id", companyId).in("station_code", codes).gte("work_date", start).lte("work_date", end).limit(25000)
      : { data: [] as ShipmentRow[], error: null },
    supabaseAdmin && locations.length ? supabaseAdmin.from("field_executives")
      .select("id,location_id,is_active,date_of_join").eq("company_id", companyId).in("location_id", locations.map((location) => location.id))
      : { data: [] as RosterRow[], error: null },
    supabaseAdmin && locations.length ? supabaseAdmin.from("attendance_daily")
      .select("punch_date,location_id,field_executive_id,enrolment_id,status").eq("company_id", companyId)
      .in("location_id", locations.map((location) => location.id)).gte("punch_date", start).lte("punch_date", end).limit(25000)
      : { data: [] as AttendanceRow[], error: null }
  ]);
  const rules = new Map(ruleResult.rows.map((rule) => [rule.stationCode, rule]));
  const allRows = (shipmentResult.data ?? []) as ShipmentRow[];
  const rosterRows = (rosterResult.data ?? []) as RosterRow[];
  const attendanceRows = (attendanceResult.data ?? []) as AttendanceRow[];
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
    const operationalHeadcount = new Set(currentRows.map((row) => row.provider_employee_id).filter(Boolean)).size;
    const stationRoster = rosterRows.filter((row) => row.location_id === location.id && row.is_active);
    const activeRoster = stationRoster.length;
    const stationAttendance = attendanceRows.filter((row) => row.location_id === location.id && row.status !== "A");
    const latestAttendanceDate = [...new Set(stationAttendance.map((row) => row.punch_date))].sort().at(-1) ?? null;
    const latestAttendance = latestAttendanceDate ? stationAttendance.filter((row) => row.punch_date === latestAttendanceDate) : [];
    const reportedHeadcount = new Set(latestAttendance.map((row) => row.field_executive_id || row.enrolment_id).filter(Boolean)).size;
    const currentHeadcount = reportedHeadcount || operationalHeadcount;
    const attendanceGap = activeRoster && latestAttendanceDate ? Math.max(0, activeRoster - reportedHeadcount) : null;
    const attendanceCoverage = activeRoster && latestAttendanceDate ? reportedHeadcount / activeRoster * 100 : null;
    const headcountSource = reportedHeadcount ? `Attendance ${latestAttendanceDate}` : operationalHeadcount ? `Shipment activity ${latestDate}` : "No reporting source";
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
    return { stationCode: location.station_code, stationName: location.station_name || location.city || location.station_code, latestDate, activeRoster, reportedHeadcount, operationalHeadcount, attendanceGap, attendanceCoverage, headcountSource, currentHeadcount, averageHeadcount, averageVolume, currentSpr, targetSpr: rule?.targetSpr ?? null, maxSafeSpr: rule?.maxSafeSpr ?? null, requiredHeadcount, gap, additions, leavers, attritionRate, status, reason };
  });
  const generatedReasons = await aiReasons(views);
  const totalRoster = views.reduce((sum, row) => sum + row.activeRoster, 0);
  const totalReported = views.reduce((sum, row) => sum + row.reportedHeadcount, 0);
  const totalAttendanceGap = views.reduce((sum, row) => sum + (row.attendanceGap ?? 0), 0);
  const totalRequired = views.reduce((sum, row) => sum + (row.requiredHeadcount ?? 0), 0);
  const hiringNeed = views.reduce((sum, row) => sum + Math.max(0, row.gap ?? 0), 0);
  const overloaded = views.filter((row) => row.status === "risk").length;

  return <AppShell active="Capacity" pageCode="cps_associates"><div className="ops-command-center capacity-workspace">
    <PageHead eyebrow="Workforce Planning" title="Capacity" subtitle="Headcount, allocation productivity, attrition signals and demand-based hiring recommendations." />
    <CapacityWorkspaceTabs active="overview" />
    <nav className="performance-tabs capacity-lens-tabs"><a className={lens === "current" ? "active" : ""} href="/capacity?lens=current">Current staffing</a><a className={lens === "movement" ? "active" : ""} href="/capacity?lens=movement">Workforce movement</a><a className={lens === "outlook" ? "active" : ""} href="/capacity?lens=outlook">Monthly outlook</a></nav>
    {locationResult.error || ruleResult.error || shipmentResult.error || rosterResult.error || attendanceResult.error ? <div className="message-panel error">{locationResult.error || ruleResult.error || shipmentResult.error?.message || rosterResult.error?.message || attendanceResult.error?.message}</div> : null}
    <section className="performance-summary-grid"><article><span>Active roster</span><strong>{fmt(totalRoster)}</strong><small>Active Field Executive records</small></article><article><span>Reported headcount</span><strong>{fmt(totalReported)}</strong><small>Latest biometric attendance</small></article><article><span>Attendance gap</span><strong>{fmt(totalAttendanceGap)}</strong><small>Roster less reported; not scheduled absence</small></article><article><span>Additional hiring</span><strong>{fmt(hiringNeed)}</strong><small>Demand requirement {fmt(totalRequired)}</small></article></section>
    <section className="panel"><div className="panel-head"><div><h2>Station capacity plan</h2><p className="subtle">Attrition is inferred from associate IDs active in the previous seven days but absent in the latest seven days.</p></div><a className="button secondary compact" href="/master/capacity">Capacity Master</a></div>
      <div className="table-wrap"><table className="capacity-table"><thead><tr><th>Station</th><th>Active roster</th><th>Reported</th><th>Shipment-active</th><th>Attendance gap</th><th>Average volume</th><th>SPR</th><th>Target / safe</th><th>Additions</th><th>Leavers</th><th>Required HC</th><th>Decision</th><th>Reason</th></tr></thead><tbody>
        {views.map((row) => <tr key={row.stationCode}><td><strong>{row.stationCode}</strong><small>{row.stationName}<br/>{row.headcountSource}</small></td><td><strong>{fmt(row.activeRoster)}</strong></td><td><strong>{fmt(row.reportedHeadcount)}</strong><small>{row.attendanceCoverage == null ? "No attendance denominator" : `${fmt(row.attendanceCoverage, 1)}% of roster`}</small></td><td>{fmt(row.operationalHeadcount)}</td><td className={row.attendanceGap ? "metric-bad-text" : ""}>{row.attendanceGap ?? "—"}</td><td>{fmt(row.averageVolume)}</td><td><strong className={row.status === "risk" ? "metric-bad-text" : ""}>{fmt(row.currentSpr, 1)}</strong></td><td>{row.targetSpr == null ? "—" : `${fmt(row.targetSpr, 1)} / ${fmt(row.maxSafeSpr ?? 0, 1)}`}</td><td className="metric-good-text">+{row.additions}</td><td className={row.leavers ? "metric-bad-text" : ""}>-{row.leavers}</td><td>{row.requiredHeadcount ?? "—"}</td><td><span className={`capacity-decision ${row.status}`}>{row.status === "hire" ? `Hire ${row.gap}` : row.status === "surplus" ? `Surplus ${Math.abs(row.gap ?? 0)}` : row.status === "risk" ? "Overloaded" : row.status === "balanced" ? "Balanced" : "Configure"}</span></td><td className="capacity-reason">{generatedReasons[row.stationCode] || row.reason}</td></tr>)}
      </tbody></table></div>
    </section>
  </div></AppShell>;
}
