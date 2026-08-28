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

async function insertChunks(table: string, rows: Array<Record<string, unknown>>, size = 400) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  for (let start = 0; start < rows.length; start += size) {
    const result = await supabaseAdmin.from(table).insert(rows.slice(start, start + size));
    if (result.error) throw new Error(result.error.message);
  }
}

async function recordPayrollEvent(event: Record<string, unknown>) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const result = await supabaseAdmin.from("workforce_payroll_events").insert(event);
  if (result.error) throw new Error(`Payroll changed, but its audit event could not be recorded: ${result.error.message}`);
}

async function replacePayrollSnapshot(runId: string, companyId: string, snapshot: WorkforceEarningsSnapshot) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const remove = await supabaseAdmin.from("workforce_payroll_items").delete().eq("company_id", companyId).eq("payroll_run_id", runId);
  if (remove.error) throw new Error(remove.error.message);
  const itemResult = await supabaseAdmin.from("workforce_payroll_items").insert(snapshot.summaries.map((summary) => ({
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
  }))).select("id, workforce_id");
  if (itemResult.error) throw new Error(itemResult.error.message);
  const itemByWorkforce = new Map((itemResult.data ?? []).map((item) => [item.workforce_id, item.id]));
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
  await insertChunks("workforce_payroll_lines", lineRows);

  const adjustmentIds = snapshot.lines.filter((line) => line.sourceType === "adjustment").map((line) => line.sourceId);
  if (adjustmentIds.length) {
    const adjustmentUpdate = await supabaseAdmin.from("workforce_adjustments").update({ status: "posted", payroll_run_id: runId, updated_at: new Date().toISOString() }).eq("company_id", companyId).in("id", adjustmentIds);
    if (adjustmentUpdate.error) throw new Error(adjustmentUpdate.error.message);
  }

  const readySummaries = snapshot.summaries.filter((summary) => summary.status === "ready");
  const update = await supabaseAdmin.from("workforce_payroll_runs").update({
    worker_count: snapshot.summaries.length,
    shipment_count: snapshot.totalShipments,
    base_amount: snapshot.totalBase,
    incentive_amount: snapshot.totalIncentives,
    adjustment_amount: snapshot.totalAdjustments,
    deduction_amount: snapshot.totalDeductions,
    net_amount: readySummaries.reduce((sum, summary) => sum + summary.netAmount, 0),
    ready_count: snapshot.readyWorkers,
    hold_count: snapshot.heldWorkers,
    exception_count: snapshot.exceptions.length,
    source_updated_at: snapshot.latestSourceUpdate,
    calculated_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }).eq("company_id", companyId).eq("id", runId);
  if (update.error) throw new Error(update.error.message);
}

async function refreshPayrollTotals(runId: string, companyId: string) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const result = await supabaseAdmin.from("workforce_payroll_items").select("status, shipment_count, base_amount, incentive_amount, adjustment_amount, deduction_amount, net_amount").eq("company_id", companyId).eq("payroll_run_id", runId);
  if (result.error) throw new Error(result.error.message);
  const rows = result.data ?? [];
  const included = rows.filter((row) => row.status !== "excluded");
  const payable = included.filter((row) => row.status === "ready" || row.status === "paid");
  const update = await supabaseAdmin.from("workforce_payroll_runs").update({
    worker_count: included.length,
    shipment_count: included.reduce((sum, row) => sum + Number(row.shipment_count ?? 0), 0),
    base_amount: included.reduce((sum, row) => sum + Number(row.base_amount ?? 0), 0),
    incentive_amount: included.reduce((sum, row) => sum + Number(row.incentive_amount ?? 0), 0),
    adjustment_amount: included.reduce((sum, row) => sum + Number(row.adjustment_amount ?? 0), 0),
    deduction_amount: included.reduce((sum, row) => sum + Number(row.deduction_amount ?? 0), 0),
    net_amount: payable.reduce((sum, row) => sum + Number(row.net_amount ?? 0), 0),
    ready_count: payable.length,
    hold_count: included.filter((row) => row.status === "hold").length,
    updated_at: new Date().toISOString()
  }).eq("company_id", companyId).eq("id", runId);
  if (update.error) throw new Error(update.error.message);
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
    const created = await supabaseAdmin.from("workforce_payroll_runs").insert({
      company_id: companyId,
      run_number: runNumber,
      period_start: range.from,
      period_end: range.to,
      status: "draft",
      created_by: authorization.userId
    }).select("id").single();
    if (created.error) throw new Error(created.error.message);
    const runId = created.data.id;
    createdId = runId;
    try {
      await replacePayrollSnapshot(runId, companyId, snapshot);
      await recordPayrollEvent({ company_id: companyId, payroll_run_id: runId, event_code: "run_created", to_status: "draft", actor_user_id: authorization.userId, metadata: { from: range.from, to: range.to } });
    } catch (snapshotError) {
      await supabaseAdmin.from("workforce_adjustments").update({ status: "approved", payroll_run_id: null, updated_at: new Date().toISOString() }).eq("company_id", companyId).eq("payroll_run_id", runId).eq("status", "posted");
      await supabaseAdmin.from("workforce_payroll_runs").delete().eq("company_id", companyId).eq("id", runId);
      throw snapshotError;
    }
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
    const current = await supabaseAdmin.from("workforce_payroll_runs").select("id, period_start, period_end, status").eq("company_id", companyId).eq("id", id).maybeSingle();
    if (current.error) throw new Error(current.error.message);
    if (!current.data || current.data.status !== "draft") throw new Error("Only a draft payroll run can be recalculated.");
    const snapshot = await loadWorkforceEarnings(authorization, current.data.period_start, current.data.period_end, { payrollRunId: id });
    if (snapshot.warnings.length) throw new Error(snapshot.warnings.join(" "));
    await replacePayrollSnapshot(id, companyId, snapshot);
    await recordPayrollEvent({ company_id: companyId, payroll_run_id: id, event_code: "run_recalculated", from_status: "draft", to_status: "draft", actor_user_id: authorization.userId, metadata: { sourceUpdatedAt: snapshot.latestSourceUpdate } });
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
    const run = await supabaseAdmin.from("workforce_payroll_runs").select("status").eq("company_id", companyId).eq("id", runId).maybeSingle();
    if (run.error) throw new Error(run.error.message);
    if (run.data?.status !== "draft") throw new Error("Items can be changed only while payroll is a draft.");
    const item = await supabaseAdmin.from("workforce_payroll_items").select("id, status, hold_reasons").eq("company_id", companyId).eq("payroll_run_id", runId).eq("id", itemId).maybeSingle();
    if (item.error) throw new Error(item.error.message);
    if (!item.data) throw new Error("Payroll item was not found.");
    const holds = Array.isArray(item.data.hold_reasons) ? item.data.hold_reasons : [];
    const next = disposition === "exclude" ? "excluded" : holds.length ? "hold" : "ready";
    const update = await supabaseAdmin.from("workforce_payroll_items").update({ status: next, updated_at: new Date().toISOString() })
      .eq("company_id", companyId).eq("payroll_run_id", runId).eq("id", itemId).eq("status", item.data.status).select("id").maybeSingle();
    if (update.error) throw new Error(update.error.message);
    if (!update.data) throw new Error("The payroll item changed while you were reviewing it. Refresh and try again.");
    await refreshPayrollTotals(runId, companyId);
    await recordPayrollEvent({ company_id: companyId, payroll_run_id: runId, event_code: disposition === "exclude" ? "item_excluded" : "item_restored", actor_user_id: authorization.userId, metadata: { itemId } });
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
    const current = await supabaseAdmin.from("workforce_payroll_runs").select("id, status, hold_count, exception_count, submitted_by").eq("company_id", companyId).eq("id", id).maybeSingle();
    if (current.error) throw new Error(current.error.message);
    if (!current.data) throw new Error("Payroll run was not found.");
    let nextStatus: string;
    if (action === "submit") {
      if (current.data.status !== "draft") throw new Error("Only a draft run can be submitted.");
      if (Number(current.data.hold_count) > 0 || Number(current.data.exception_count) > 0) throw new Error("Resolve or exclude all holds and clear earning exceptions before review.");
      nextStatus = "review";
    } else if (action === "approve") {
      if (!isCompanyOwner(authorization)) throw new Error("Only the company owner can approve payroll.");
      if (current.data.status !== "review") throw new Error("Payroll must be in review before approval.");
      if (current.data.submitted_by === authorization.userId) throw new Error("Maker-checker control does not allow you to approve payroll that you submitted.");
      nextStatus = "approved";
    } else if (action === "paid") {
      if (!isCompanyOwner(authorization)) throw new Error("Only the company owner can mark payroll paid.");
      if (current.data.status !== "approved") throw new Error("Only approved payroll can be marked paid.");
      nextStatus = "paid";
    } else if (action === "cancel") {
      if (!isCompanyOwner(authorization)) throw new Error("Only the company owner can cancel payroll.");
      if (!["draft", "review"].includes(current.data.status)) throw new Error("Approved or paid payroll cannot be cancelled.");
      nextStatus = "cancelled";
    } else throw new Error("Choose a valid payroll action.");

    const now = new Date().toISOString();
    const payload: Record<string, unknown> = { status: nextStatus, updated_at: now };
    if (nextStatus === "review") Object.assign(payload, { submitted_by: authorization.userId, submitted_at: now });
    if (nextStatus === "approved") Object.assign(payload, { approved_by: authorization.userId, approved_at: now, approval_remarks: text(formData.get("remarks")) || null });
    if (nextStatus === "paid") Object.assign(payload, { paid_by: authorization.userId, paid_at: now });
    const update = await supabaseAdmin.from("workforce_payroll_runs").update(payload)
      .eq("company_id", companyId).eq("id", id).eq("status", current.data.status).select("id").maybeSingle();
    if (update.error) throw new Error(update.error.message);
    if (!update.data) throw new Error("The payroll status changed while you were reviewing it. Refresh and try again.");
    if (nextStatus === "paid") {
      const items = await supabaseAdmin.from("workforce_payroll_items").update({ status: "paid", updated_at: now }).eq("company_id", companyId).eq("payroll_run_id", id).eq("status", "ready");
      if (items.error) throw new Error(items.error.message);
    }
    if (nextStatus === "cancelled") {
      const release = await supabaseAdmin.from("workforce_adjustments").update({ status: "approved", payroll_run_id: null, updated_at: now }).eq("company_id", companyId).eq("payroll_run_id", id).eq("status", "posted");
      if (release.error) throw new Error(release.error.message);
    }
    await recordPayrollEvent({ company_id: companyId, payroll_run_id: id, event_code: `run_${nextStatus}`, from_status: current.data.status, to_status: nextStatus, actor_user_id: authorization.userId, remarks: text(formData.get("remarks")) || null });
    revalidatePath(path);
    revalidatePath(`${path}/${id}`);
  } catch (error) {
    finish("error", error instanceof Error ? error.message : "Unable to update payroll status.", id);
  }
  finish("notice", `Payroll marked ${action === "submit" ? "in review" : action}.`, id);
}
