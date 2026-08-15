import { NextResponse } from "next/server";
import { getAuthorization, hasPermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadNetworkPlanning, startOfPlanningWeek } from "@/lib/ops-pulse/network-planning";
import { loadServiceNetworkRules } from "@/lib/ops-pulse/service-network";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

function csv(value: unknown) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  try {
    const authorization = await getAuthorization();
    if (!authorization) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    if (!hasPermission(authorization, "service_network", "access")) return NextResponse.json({ error: "Network Planning access denied." }, { status: 403 });
    if (!supabaseAdmin) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
    const companyId = requireCompanyId(authorization);
    const { searchParams } = new URL(request.url);
    const stationCode = String(searchParams.get("station") ?? "").trim().toUpperCase();
    const planDate = String(searchParams.get("date") ?? "").trim();
    if (!stationCode || !/^\d{4}-\d{2}-\d{2}$/.test(planDate)) return NextResponse.json({ error: "Station and date are required." }, { status: 400 });
    const stationResult = await supabaseAdmin.from("stations").select("id,station_code").eq("company_id", companyId).eq("station_code", stationCode).eq("is_active", true).maybeSingle();
    if (stationResult.error) return NextResponse.json({ error: stationResult.error.message }, { status: 500 });
    if (!stationResult.data) return NextResponse.json({ error: "Station not found." }, { status: 404 });
    if (!authorization.hasAllLocationAccess && !authorization.locationScopeIds.includes(stationResult.data.id)) return NextResponse.json({ error: "Station access denied." }, { status: 403 });
    const rules = await loadServiceNetworkRules(companyId);
    const rule = rules.rows.find(item => item.stationCode === stationCode && item.isActive);
    const planning = await loadNetworkPlanning({ companyId, stationId: stationResult.data.id, weekStart: startOfPlanningWeek(planDate), selectedDate: planDate, rule });
    if (!planning.schemaReady) return NextResponse.json({ error: planning.error }, { status: 503 });
    const lines = [["Date", "Station", "Sector", "Route", "Route name", "Pincodes", "Vehicle", "Shift", "Expected volume", "Planned HC", "Actual HC", "Required HC", "Load per FE", "Signal", "Field Executives"]];
    for (const route of planning.routes.filter(item => item.planDate === planDate && item.status !== "cancelled")) {
      lines.push([route.planDate, stationCode, route.sectorName, route.routeCode, route.routeName, route.pincodes.join("; "), route.vehicleType, route.shiftCode, String(route.expectedVolume), String(route.plannedHeadcount), String(route.actualHeadcount), String(route.requiredHeadcount ?? ""), String(route.loadPerFE?.toFixed(1) ?? ""), route.signal, route.roster.filter(item => !["released", "leave", "absent"].includes(item.rosterStatus)).map(item => item.fieldExecutiveName).join("; ")]);
    }
    const body = lines.map(line => line.map(csv).join(",")).join("\r\n");
    return new NextResponse(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${stationCode}-network-plan-${planDate}.csv"`, "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to export the route plan." }, { status: 500 });
  }
}
