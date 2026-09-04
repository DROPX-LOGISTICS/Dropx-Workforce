import { readAllRows } from "@/lib/supabase-pagination";
import { getAuthorization, hasPermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

function csv(value: unknown) {
  const raw = Array.isArray(value) ? value.map(String).join(" | ") : String(value ?? "");
  const text = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const authorization = await getAuthorization();
  if (!authorization) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (!hasPermission(authorization, "workforce_payroll", "view") || !authorization.hasAllLocationAccess) return Response.json({ error: "Payroll export access denied." }, { status: 403 });
  if (!supabaseAdmin) return Response.json({ error: "Database service is unavailable." }, { status: 503 });
  const companyId = requireCompanyId(authorization);
  const [runResult, itemResult] = await Promise.all([
    supabaseAdmin.from("workforce_payroll_runs").select("id, run_number, period_start, period_end, status").eq("company_id", companyId).eq("id", params.id).maybeSingle(),
    readAllRows(supabaseAdmin.from("workforce_payroll_items").select("dropx_id, worker_name, station_code, bank_account_no, ifsc_code, provider_member_ids, work_days, shipment_count, activity_count, base_amount, incentive_amount, adjustment_amount, deduction_amount, gross_amount, net_amount, status, hold_reasons").eq("company_id", companyId).eq("payroll_run_id", params.id).order("worker_name").order("id"))
  ]);
  if (runResult.error || !runResult.data) return Response.json({ error: "Payroll run was not found." }, { status: 404 });
  if (itemResult.error) return Response.json({ error: itemResult.error.message }, { status: 500 });
  const run = runResult.data;
  const headers = ["Run Number", "Period Start", "Period End", "Run Status", "DropX ID", "Associate", "Station", "Bank Account Number", "IFSC", "Provider IDs", "Work Days", "Shipments", "Activity", "Base", "Incentive", "Additions", "Deductions", "Gross", "Net", "Item Status", "Hold Reasons"];
  const rows = (itemResult.data ?? []).map((item) => [
    run.run_number, run.period_start, run.period_end, run.status,
    item.dropx_id, item.worker_name, item.station_code, item.bank_account_no, item.ifsc_code, item.provider_member_ids, item.work_days,
    item.shipment_count, item.activity_count, item.base_amount, item.incentive_amount, item.adjustment_amount,
    item.deduction_amount, item.gross_amount, item.net_amount, item.status, item.hold_reasons
  ]);
  const body = [headers, ...rows].map((row) => row.map(csv).join(",")).join("\n");
  return new Response(`\uFEFF${body}`, {
    headers: {
      "Content-Disposition": `attachment; filename="${run.run_number}.csv"`,
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "private, no-store"
    }
  });
}
