import { sendEmail } from "@/lib/email";
import { supabaseAdmin } from "@/lib/supabase-admin";

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
  submitted_at: string;
};

function amount(value: unknown) {
  const parsed = Number(String(value ?? "0").replace(/[,₹\s]/g, ""));
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function rawObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function loadCodDayClosures(companyId: string, businessDate: string, locationIds: string[]) {
  if (!supabaseAdmin || !locationIds.length) return [] as CodDayClosure[];
  const { data } = await supabaseAdmin
    .from("cod_day_closures")
    .select("id, business_date, location_id, station_code, collected_cod, amazon_open_remittance_expected, amazon_open_remittance_count, difference_amount, driver_reconciliation_pending, no_deposit_liability, validation_status, submission_status, manager_status, override_reason, submitted_at")
    .eq("company_id", companyId)
    .eq("business_date", businessDate)
    .in("location_id", locationIds)
    .order("station_code");
  return (data ?? []) as CodDayClosure[];
}

export async function loadCodManagerNotifications(companyId: string, locationIds: string[]) {
  if (!supabaseAdmin || !locationIds.length) return [];
  const { data } = await supabaseAdmin
    .from("cod_manager_notifications")
    .select("id, location_id, title, message, status, email_status, created_at")
    .eq("company_id", companyId)
    .in("location_id", locationIds)
    .order("created_at", { ascending: false })
    .limit(25);
  return data ?? [];
}

export async function submitCodClosure({
  businessDate,
  companyId,
  locationId,
  overrideReason,
  stationCode,
  userId
}: {
  businessDate: string;
  companyId: string;
  locationId: string;
  overrideReason: string;
  stationCode: string;
  userId: string;
}) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

  const [reconciliations, runs, station] = await Promise.all([
    supabaseAdmin
      .from("cod_executive_reconciliations")
      .select("collected_amount")
      .eq("company_id", companyId)
      .eq("business_date", businessDate)
      .eq("location_id", locationId),
    supabaseAdmin
      .from("ops_portal_check_runs")
      .select("check_type, status, pending_amount, raw_result, evidence, last_checked_at")
      .eq("company_id", companyId)
      .eq("check_date", businessDate)
      .eq("location_id", locationId)
      .in("check_type", ["driver_reconciliation", "prepared_deposit"])
      .order("last_checked_at", { ascending: false }),
    supabaseAdmin
      .from("stations")
      .select("station_manager_email")
      .eq("company_id", companyId)
      .eq("id", locationId)
      .maybeSingle()
  ]);
  if (reconciliations.error) throw new Error(reconciliations.error.message);
  if (runs.error) throw new Error(runs.error.message);

  const collectedCod = Number((reconciliations.data ?? []).reduce((sum, row) => sum + amount(row.collected_amount), 0).toFixed(2));
  const latestByType = new Map<string, Record<string, unknown>>();
  (runs.data ?? []).forEach((run) => {
    if (!latestByType.has(run.check_type)) latestByType.set(run.check_type, run as Record<string, unknown>);
  });
  const driver = latestByType.get("driver_reconciliation");
  const deposit = latestByType.get("prepared_deposit");
  if (!driver || !deposit) throw new Error("Run Driver Reconciliation and Bank Deposit validation before closing the day.");

  const driverPending = amount(driver.pending_amount);
  const depositRaw = rawObject(deposit.raw_result);
  const depositEvidence = rawObject(deposit.evidence);
  const openRemittances = Array.isArray(depositRaw.open_remittances)
    ? depositRaw.open_remittances
    : Array.isArray(depositEvidence.open_remittances) ? depositEvidence.open_remittances : [];
  const openExpected = amount(depositRaw.open_remittance_expected ?? depositEvidence.open_remittance_expected);
  const noLiability = Boolean(depositRaw.no_deposit_liability ?? depositEvidence.no_deposit_liability);
  const difference = Number((collectedCod - openExpected).toFixed(2));
  const matched = driverPending === 0 && noLiability && openRemittances.length > 0 && Math.abs(difference) <= 1;
  if (!matched && !overrideReason.trim()) {
    throw new Error("Validation does not match. Enter a reason to submit this mismatch for manager approval.");
  }

  const payload = {
    company_id: companyId,
    business_date: businessDate,
    location_id: locationId,
    station_code: stationCode,
    collected_cod: collectedCod,
    amazon_open_remittance_expected: openExpected,
    amazon_open_remittance_count: openRemittances.length,
    difference_amount: difference,
    driver_reconciliation_pending: driverPending,
    no_deposit_liability: noLiability,
    validation_status: matched ? "Matched" : "Mismatch",
    submission_status: matched ? "Submitted" : "Manager approval required",
    manager_status: matched ? "Not required" : "Pending",
    override_reason: matched ? null : overrideReason.trim(),
    validation_snapshot: { driver, deposit, open_remittances: openRemittances },
    submitted_by: userId,
    submitted_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  const saved = await supabaseAdmin
    .from("cod_day_closures")
    .upsert(payload, { onConflict: "company_id,business_date,location_id" })
    .select("id")
    .single();
  if (saved.error) throw new Error(saved.error.message);

  if (!matched) {
    const email = station.data?.station_manager_email?.trim() || null;
    const title = `COD mismatch: ${stationCode} on ${businessDate}`;
    const message = `Collected COD ₹${collectedCod.toFixed(2)} does not match Amazon open remittance ₹${openExpected.toFixed(2)}. Difference ₹${difference.toFixed(2)}. Reason: ${overrideReason.trim()}`;
    const notification = await supabaseAdmin.from("cod_manager_notifications").insert({
      company_id: companyId,
      closure_id: saved.data.id,
      location_id: locationId,
      recipient_email: email,
      title,
      message,
      email_status: email ? "Pending" : "Skipped"
    }).select("id").single();

    if (email && notification.data?.id) {
      try {
        await sendEmail({ companyId, to: [email], subject: title, body: message });
        await supabaseAdmin.from("cod_manager_notifications").update({ email_status: "Sent" }).eq("id", notification.data.id);
      } catch (error) {
        await supabaseAdmin.from("cod_manager_notifications").update({
          email_status: "Failed",
          email_error: error instanceof Error ? error.message : "Email failed"
        }).eq("id", notification.data.id);
      }
    }
  }
  return { matched, difference };
}
