import { NextRequest, NextResponse } from "next/server";
import { resolveConnectWorkforceAccount } from "@/lib/connect-workforce-account";
import { supabaseAdmin } from "@/lib/supabase-admin";

function amount(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(row: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = String(row[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

async function payments(companyId: string, workforceId: string) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const itemsResult = await supabaseAdmin.from("workforce_payroll_items")
    .select("id,payroll_run_id,shipment_count,activity_count,work_days,base_amount,incentive_amount,adjustment_amount,deduction_amount,gross_amount,net_amount,status,created_at")
    .eq("company_id", companyId)
    .eq("workforce_id", workforceId)
    .order("created_at", { ascending: false })
    .limit(24);
  if (itemsResult.error) throw new Error(itemsResult.error.message);
  const runIds = Array.from(new Set((itemsResult.data ?? []).map((item) => item.payroll_run_id)));
  const runsResult = runIds.length
    ? await supabaseAdmin.from("workforce_payroll_runs")
      .select("id,run_number,period_start,period_end,status,approved_at,paid_at")
      .eq("company_id", companyId)
      .in("id", runIds)
    : { data: [], error: null };
  if (runsResult.error) throw new Error(runsResult.error.message);
  const runById = new Map((runsResult.data ?? []).map((run) => [run.id, run]));
  return (itemsResult.data ?? []).map((item) => ({
    id: item.id,
    run: runById.get(item.payroll_run_id) ?? null,
    shipments: amount(item.shipment_count),
    activities: amount(item.activity_count),
    workDays: amount(item.work_days),
    baseAmount: amount(item.base_amount),
    incentiveAmount: amount(item.incentive_amount),
    adjustmentAmount: amount(item.adjustment_amount),
    deductionAmount: amount(item.deduction_amount),
    grossAmount: amount(item.gross_amount),
    netAmount: amount(item.net_amount),
    status: item.status
  }));
}

async function advances(companyId: string, workforceId: string) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const result = await supabaseAdmin.from("payment_advance_requests")
    .select("*")
    .eq("company_id", companyId)
    .eq("profile_type", "workforce")
    .eq("account_id", workforceId)
    .order("updated_at", { ascending: false })
    .limit(24);
  if (result.error) {
    const missing = String(result.error.message ?? "").toLowerCase();
    if (missing.includes("does not exist") || missing.includes("schema cache")) return [];
    throw new Error(result.error.message);
  }
  return (result.data ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      id: text(row, "id"),
      requestNumber: text(row, "request_no", "request_number", "reference_no"),
      requestedAmount: amount(row.requested_amount ?? row.amount),
      approvedAmount: amount(row.approved_amount),
      recoveredAmount: amount(row.recovered_amount),
      reason: text(row, "reason", "remarks", "purpose"),
      status: text(row, "status", "approval_status") || "pending",
      requestedAt: text(row, "requested_at", "created_at"),
      updatedAt: text(row, "updated_at")
    };
  });
}

async function roster(companyId: string, workforceId: string) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const result = await supabaseAdmin.from("hr_contractor_shift_assignments")
    .select("id,effective_from,effective_to,notes,hr_shifts(code,name,start_time,end_time,break_minutes,color)")
    .eq("company_id", companyId)
    .eq("workforce_id", workforceId)
    .order("effective_from", { ascending: false })
    .limit(24);
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}

async function performance(companyId: string, workforceId: string) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const result = await supabaseAdmin.from("workforce_payroll_lines")
    .select("id,work_date,provider_name,shipment_count,activity_count,base_amount,incentive_amount,adjustment_amount,net_amount,calculation_source")
    .eq("company_id", companyId)
    .eq("workforce_id", workforceId)
    .order("work_date", { ascending: false })
    .limit(90);
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []).map((item) => ({
    ...item,
    shipment_count: amount(item.shipment_count),
    activity_count: amount(item.activity_count),
    base_amount: amount(item.base_amount),
    incentive_amount: amount(item.incentive_amount),
    adjustment_amount: amount(item.adjustment_amount),
    net_amount: amount(item.net_amount)
  }));
}

export async function GET(request: NextRequest) {
  try {
    const worker = await resolveConnectWorkforceAccount({
      accountId: request.nextUrl.searchParams.get("accountId") ?? "",
      profileType: request.nextUrl.searchParams.get("profileType") ?? ""
    });
    if (worker.profileType !== "workforce") throw new Error("This page is available for Workforce accounts only.");
    const requestedView = request.nextUrl.searchParams.get("view") ?? "payments";
    const view = ["payments", "advances", "roster", "performance"].includes(requestedView) ? requestedView : "payments";
    const records = view === "advances"
      ? await advances(worker.companyId, worker.profileId)
      : view === "roster"
        ? await roster(worker.companyId, worker.profileId)
        : view === "performance"
          ? await performance(worker.companyId, worker.profileId)
          : await payments(worker.companyId, worker.profileId);
    return NextResponse.json({ records, view });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Workforce self service.";
    return NextResponse.json({ error: message }, { status: message.includes("Login") ? 401 : 400 });
  }
}
