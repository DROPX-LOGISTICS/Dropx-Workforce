import { sendEmail } from "@/lib/email";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type CodGateStatus =
  | "Not run" | "Locked" | "Queued" | "Running" | "Passed" | "Pending"
  | "Manual Review" | "Exception requested" | "Exception approved" | "Exception rejected" | "Error";

export type CodDayClosure = {
  id: string;
  business_date: string;
  location_id: string;
  station_code: string;
  collected_cod: number | string;
  amazon_open_remittance_expected: number | string;
  amazon_open_remittance_count: number;
  difference_amount: number | string;
  driver_reconciliation_pending: number | string;
  no_deposit_liability: boolean;
  validation_status: string;
  submission_status: string;
  manager_status: string;
  override_reason: string | null;
  validation_snapshot: Record<string, unknown>;
  submitted_at: string;
  driver_check_status: CodGateStatus;
  driver_exception_reason: string | null;
  driver_exception_manager_remarks: string | null;
  deposit_check_status: CodGateStatus;
  deposit_exception_reason: string | null;
  deposit_exception_manager_remarks: string | null;
  is_final_submitted: boolean;
  final_submitted_at: string | null;
};

type PortalRun = {
  check_type: "driver_reconciliation" | "prepared_deposit";
  status: string;
  pending_count: number | string | null;
  pending_amount: number | string | null;
  raw_result: unknown;
  evidence: unknown;
  last_checked_at: string | null;
};

function amount(value: unknown) {
  const parsed = Number(String(value ?? "0").replace(/[,₹\s]/g, ""));
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function rawObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function latestRuns(rows: PortalRun[]) {
  const result = new Map<string, PortalRun>();
  rows.forEach((run) => {
    if (!result.has(run.check_type)) result.set(run.check_type, run);
  });
  return result;
}

function runStatus(run: PortalRun | undefined): CodGateStatus {
  if (!run) return "Not run";
  if (run.status === "Queued") return "Queued";
  if (run.status === "Running") return "Running";
  if (run.status === "Manual Review") return "Manual Review";
  if (run.status === "Error") return "Error";
  return run.status === "Pass" ? "Passed" : "Pending";
}

function preserveGateStatus(stored: CodGateStatus, derived: CodGateStatus) {
  if (stored.startsWith("Exception ")) return stored;
  if (stored === "Not run" || stored === "Locked") return stored;
  return derived;
}

function depositDetails(run: PortalRun | undefined) {
  const raw = rawObject(run?.raw_result);
  const evidence = rawObject(run?.evidence);
  const openRemittances = Array.isArray(raw.open_remittances)
    ? raw.open_remittances
    : Array.isArray(evidence.open_remittances) ? evidence.open_remittances : [];
  return {
    noLiability: Boolean(raw.no_deposit_liability ?? evidence.no_deposit_liability),
    openExpected: amount(raw.open_remittance_expected ?? evidence.open_remittance_expected),
    openRemittances
  };
}

export async function loadCodDayClosures(companyId: string, businessDate: string, locationIds: string[]) {
  if (!supabaseAdmin || !locationIds.length) return [] as CodDayClosure[];
  const [closures, runs] = await Promise.all([
    supabaseAdmin
      .from("cod_day_closures")
      .select("id, business_date, location_id, station_code, collected_cod, amazon_open_remittance_expected, amazon_open_remittance_count, difference_amount, driver_reconciliation_pending, no_deposit_liability, validation_status, submission_status, manager_status, override_reason, validation_snapshot, submitted_at, driver_check_status, driver_exception_reason, driver_exception_manager_remarks, deposit_check_status, deposit_exception_reason, deposit_exception_manager_remarks, is_final_submitted, final_submitted_at")
      .eq("company_id", companyId)
      .eq("business_date", businessDate)
      .in("location_id", locationIds)
      .order("station_code"),
    supabaseAdmin
      .from("ops_portal_check_runs")
      .select("location_id, check_type, status, pending_count, pending_amount, raw_result, evidence, last_checked_at")
      .eq("company_id", companyId)
      .eq("check_date", businessDate)
      .in("location_id", locationIds)
      .order("last_checked_at", { ascending: false })
  ]);
  if (closures.error) return [] as CodDayClosure[];

  return ((closures.data ?? []) as CodDayClosure[]).map((closure) => {
    const locationRuns = (runs.data ?? []).filter((run) => run.location_id === closure.location_id) as PortalRun[];
    const latest = latestRuns(locationRuns);
    const driver = latest.get("driver_reconciliation");
    const deposit = latest.get("prepared_deposit");
    const driverDerived = runStatus(driver);
    const driverStatus = preserveGateStatus(closure.driver_check_status, driverDerived);
    const driverCleared = driverStatus === "Passed" || driverStatus === "Exception approved";
    const depositDerived = driverCleared ? runStatus(deposit) : "Locked";
    const depositStatus = closure.deposit_check_status === "Locked" && driverCleared
      ? "Not run"
      : preserveGateStatus(closure.deposit_check_status, depositDerived);
    const depositData = depositDetails(deposit);
    return {
      ...closure,
      driver_check_status: driverStatus,
      driver_reconciliation_pending: amount(driver?.pending_amount),
      deposit_check_status: depositStatus,
      no_deposit_liability: depositData.noLiability,
      amazon_open_remittance_count: depositData.openRemittances.length,
      amazon_open_remittance_expected: depositData.openExpected
    };
  });
}

export async function loadCodManagerNotifications(companyId: string, locationIds: string[]) {
  if (!supabaseAdmin || !locationIds.length) return [];
  const { data } = await supabaseAdmin
    .from("cod_manager_notifications")
    .select("id, closure_id, location_id, notification_type, title, message, status, email_status, created_at")
    .eq("company_id", companyId)
    .in("location_id", locationIds)
    .order("created_at", { ascending: false })
    .limit(25);
  return data ?? [];
}

export async function notifyCodManager({
  closureId,
  companyId,
  locationId,
  message,
  notificationType,
  stationCode,
  title
}: {
  closureId: string;
  companyId: string;
  locationId: string;
  message: string;
  notificationType: string;
  stationCode: string;
  title: string;
}) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const [stationResult, settingResult] = await Promise.all([
    supabaseAdmin.from("stations").select("station_manager_email")
      .eq("company_id", companyId).eq("id", locationId).maybeSingle(),
    supabaseAdmin.from("cod_station_settings").select("escalation_email")
      .eq("company_id", companyId).eq("location_id", locationId).maybeSingle()
  ]);
  const emails = [
    stationResult.data?.station_manager_email,
    ...String(settingResult.data?.escalation_email ?? "").split(/[;,]/)
  ].map((email) => String(email ?? "").trim().toLowerCase()).filter(Boolean);
  const recipients = [...new Set(emails)];
  const notification = await supabaseAdmin.from("cod_manager_notifications").insert({
    company_id: companyId,
    closure_id: closureId,
    location_id: locationId,
    recipient_email: recipients.join(", ") || null,
    notification_type: notificationType,
    title,
    message,
    email_status: recipients.length ? "Pending" : "Skipped"
  }).select("id").single();
  if (notification.error) throw new Error(notification.error.message);

  if (recipients.length && notification.data?.id) {
    try {
      await sendEmail({ companyId, to: recipients, subject: title, body: `${message}\n\nStation: ${stationCode}` });
      await supabaseAdmin.from("cod_manager_notifications").update({ email_status: "Sent" }).eq("id", notification.data.id);
    } catch (error) {
      await supabaseAdmin.from("cod_manager_notifications").update({
        email_status: "Failed",
        email_error: error instanceof Error ? error.message : "Email failed"
      }).eq("id", notification.data.id);
    }
  }
}

export async function finalizeCodClosure({
  businessDate,
  companyId,
  locationId,
  stationCode,
  userId
}: {
  businessDate: string;
  companyId: string;
  locationId: string;
  stationCode: string;
  userId: string;
}) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const [closureResult, reconciliations, runs] = await Promise.all([
    supabaseAdmin
      .from("cod_day_closures")
      .select("*")
      .eq("company_id", companyId)
      .eq("business_date", businessDate)
      .eq("location_id", locationId)
      .maybeSingle(),
    supabaseAdmin
      .from("cod_executive_reconciliations")
      .select("collected_amount")
      .eq("company_id", companyId)
      .eq("business_date", businessDate)
      .eq("location_id", locationId),
    supabaseAdmin
      .from("ops_portal_check_runs")
      .select("check_type, status, pending_count, pending_amount, raw_result, evidence, last_checked_at")
      .eq("company_id", companyId)
      .eq("check_date", businessDate)
      .eq("location_id", locationId)
      .in("check_type", ["driver_reconciliation", "prepared_deposit"])
      .order("last_checked_at", { ascending: false })
  ]);
  if (closureResult.error) throw new Error(closureResult.error.message);
  if (!closureResult.data) throw new Error("Run Driver Reconciliation first.");
  if (reconciliations.error) throw new Error(reconciliations.error.message);
  if (runs.error) throw new Error(runs.error.message);

  const closure = closureResult.data as CodDayClosure;
  const latest = latestRuns((runs.data ?? []) as PortalRun[]);
  const driverRun = latest.get("driver_reconciliation");
  const depositRun = latest.get("prepared_deposit");
  const driverCleared = closure.driver_check_status === "Exception approved" ||
    (runStatus(driverRun) === "Passed" && amount(driverRun?.pending_amount) === 0);
  if (!driverCleared) throw new Error("Driver Reconciliation must pass or receive manager approval before final submission.");

  const deposit = depositDetails(depositRun);
  const existingSnapshot = rawObject(closure.validation_snapshot);
  const cashSubmission = rawObject(existingSnapshot.cash_submission);
  const cashVariance = amount(cashSubmission.difference_amount);
  const collectedCod = Number((reconciliations.data ?? []).reduce((sum, row) => sum + amount(row.collected_amount), 0).toFixed(2));
  const difference = Number((collectedCod - deposit.openExpected).toFixed(2));
  const depositPassed = runStatus(depositRun) === "Passed" && deposit.noLiability &&
    deposit.openRemittances.length > 0 && Math.abs(difference) <= 1;
  const depositCleared = closure.deposit_check_status === "Exception approved" || depositPassed;
  if (!depositCleared) throw new Error("Bank Deposit must pass or receive manager approval before final submission.");

  const now = new Date().toISOString();
  const saved = await supabaseAdmin.from("cod_day_closures").update({
    collected_cod: collectedCod,
    amazon_open_remittance_expected: deposit.openExpected,
    amazon_open_remittance_count: deposit.openRemittances.length,
    difference_amount: difference,
    driver_reconciliation_pending: amount(driverRun?.pending_amount),
    no_deposit_liability: deposit.noLiability,
    driver_check_status: closure.driver_check_status === "Exception approved" ? "Exception approved" : "Passed",
    deposit_check_status: closure.deposit_check_status === "Exception approved" ? "Exception approved" : "Passed",
    validation_status: Math.abs(cashVariance) >= 0.01 || Math.abs(difference) > 1 ? "Mismatch" : "Matched",
    submission_status: "Submitted",
    manager_status: Math.abs(cashVariance) >= 0.01 ? closure.manager_status : "Not required",
    validation_snapshot: {
      ...existingSnapshot,
      driver: driverRun,
      deposit: depositRun,
      open_remittances: deposit.openRemittances
    },
    submitted_by: userId,
    submitted_at: now,
    final_submitted_by: userId,
    final_submitted_at: now,
    is_final_submitted: true,
    updated_at: now
  }).eq("id", closure.id);
  if (saved.error) throw new Error(saved.error.message);
  return { collectedCod, difference };
}
