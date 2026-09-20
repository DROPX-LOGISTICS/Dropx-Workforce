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

async function rateCard(companyId: string, workforceId: string) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const workforceResult = await supabaseAdmin.from("workforce")
    .select("designation_id,location_id")
    .eq("company_id", companyId)
    .eq("id", workforceId)
    .maybeSingle();
  if (workforceResult.error || !workforceResult.data) throw new Error(workforceResult.error?.message ?? "Workforce profile is unavailable.");
  const workforce = workforceResult.data;
  const mappingResult = await supabaseAdmin.from("field_executive_provider_mappings")
    .select("provider_id,station_id,effective_from,effective_to,status")
    .eq("company_id", companyId)
    .eq("workforce_id", workforceId)
    .neq("status", "cancelled")
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (mappingResult.error) throw new Error(mappingResult.error.message);
  const mapping = mappingResult.data;
  if (!mapping?.provider_id) return [];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const cardsResult = await supabaseAdmin.from("workforce_rate_cards")
    .select("id,name,station_id,designation_id,pay_type,effective_from,effective_to,delivery_rate,return_rate,mfn_rate,mfn_return_rate,fuel_rate,fixed_amount,guarantee_amount,status,notes,provider:providers(name,code)")
    .eq("company_id", companyId)
    .eq("provider_id", mapping.provider_id)
    .eq("status", "active")
    .lte("effective_from", today)
    .or(`effective_to.is.null,effective_to.gte.${today}`)
    .order("effective_from", { ascending: false });
  if (cardsResult.error) throw new Error(cardsResult.error.message);
  const exact = (cardsResult.data ?? []).filter((card) => {
    const row = card as Record<string, unknown>;
    return (!row.station_id || row.station_id === mapping.station_id || row.station_id === workforce.location_id)
      && (!row.designation_id || row.designation_id === workforce.designation_id);
  });
  return exact.map((card) => ({ ...card, stationId: mapping.station_id }));
}

async function connectRequests(companyId: string, workforceId: string) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const result = await supabaseAdmin.from("workforce_connect_requests")
    .select("id,category,subject,detail,status,responder_note,resolved_at,created_at,updated_at")
    .eq("company_id", companyId)
    .eq("workforce_id", workforceId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}

export async function GET(request: NextRequest) {
  try {
    const worker = await resolveConnectWorkforceAccount({
      accountId: request.nextUrl.searchParams.get("accountId") ?? "",
      profileType: request.nextUrl.searchParams.get("profileType") ?? ""
    });
    if (worker.profileType !== "workforce") throw new Error("This page is available for Workforce accounts only.");
    const requestedView = request.nextUrl.searchParams.get("view") ?? "payments";
    const view = ["payments", "advances", "roster", "performance", "rate_card", "connect"].includes(requestedView) ? requestedView : "payments";
    const records = view === "advances"
      ? await advances(worker.companyId, worker.profileId)
      : view === "roster"
        ? await roster(worker.companyId, worker.profileId)
        : view === "performance"
          ? await performance(worker.companyId, worker.profileId)
          : view === "rate_card"
            ? await rateCard(worker.companyId, worker.profileId)
            : view === "connect"
              ? await connectRequests(worker.companyId, worker.profileId)
          : await payments(worker.companyId, worker.profileId);
    return NextResponse.json({ records, view });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Workforce self service.";
    return NextResponse.json({ error: message }, { status: message.includes("Login") ? 401 : 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const body = await request.json();
    const worker = await resolveConnectWorkforceAccount({ accountId: String(body.accountId ?? ""), profileType: String(body.profileType ?? "") });
    if (worker.profileType !== "workforce") throw new Error("Connect is available for Workforce accounts only.");
    const category = String(body.category ?? "").trim();
    const subject = String(body.subject ?? "").trim();
    const detail = String(body.detail ?? "").trim();
    if (!["payment", "provider_id", "route_roster", "document", "other"].includes(category)) throw new Error("Choose a valid support category.");
    if (subject.length < 3 || subject.length > 160) throw new Error("Enter a subject between 3 and 160 characters.");
    if (detail.length < 10 || detail.length > 2000) throw new Error("Describe the issue in at least 10 characters.");
    const result = await supabaseAdmin.from("workforce_connect_requests").insert({
      company_id: worker.companyId, workforce_id: worker.profileId, category, subject, detail
    }).select("id,category,subject,detail,status,responder_note,resolved_at,created_at,updated_at").single();
    if (result.error) throw new Error(result.error.message);
    return NextResponse.json({ ok: true, request: result.data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to submit Connect request.";
    return NextResponse.json({ error: message }, { status: message.includes("Login") ? 401 : 400 });
  }
}
