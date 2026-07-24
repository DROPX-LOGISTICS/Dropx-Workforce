import { NextResponse } from "next/server";
import { getAuthorization, hasPermission } from "@/lib/authorization";
import { canAccessCodAudit } from "@/lib/ops-pulse/cod-audit";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

function csvCell(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return `"${text.replace(/"/g, "\"\"")}"`;
}

export async function GET(request: Request) {
  const authorization = await getAuthorization();
  if (!authorization) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasPermission(authorization, "cod_executive_reconciliation", "access") || !canAccessCodAudit(authorization)) {
    return NextResponse.json({ error: "Manager or owner access is required." }, { status: 403 });
  }
  if (!supabaseAdmin || !authorization.companyId) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 500 });
  }

  const url = new URL(request.url);
  const businessDate = url.searchParams.get("date")?.trim() ?? "";
  const locationId = url.searchParams.get("location")?.trim() ?? "";
  if (!businessDate) return NextResponse.json({ error: "date is required." }, { status: 400 });
  if (locationId && !authorization.hasAllLocationAccess && !authorization.locationScopeIds.includes(locationId)) {
    return NextResponse.json({ error: "Station access denied." }, { status: 403 });
  }

  let query = supabaseAdmin
    .from("cod_reconciliation_audit_log")
    .select("business_date, station_code, provider_employee_id, associate_name, action, changed_fields, before_data, after_data, actor_name, actor_email, actor_role, created_at")
    .eq("company_id", authorization.companyId)
    .eq("business_date", businessDate)
    .order("created_at", { ascending: true })
    .limit(10000);
  if (locationId) query = query.eq("location_id", locationId);
  if (!locationId && !authorization.hasAllLocationAccess) {
    query = query.in("location_id", authorization.locationScopeIds.length
      ? authorization.locationScopeIds
      : ["00000000-0000-0000-0000-000000000000"]);
  }
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const headers = [
    "Timestamp", "Business Date", "Station", "Executive ID", "Associate",
    "Action", "Changed Fields", "Before", "After", "Actor", "Actor Email", "Actor Role"
  ];
  const lines = [
    headers.map(csvCell).join(","),
    ...(data ?? []).map((row) => [
      row.created_at,
      row.business_date,
      row.station_code,
      row.provider_employee_id,
      row.associate_name,
      row.action,
      row.changed_fields,
      row.before_data,
      row.after_data,
      row.actor_name,
      row.actor_email,
      row.actor_role
    ].map(csvCell).join(","))
  ];

  return new Response(`\uFEFF${lines.join("\r\n")}`, {
    status: 200,
    headers: {
      "Content-Disposition": `attachment; filename="cod-audit-${businessDate}.csv"`,
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
