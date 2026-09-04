"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isCompanyOwner, requirePagePermission, type AuthorizationContext } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadWorkforceEarnings, workforceEarningsDateRange, type WorkforceEarningsSnapshot } from "@/lib/workforce-earnings";
import { supabaseAdmin } from "@/lib/supabase-admin";

const path = "/delivery-network/payroll";
function text(value: FormDataEntryValue | null) { return String(value ?? "").trim(); }
function finish(kind: "notice" | "error", message: string, id?: string): never { redirect(`${path}${id ? `/${id}` : ""}?${kind}=${encodeURIComponent(message)}`); }

function requireNetworkPayrollScope(authorization: AuthorizationContext) {
  if (!authorization.hasAllLocationAccess) throw new Error("Payroll runs require all-location access. Station users can review live earnings for their own scope.");
}

async function replacePayrollSnapshot(runId: string, companyId: string, snapshot: WorkforceEarningsSnapshot, actorId: string, run: Record<string, unknown>) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const itemRows = snapshot.summaries.map((summary) => ({
    id: crypto.randomUUID(),
    company_id: companyId,
    payroll_run_id: runId,
    workforce_id: summary.workforceId,
    dropx_id: summary.dropxId,
    worker_name: summary.workerName,
    station_code: summary.stationCode,
    bank_account_no: summary.bankAccountNo || null,
    ifsc_code: summary.ifscCode || null,
    shipment_count: summary.shipmentCount,
    activity_count: summary.activityCount,
    work_days: summary.workDays,
    base_amount: summary.baseAmount,
    incentive_amount: summary.incentiveAmount,
    adjustment_amount: summary.earningAdjustments,
    deduction_amount: summary.deductions,
    gross_amount: summary.grossAmount,
    net_amount: summary.netAmount,
    status: summary.status,
    hold_reasons: summary.holdReasons,
    provider_member_ids: summary.providerIds
  }));
  const itemByWorkforce = new Map(itemRows.map((item) => [item.workforce_id, item.id]));
  const lineRows = snapshot.lines.filter((line) => line.workforceId && itemByWorkforce.has(line.workforceId)).map((line) => ({
    company_id: companyId,
    payroll_run_id: runId,
    payroll_item_id: itemByWorkforce.get(line.workforceId!),
    workforce_id: line.workforceId,
    source_type: line.sourceType,
    source_id: line.sourceId,
    work_date: line.workDate,
    provider_name: line.providerName,
    provider_member_id: line.providerMemberId === "-" ? null : line.providerMemberId,
    shipment_count: line.totalDelivery,
    activity_count: line.totalActivity,
    base_amount: line.baseAmount,
    incentive_amount: line.incentiveAmount,
    adjustment_amount: line.adjustmentAmount,
    net_amount: line.netAmount,
    calculation_source: line.calculationSource,
    calculation_snapshot: line.trace
  }));
  const result = await supabaseAdmin.rpc("workforce_save_payroll_snapshot", {
    p_company: companyId, p_actor: actorId,
    p_run: { ...run, id: runId, exception_count: snapshot.exceptions.length, source_updated_at: snapshot.latestSourceUpdate },
    p_items: itemRows, p_lines: lineRows,
    p_adjustments: [...new Set(snapshot.lines.filter((line) => line.sourceType === "adjustment").map((line) => line.sourceId))]
  });
  if (result.error) throw new Error(result.error.message);
}

export async function createPayrollRun(formData: FormData) {
  const authorization = await requirePagePermission("workforce_payroll", "add");
  const companyId = requireCompanyId(authorization);
  let createdId: string | null = null;
  try {
    requireNetworkPayrollScope(authorization);
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const range = workforceEarningsDateRange({ from: text(formData.get("from")), to: text(formData.get("to")) });
    if (range.from !== text(formData.get("from")) || range.to !== text(formData.get("to"))) throw new Error("Payroll period must be valid and no longer than 93 days.");
    const overlapping = await supabaseAdmin.from("workforce_payroll_runs").select("id, run_number, period_start, period_end, status")
      .eq("company_id", companyId).neq("status", "cancelled").lte("period_start", range.to).gte("period_end", range.from).limit(1);
    if (overlapping.error) throw new Error(overlapping.error.message);
    if (overlapping.data?.length) throw new Error(`Payroll period overlaps ${overlapping.data[0].run_number} (${overlapping.data[0].period_start} to ${overlapping.data[0].period_end}). Cancel the existing run or choose a non-overlapping period.`);
    const snapshot = await loadWorkforceEarnings(authorization, range.from, range.to, { payrollRunId: null });
    if (snapshot.setupRequired) throw new Error("Workforce finance migration must complete before payroll can be created.");
    if (snapshot.warnings.length) throw new Error(snapshot.warnings.join(" "));
    if (!snapshot.summaries.length) throw new Error("No mapped Workforce earnings were found for this period.");
    const runNumber = `WF-${range.from.replaceAll("-", "")}-${range.to.replaceAll("-", "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const runId = crypto.randomUUID();
    await replacePayrollSnapshot(runId, companyId, snapshot, authorization.userId, {
      run_number: runNumber, period_start: range.from, period_end: range.to
    });
    createdId = runId;
  } catch (error) {
    finish("error", error instanceof Error ? error.message : "Unable to create payroll run.");
  }
  if (!createdId) finish("error", "Unable to create payroll run.");
  revalidatePath(path);
  redirect(`${path}/${createdId}?notice=${encodeURIComponent("Draft payroll created from the latest source data.")}`);
}

export async function recalculatePayrollRun(formData: FormData) {
  const authorization = await requirePagePermission("workforce_payroll", "edit");
  const companyId = requireCompanyId(authorization);
  const id = text(formData.get("id"));
  try {
    requireNetworkPayrollScope(authorization);
    if (!supabaseAdmin || !id) throw new Error("Payroll run is required.");
    const current = await supabaseAdmin.from("workforce_payroll_runs").select("id, period_start, period_end, status, updated_at").eq("company_id", companyId).eq("id", id).maybeSingle();
    if (current.error) throw new Error(current.error.message);
    if (!current.data || current.data.status !== "draft") throw new Error("Only a draft payroll run can be recalculated.");
    const snapshot = await loadWorkforceEarnings(authorization, current.data.period_start, current.data.period_end, { payrollRunId: id });
    if (snapshot.warnings.length) throw new Error(snapshot.warnings.join(" "));
    if (snapshot.setupRequired) throw new Error("Finance storage is not ready. Recalculation has been cancelled.");
    await replacePayrollSnapshot(id, companyId, snapshot, authorization.userId, { expected_updated_at: current.data.updated_at });
    revalidatePath(`${path}/${id}`);
  } catch (error) {
    finish("error", error instanceof Error ? error.message : "Unable to recalculate payroll.", id);
  }
  finish("notice", "Draft payroll recalculated from current shipments, rates, incentives and approved adjustments.", id);
}

export async function setPayrollItemDisposition(formData: FormData) {
  const authorization = await requirePagePermission("workforce_payroll", "edit");
  const companyId = requireCompanyId(authorization);
  const runId = text(formData.get("run_id"));
  try {
    requireNetworkPayrollScope(authorization);
    if (!supabaseAdmin || !runId) throw new Error("Payroll run is required.");
    const itemId = text(formData.get("item_id"));
    const disposition = text(formData.get("disposition"));
    if (!itemId || !["exclude", "restore"].includes(disposition)) throw new Error("Choose a valid payroll item action.");
    const result = await supabaseAdmin.rpc("workforce_set_payroll_item", { p_company: companyId, p_run: runId, p_item: itemId, p_actor: authorization.userId, p_disposition: disposition });
    if (result.error) throw new Error(result.error.message);
    revalidatePath(`${path}/${runId}`);
  } catch (error) {
    finish("error", error instanceof Error ? error.message : "Unable to update payroll item.", runId);
  }
  finish("notice", "Payroll item updated.", runId);
}

export async function changePayrollRunStatus(formData: FormData) {
  const authorization = await requirePagePermission("workforce_payroll", "edit");
  const companyId = requireCompanyId(authorization);
  const id = text(formData.get("id"));
  const action = text(formData.get("action"));
  try {
    requireNetworkPayrollScope(authorization);
    if (!supabaseAdmin || !id) throw new Error("Payroll run is required.");
    const result = await supabaseAdmin.rpc("workforce_change_payroll_state", {
      p_company: companyId, p_run: id, p_actor: authorization.userId, p_action: action,
      p_owner: isCompanyOwner(authorization), p_remarks: text(formData.get("remarks")) || null,
      p_reference: text(formData.get("payment_reference")) || null,
      p_payment_date: text(formData.get("payment_date")) || null
    });
    if (result.error) throw new Error(result.error.message);
    revalidatePath(path);
    revalidatePath(`${path}/${id}`);
  } catch (error) {
    finish("error", error instanceof Error ? error.message : "Unable to update payroll status.", id);
  }
  finish("notice", `Payroll marked ${action === "submit" ? "in review" : action}.`, id);
}
