import { getAuthorization, hasPermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadCodLocations } from "@/lib/ops-pulse/cod";
import { isOpsReportType } from "@/lib/ops-pulse/report-catalog";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function csv(value: unknown) {
  const text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, "\"\"")}"`;
}
function n(value: unknown) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function validDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value); }
function dateDiff(from: string, to: string) { return Math.floor((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000); }
function stationScope(requested: string[], permitted: string[]) {
  const normalized = requested.map((code) => code.trim().toUpperCase()).filter((code) => permitted.includes(code));
  return requested.length ? [...new Set(normalized)] : permitted;
}
function response(headers: string[], rows: unknown[][], filename: string) {
  const body = [headers.map(csv).join(","), ...rows.map((row) => row.map(csv).join(","))].join("\r\n");
  return new Response(`\uFEFF${body}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
}
async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, cap = 100000) {
  const data: T[] = [];
  const size = 1000;
  for (let offset = 0; offset < cap; offset += size) {
    const result = await page(offset, offset + size - 1);
    if (result.error) return { data, error: result.error };
    const rows = result.data ?? [];
    data.push(...rows);
    if (rows.length < size) return { data, error: null };
  }
  return { data: [], error: { message: `This export exceeds ${cap.toLocaleString("en-IN")} rows. Select fewer stations or a shorter date range.` } };
}

export async function GET(request: Request) {
  const authorization = await getAuthorization();
  if (!authorization || !hasPermission(authorization, "cod_reports", "access")) return Response.json({ error: "Report access denied." }, { status: 403 });
  if (!supabaseAdmin) return Response.json({ error: "Database unavailable." }, { status: 500 });
  const db = supabaseAdmin;
  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "";
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!isOpsReportType(type) || !validDate(from) || !validDate(to) || dateDiff(from, to) < 0 || dateDiff(from, to) > 366) {
    return Response.json({ error: "Select a valid report and a date range up to 366 days." }, { status: 400 });
  }
  const companyId = requireCompanyId(authorization);
  const locations = await loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess);
  const permittedCodes = locations.locations.map((row) => row.station_code);
  const codes = stationScope((url.searchParams.get("stations") ?? "").split(",").filter(Boolean), permittedCodes);
  if (!codes.length) return Response.json({ error: "No permitted stations." }, { status: 403 });
  const suffix = `${from}-to-${to}.csv`;

  if (type === "da_delivery" || type === "station_delivery" || type === "capacity") {
    const shipment = await allRows((start, end) => db.from("cps_shipment_daily").select("work_date,station_code,provider_employee_id,provider_employee_name,assigned_count,amazon_delivery,swa_delivery,c_return,mfn,mfn_return,total_delivery,total_activity,mapping_status,da_total_pay")
      .eq("company_id", companyId).in("station_code", codes).gte("work_date", from).lte("work_date", to).order("work_date").range(start, end));
    if (shipment.error) return Response.json({ error: shipment.error.message }, { status: 500 });
    if (type === "da_delivery") return response(
      ["Date", "Station", "Provider Employee ID", "DA Name", "Assigned", "Amazon Delivery", "SWA Delivery", "C-Return", "MFN", "MFN Return", "Total Delivery", "Total Activity", "Mapping Status", "DA Pay"],
      (shipment.data ?? []).map((row) => [row.work_date, row.station_code, row.provider_employee_id, row.provider_employee_name, row.assigned_count, row.amazon_delivery, row.swa_delivery, row.c_return, row.mfn, row.mfn_return, row.total_delivery, row.total_activity, row.mapping_status, row.da_total_pay]),
      `da-delivery-${suffix}`
    );
    const map = new Map<string, { date: string; station: string; assigned: number; amazon: number; swa: number; cReturn: number; mfn: number; mfnReturn: number; delivery: number; activity: number; das: Set<string> }>();
    (shipment.data ?? []).forEach((row) => { const key = `${row.work_date}|${row.station_code}`; const item = map.get(key) ?? { date: row.work_date, station: row.station_code, assigned: 0, amazon: 0, swa: 0, cReturn: 0, mfn: 0, mfnReturn: 0, delivery: 0, activity: 0, das: new Set<string>() }; item.assigned += n(row.assigned_count); item.amazon += n(row.amazon_delivery); item.swa += n(row.swa_delivery); item.cReturn += n(row.c_return); item.mfn += n(row.mfn); item.mfnReturn += n(row.mfn_return); item.delivery += n(row.total_delivery); item.activity += n(row.total_activity); if (row.provider_employee_id) item.das.add(row.provider_employee_id); map.set(key, item); });
    const attendance = type === "capacity" ? await allRows((start, end) => db.from("attendance_daily").select("punch_date,station_code,status,enrolment_id").eq("company_id", companyId).in("station_code", codes).gte("punch_date", from).lte("punch_date", to).range(start, end)) : { data: [], error: null };
    if (attendance.error) return Response.json({ error: attendance.error.message }, { status: 500 });
    const present = new Map<string, Set<string>>();
    (attendance.data ?? []).forEach((row) => { if (!/^(P|PRESENT)$/i.test(row.status ?? "")) return; const key = `${row.punch_date}|${row.station_code}`; const set = present.get(key) ?? new Set<string>(); if (row.enrolment_id) set.add(row.enrolment_id); present.set(key, set); });
    const rows = [...map.values()].sort((a, b) => `${a.date}${a.station}`.localeCompare(`${b.date}${b.station}`));
    if (type === "capacity") return response(["Date", "Station", "Present Capacity", "Active Delivery DAs", "Assigned Packages", "Delivered Packages", "SPR (Delivered / Active DA)", "Assignment per Active DA", "Delivery Rate"], rows.map((row) => [row.date, row.station, present.get(`${row.date}|${row.station}`)?.size ?? 0, row.das.size, row.assigned, row.delivery, row.das.size ? (row.delivery / row.das.size).toFixed(2) : 0, row.das.size ? (row.assigned / row.das.size).toFixed(2) : 0, row.assigned ? `${(row.delivery / row.assigned * 100).toFixed(2)}%` : ""]), `capacity-productivity-${suffix}`);
    return response(["Date", "Station", "Assigned", "Amazon Delivery", "SWA Delivery", "C-Return", "MFN", "MFN Return", "Total Delivery", "Total Activity", "Active DAs", "SPR"], rows.map((row) => [row.date, row.station, row.assigned, row.amazon, row.swa, row.cReturn, row.mfn, row.mfnReturn, row.delivery, row.activity, row.das.size, row.das.size ? (row.delivery / row.das.size).toFixed(2) : 0]), `station-delivery-${suffix}`);
  }

  if (type === "attendance") {
    const result = await allRows((start, end) => db.from("attendance_daily").select("punch_date,station_code,worker_name,employee_code,enrolment_id,status,punch_count,in_time,out_time,work_minutes,remark").eq("company_id", companyId).in("station_code", codes).gte("punch_date", from).lte("punch_date", to).order("punch_date").range(start, end));
    if (result.error) return Response.json({ error: result.error.message }, { status: 500 });
    return response(["Date", "Station", "Worker", "Employee Code", "Enrolment ID", "Status", "Punches", "In", "Out", "Work Minutes", "Remark"], (result.data ?? []).map((row) => [row.punch_date, row.station_code, row.worker_name, row.employee_code, row.enrolment_id, row.status, row.punch_count, row.in_time, row.out_time, row.work_minutes, row.remark]), `attendance-${suffix}`);
  }
  if (type === "cps") {
    const result = await allRows<Record<string, unknown>>((start, end) => db.from("cps_station_daily").select("*").eq("company_id", companyId).in("station_code", codes).gte("work_date", from).lte("work_date", to).order("work_date").range(start, end));
    if (result.error) return Response.json({ error: result.error.message }, { status: 500 });
    const headers = ["Date", "Station", "Delivery", "Activity", "DA Cost", "Staff Cost", "Fuel Cost", "Vehicle Cost", "Rent Cost", "Other Cost", "Total Cost", "DA CPS", "Staff CPS", "Fuel CPS", "Other CPS", "Overall CPS", "Target CPS", "Target Gap", "Target Impact"];
    return response(headers, (result.data ?? []).map((r) => [r.work_date, r.station_code, r.total_delivery, r.total_activity, r.da_pay_cost, r.staff_cost, r.fuel_cost, r.vehicle_cost, r.rent_cost, r.other_cost, r.total_cost, r.da_cps, r.staff_cps, r.fuel_cps, r.other_cps, r.overall_cps, r.target_cps, r.target_gap, r.target_impact]), `station-cps-${suffix}`);
  }
  if (type === "cod") {
    const result = await allRows((start, end) => db.from("cod_submissions").select("created_at,station_code,client,cod_period_from,cod_period_to,deposit_date,remittance_code,cod_amount,deposited_amount,validated_amount,validation_status,validation_remarks,submitter_name").eq("company_id", companyId).in("station_code", codes).gte("created_at", `${from}T00:00:00+05:30`).lte("created_at", `${to}T23:59:59+05:30`).order("created_at").range(start, end));
    if (result.error) return Response.json({ error: result.error.message }, { status: 500 });
    return response(["Submitted At", "Station", "Client", "Period From", "Period To", "Deposit Date", "Remittance", "COD Amount", "Deposited", "Validated", "Validation Status", "Remarks", "Submitter"], (result.data ?? []).map((r) => [r.created_at, r.station_code, r.client, r.cod_period_from, r.cod_period_to, r.deposit_date, r.remittance_code, r.cod_amount, r.deposited_amount, r.validated_amount, r.validation_status, r.validation_remarks, r.submitter_name]), `cod-status-${suffix}`);
  }
  const result = await allRows((start, end) => db.from("ops_daily_submissions").select("business_date,station_code,submission_no,submitter_name,status,manager_status,manager_remarks,manager_reviewed_at,created_at").eq("company_id", companyId).in("station_code", codes).gte("business_date", from).lte("business_date", to).order("business_date").range(start, end));
  if (result.error) return Response.json({ error: result.error.message }, { status: 500 });
  return response(["Business Date", "Station", "Submission No", "Submitter", "Status", "Manager Status", "Manager Remarks", "Reviewed At", "Submitted At"], (result.data ?? []).map((r) => [r.business_date, r.station_code, r.submission_no, r.submitter_name, r.status, r.manager_status, r.manager_remarks, r.manager_reviewed_at, r.created_at]), `daily-closure-${suffix}`);
}
