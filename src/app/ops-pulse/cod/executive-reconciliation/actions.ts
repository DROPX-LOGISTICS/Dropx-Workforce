"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { waitUntil } from "@vercel/functions";
import { requireCompanyId, withCompany } from "@/lib/company-scope";
import {
  clean,
  required,
} from "@/lib/ops-pulse/cod";
import { requirePagePermission, type AuthorizationContext } from "@/lib/authorization";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { finalizeCodClosure, notifyCodManager } from "@/lib/ops-pulse/cod-day-closure";
import { canAccessCodAudit, writeCodAudit } from "@/lib/ops-pulse/cod-audit";

const pagePath = "/ops-pulse/cod/executive-reconciliation";

function redirectWithFlash(params: { error?: string; notice?: string }, href = pagePath): never {
  cookies().set("dropx_cod_executive_reconciliation_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 25,
    path: pagePath,
    sameSite: "lax"
  });
  redirect(href);
}

function safeReturnHref(value: FormDataEntryValue | null) {
  const href = clean(value);
  if (!href) return pagePath;
  if (!href.startsWith(pagePath)) return pagePath;
  return href;
}

function appBaseUrl() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || process.env.VERCEL_URL;
  if (!appUrl) return "";
  return appUrl.startsWith("http") ? appUrl : `https://${appUrl}`;
}

function isNextRedirectError(error: unknown) {
  return typeof (error as { digest?: unknown })?.digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT");
}

function isMissingPortalCheckSetup(error: unknown) {
  const message = String((error as { message?: unknown })?.message ?? error ?? "").toLowerCase();
  return message.includes("ops_portal_check_runs") ||
    message.includes("ops_portal_check_events") ||
    (message.includes("schema cache") && message.includes("portal_check"));
}

function optionalAmount(value: FormDataEntryValue | null, field = "Amount") {
  const text = clean(value);
  if (!text) return 0;
  const parsed = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${field} must be a valid amount.`);
  return Number(parsed.toFixed(2));
}

function optionalCount(value: FormDataEntryValue | null, field: string) {
  const text = clean(value);
  if (!text) return 0;
  const parsed = Number(text.replace(/,/g, ""));
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${field} must be a valid count.`);
  return parsed;
}

function optionalNumber(value: FormDataEntryValue | null) {
  const text = clean(value);
  if (!text) return 0;
  const parsed = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Activity count must be a valid number.");
  return Number(parsed.toFixed(2));
}

function manualExecutiveId(stationCode: string, businessDate: string, associateName: string) {
  const slug = associateName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  return `MANUAL-${stationCode}-${businessDate}-${slug || "ASSOCIATE"}`;
}

function sccImportedExecutiveId(stationCode: string, businessDate: string, associateName: string) {
  const slug = associateName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 44);
  return `SCC-${stationCode}-${businessDate}-${slug || "ASSOCIATE"}`;
}

function normalizeAssociateName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseSccAmount(value: string) {
  const cleaned = String(value ?? "")
    .replace(/₹/g, "")
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "")
    .trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function splitSccLine(line: string) {
  const tabbed = line.split("\t").map((cell) => cell.trim()).filter(Boolean);
  if (tabbed.length > 1) return tabbed;
  return line.split(/\s{2,}/).map((cell) => cell.trim()).filter(Boolean);
}

function looksLikeHeaderOrNoise(cells: string[]) {
  const joined = cells.join(" ").toLowerCase();
  if (!joined) return true;
  return joined === "driver" ||
    joined.includes("please configure") ||
    joined.includes("select driver") ||
    joined.includes("daily payment") ||
    joined.includes("overall payment") ||
    joined.includes("pending recon") ||
    joined.includes("running balance") ||
    joined.includes("undebriefed");
}

function parseSccRosterPaste(text: string, stationCode: string, businessDate: string) {
  const headers = [
    "Name",
    "ID",
    "Provider",
    "Type",
    "Expected",
    "Undebriefed MPOS",
    "Undebriefed CASH",
    "Variance",
    "Running Balance",
    "Pending Recon"
  ];
  const seen = new Set<string>();
  const rows: Array<{
    associateName: string;
    providerEmployeeId: string;
    pendingAmount: number;
    reconciliationState: string;
    cells: string[];
    headers: string[];
  }> = [];

  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const cells = splitSccLine(line);
      if (cells.length < 2 || looksLikeHeaderOrNoise(cells)) return;

      const associateName = cells[0]?.trim();
      if (!associateName || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(associateName)) return;

      const possibleId = cells[1]?.trim() ?? "";
      const providerEmployeeId = /^[A-Z0-9_-]{4,}$/i.test(possibleId)
        ? possibleId
        : sccImportedExecutiveId(stationCode, businessDate, associateName);
      const pendingAmount = parseSccAmount(cells[cells.length - 1] ?? "0");
      const key = providerEmployeeId.trim().toUpperCase();
      if (seen.has(key)) return;
      seen.add(key);

      rows.push({
        associateName,
        providerEmployeeId,
        pendingAmount,
        reconciliationState: cells[3] || "SCC Driver Reconciliation",
        cells,
        headers
      });
    });

  return rows;
}

function reconciliationStatus(expectedAmount: number, collectedAmount: number) {
  if (expectedAmount === 0 && collectedAmount === 0) return "Pending";
  const difference = Number((collectedAmount - expectedAmount).toFixed(2));
  if (Math.abs(difference) < 0.01) return "Completed";
  return difference < 0 ? "Pending Amount" : "Mismatch";
}

async function stationForInput(companyId: string, locationId: string | null, stationCode: string | null) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const columns = "id, station_code, station_name, state";
  const query = supabaseAdmin.from("stations").select(columns).eq("company_id", companyId);
  const result = locationId
    ? await query.eq("id", locationId).maybeSingle()
    : await query.eq("station_code", stationCode ?? "").maybeSingle();

  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error("Select a valid station from Location Master.");
  return result.data as { id: string; station_code: string; station_name: string | null; state: string | null };
}

function assertLocationAccess(authorization: AuthorizationContext, locationId: string) {
  if (authorization.hasAllLocationAccess || authorization.locationScopeIds.includes(locationId)) return;
  throw new Error("You do not have access to update this station.");
}

async function assertClosureEditable(companyId: string, businessDate: string, locationId: string) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const { data, error } = await supabaseAdmin
    .from("cod_day_closures")
    .select("is_final_submitted")
    .eq("company_id", companyId)
    .eq("business_date", businessDate)
    .eq("location_id", locationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.is_final_submitted) {
    throw new Error("This COD day is finally submitted and locked. Reopen it through manager approval before editing.");
  }
}

async function markCashSubmissionStale(companyId: string, businessDate: string, locationId: string) {
  if (!supabaseAdmin) return;
  await supabaseAdmin
    .from("cod_day_closures")
    .update({
      submission_status: "Draft",
      validation_status: "Validation required",
      driver_check_status: "Not run",
      deposit_check_status: "Locked",
      updated_at: new Date().toISOString()
    })
    .eq("company_id", companyId)
    .eq("business_date", businessDate)
    .eq("location_id", locationId)
    .eq("is_final_submitted", false);
}

async function savePayload(
  formData: FormData,
  authorization: AuthorizationContext,
  companyId: string,
  successMessage: string
) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const returnHref = safeReturnHref(formData.get("return_href"));
  const businessDate = required(formData.get("business_date"), "Business date");
  const stationCode = clean(formData.get("station_code"))?.trim().toUpperCase() ?? "";
  const locationId = clean(formData.get("location_id"));
  if (!locationId && !stationCode) throw new Error("Station is required.");
  const station = await stationForInput(companyId, locationId, stationCode || null);
  assertLocationAccess(authorization, station.id);
  await assertClosureEditable(companyId, businessDate, station.id);

  const sourceAssociateName = clean(formData.get("source_associate_name"));
  const manualAssociateName = clean(formData.get("manual_associate_name"));
  if (!sourceAssociateName && !manualAssociateName) {
    throw new Error("Associate name is required when the executive is not available in SCC Driver Reconciliation.");
  }
  const providerEmployeeIdInput = clean(formData.get("provider_employee_id"))?.trim();
  const providerEmployeeId = !providerEmployeeIdInput || providerEmployeeIdInput === "__manual__"
    ? manualExecutiveId(station.station_code, businessDate, required(formData.get("manual_associate_name"), "Associate name"))
    : providerEmployeeIdInput;

  const cash500 = optionalCount(formData.get("cash_500_count"), "Rs 500 note count");
  const cash200 = optionalCount(formData.get("cash_200_count"), "Rs 200 note count");
  const cash100 = optionalCount(formData.get("cash_100_count"), "Rs 100 note count");
  const cash50 = optionalCount(formData.get("cash_50_count"), "Rs 50 note count");
  const cash20 = optionalCount(formData.get("cash_20_count"), "Rs 20 note count");
  const cash10 = optionalCount(formData.get("cash_10_count"), "Rs 10 note count");
  const cashOther = optionalAmount(formData.get("cash_other_amount"), "Other cash amount");
  const expectedAmount = optionalAmount(formData.get("expected_amount"), "Expected COD amount");
  const collectedAmount = Number((
    cash500 * 500 +
    cash200 * 200 +
    cash100 * 100 +
    cash50 * 50 +
    cash20 * 20 +
    cash10 * 10 +
    cashOther
  ).toFixed(2));
  const differenceAmount = Number((collectedAmount - expectedAmount).toFixed(2));

  const payload = withCompany({
    business_date: businessDate,
    location_id: station.id,
    station_code: station.station_code,
    provider_employee_id: providerEmployeeId,
    source_associate_name: sourceAssociateName,
    manual_associate_name: manualAssociateName,
    shipment_type: clean(formData.get("shipment_type")),
    total_delivery: optionalNumber(formData.get("total_delivery")),
    total_activity: optionalNumber(formData.get("total_activity")),
    reconciliation_status: reconciliationStatus(expectedAmount, collectedAmount),
    pending_amount: Math.max(0, Number((expectedAmount - collectedAmount).toFixed(2))),
    expected_amount: expectedAmount,
    cash_500_count: cash500,
    cash_200_count: cash200,
    cash_100_count: cash100,
    cash_50_count: cash50,
    cash_20_count: cash20,
    cash_10_count: cash10,
    cash_other_amount: cashOther,
    collected_amount: collectedAmount,
    difference_amount: differenceAmount,
    remarks: clean(formData.get("remarks")),
    updated_by: authorization.userId
  }, companyId);

  const existing = await supabaseAdmin
    .from("cod_executive_reconciliations")
    .select("*")
    .eq("company_id", companyId)
    .eq("business_date", businessDate)
    .eq("station_code", station.station_code)
    .eq("provider_employee_id", providerEmployeeId)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);

  const { data: saved, error } = await supabaseAdmin
    .from("cod_executive_reconciliations")
    .upsert(payload, { onConflict: "company_id,business_date,station_code,provider_employee_id" })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await writeCodAudit({
    action: existing.data ? "Executive updated" : "Executive created",
    before: (existing.data ?? {}) as Record<string, unknown>,
    after: saved as Record<string, unknown>,
    authorization,
    businessDate,
    locationId: station.id,
    stationCode: station.station_code,
    reconciliationId: saved.id,
    providerEmployeeId,
    associateName: sourceAssociateName ?? manualAssociateName
  });
  await markCashSubmissionStale(companyId, businessDate, station.id);

  revalidatePath(pagePath);
  redirectWithFlash({ notice: successMessage }, returnHref);
}

export async function saveExecutiveReconciliation(formData: FormData) {
  const authorization = await requirePagePermission("cod_executive_reconciliation", "edit");
  const companyId = requireCompanyId(authorization);

  try {
    await savePayload(formData, authorization, companyId, "Executive reconciliation saved.");
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithFlash({ error: (error as Error).message }, safeReturnHref(formData.get("return_href")));
  }
}

export async function addManualExecutiveReconciliation(formData: FormData) {
  const authorization = await requirePagePermission("cod_executive_reconciliation", "add");
  const companyId = requireCompanyId(authorization);

  try {
    await savePayload(formData, authorization, companyId, "Manual executive reconciliation added.");
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithFlash({ error: (error as Error).message }, safeReturnHref(formData.get("return_href")));
  }
}

export async function submitCodCashCollection(formData: FormData) {
  const authorization = await requirePagePermission("cod_executive_reconciliation", "edit");
  const companyId = requireCompanyId(authorization);
  const returnHref = safeReturnHref(formData.get("return_href"));

  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const businessDate = required(formData.get("business_date"), "Business date");
    const locationId = required(formData.get("location_id"), "Station");
    const station = await stationForInput(companyId, locationId, null);
    assertLocationAccess(authorization, station.id);
    await assertClosureEditable(companyId, businessDate, locationId);

    const [reconciliations, existingClosure, settingResult] = await Promise.all([
      supabaseAdmin
        .from("cod_executive_reconciliations")
        .select("id, provider_employee_id, source_associate_name, manual_associate_name, expected_amount, collected_amount, difference_amount, reconciliation_status")
        .eq("company_id", companyId)
        .eq("business_date", businessDate)
        .eq("location_id", locationId)
        .order("source_associate_name"),
      supabaseAdmin
        .from("cod_day_closures")
        .select("id, is_final_submitted, manager_status, validation_snapshot")
        .eq("company_id", companyId)
        .eq("business_date", businessDate)
        .eq("location_id", locationId)
        .maybeSingle(),
      supabaseAdmin
        .from("cod_station_settings")
        .select("id, portal_station_code, is_active")
        .eq("company_id", companyId)
        .eq("location_id", locationId)
        .maybeSingle()
    ]);

    if (reconciliations.error) throw new Error(reconciliations.error.message);
    if (existingClosure.error) throw new Error(existingClosure.error.message);
    if (settingResult.error) throw new Error(settingResult.error.message);
    if (existingClosure.data?.is_final_submitted) {
      throw new Error("This COD day is finally submitted and locked.");
    }
    if (!settingResult.data?.id || settingResult.data.is_active === false) {
      throw new Error("Add this station in COD Master before submitting cash and running SCC.");
    }

    const rows = reconciliations.data ?? [];
    if (!rows.length) throw new Error("Save at least one associate cash entry before submitting.");

    const expectedCod = Number(rows.reduce((sum, row) => sum + optionalAmount(String(row.expected_amount ?? 0)), 0).toFixed(2));
    const collectedCod = Number(rows.reduce((sum, row) => sum + optionalAmount(String(row.collected_amount ?? 0)), 0).toFixed(2));
    const difference = Number((collectedCod - expectedCod).toFixed(2));
    const shortAmount = Math.max(0, Number((-difference).toFixed(2)));
    const excessAmount = Math.max(0, difference);
    const varianceRows = rows.filter((row) => Math.abs(Number(row.difference_amount ?? 0)) >= 0.01);
    const now = new Date().toISOString();
    const previousSnapshot = existingClosure.data?.validation_snapshot &&
      typeof existingClosure.data.validation_snapshot === "object" &&
      !Array.isArray(existingClosure.data.validation_snapshot)
      ? existingClosure.data.validation_snapshot as Record<string, unknown>
      : {};
    const previousCash = previousSnapshot.cash_submission &&
      typeof previousSnapshot.cash_submission === "object" &&
      !Array.isArray(previousSnapshot.cash_submission)
      ? previousSnapshot.cash_submission as Record<string, unknown>
      : {};
    const cashSnapshot = {
      expected_cod: expectedCod,
      collected_cod: collectedCod,
      difference_amount: difference,
      short_amount: shortAmount,
      excess_amount: excessAmount,
      associate_count: rows.length,
      variance_count: varianceRows.length,
      submitted_at: now,
      submitted_by: authorization.userId,
      rows: rows.map((row) => ({
        reconciliation_id: row.id,
        provider_employee_id: row.provider_employee_id,
        associate_name: row.source_associate_name ?? row.manual_associate_name,
        expected_amount: Number(row.expected_amount ?? 0),
        collected_amount: Number(row.collected_amount ?? 0),
        difference_amount: Number(row.difference_amount ?? 0),
        status: row.reconciliation_status
      }))
    };

    const closurePayload = {
      company_id: companyId,
      business_date: businessDate,
      location_id: locationId,
      station_code: station.station_code,
      collected_cod: collectedCod,
      difference_amount: difference,
      validation_status: Math.abs(difference) >= 0.01 ? "Mismatch" : "Validation required",
      submission_status: "Submitted",
      manager_status: Math.abs(difference) >= 0.01 ? "Pending" : "Not required",
      validation_snapshot: { ...previousSnapshot, cash_submission: cashSnapshot },
      submitted_by: authorization.userId,
      submitted_at: now,
      driver_check_status: "Queued",
      deposit_check_status: "Locked",
      updated_at: now
    };

    let closureId = existingClosure.data?.id as string | undefined;
    if (closureId) {
      const updated = await supabaseAdmin
        .from("cod_day_closures")
        .update(closurePayload)
        .eq("id", closureId)
        .select("id")
        .single();
      if (updated.error) throw new Error(updated.error.message);
    } else {
      const inserted = await supabaseAdmin
        .from("cod_day_closures")
        .insert(closurePayload)
        .select("id")
        .single();
      if (inserted.error) throw new Error(inserted.error.message);
      closureId = inserted.data.id as string;
    }
    if (!closureId) throw new Error("Could not create the cash submission record.");

    const run = await supabaseAdmin
      .from("ops_portal_check_runs")
      .upsert({
        company_id: companyId,
        location_id: locationId,
        cod_master_id: settingResult.data.id,
        station_code: station.station_code,
        portal_station_code: settingResult.data.portal_station_code ?? station.station_code,
        check_date: businessDate,
        check_type: "driver_reconciliation",
        status: "Queued",
        pending_count: 0,
        pending_amount: 0,
        summary: "Queued automatically after COD cash submission.",
        evidence: {},
        raw_result: {},
        attempt_count: 0,
        next_check_at: now,
        error_message: null,
        updated_at: now,
        created_by: authorization.userId
      }, { onConflict: "company_id,location_id,check_date,check_type" })
      .select("id")
      .single();
    if (run.error) throw new Error(run.error.message);

    const previousDifference = Number(previousCash.difference_amount ?? Number.NaN);
    const varianceChanged = !Number.isFinite(previousDifference) || Math.abs(previousDifference - difference) >= 0.01;
    const activeVarianceNotification = await supabaseAdmin
      .from("cod_manager_notifications")
      .select("id")
      .eq("closure_id", closureId)
      .eq("notification_type", "COD variance")
      .in("status", ["Unread", "Read"])
      .limit(1)
      .maybeSingle();
    if (activeVarianceNotification.error) throw new Error(activeVarianceNotification.error.message);
    if (Math.abs(difference) >= 0.01 && (varianceChanged || !activeVarianceNotification.data?.id)) {
      await supabaseAdmin
        .from("cod_manager_notifications")
        .update({ status: "Resolved", resolved_at: now })
        .eq("closure_id", closureId)
        .eq("notification_type", "COD variance")
        .in("status", ["Unread", "Read"]);
      const varianceLabel = difference < 0
        ? `short by ₹${shortAmount.toFixed(2)}`
        : `excess by ₹${excessAmount.toFixed(2)}`;
      await notifyCodManager({
        closureId,
        companyId,
        locationId,
        stationCode: station.station_code,
        notificationType: "COD variance",
        title: `COD ${difference < 0 ? "shortage" : "excess"}: ${station.station_code} on ${businessDate}`,
        message: `Cash was submitted ${varianceLabel}. Expected ₹${expectedCod.toFixed(2)}; collected ₹${collectedCod.toFixed(2)} across ${rows.length} associates. ${varianceRows.length} associate row${varianceRows.length === 1 ? "" : "s"} require manager review. SCC Driver Reconciliation has been queued.`
      });
    } else if (Math.abs(difference) < 0.01) {
      await supabaseAdmin
        .from("cod_manager_notifications")
        .update({ status: "Resolved", resolved_at: now })
        .eq("closure_id", closureId)
        .eq("notification_type", "COD variance")
        .in("status", ["Unread", "Read"]);
    }

    await writeCodAudit({
      action: Math.abs(difference) >= 0.01 ? "COD cash submitted with variance" : "COD cash submitted",
      after: { ...cashSnapshot, driver_check_run_id: run.data.id, driver_check_status: "Queued" },
      authorization,
      businessDate,
      closureId,
      locationId,
      stationCode: station.station_code
    });

    const baseUrl = appBaseUrl();
    if (baseUrl) {
      waitUntil(fetch(`${baseUrl}/api/cron/ops-pulse-portal-checks`, {
        method: "POST",
        headers: {
          ...(process.env.CRON_SECRET ? { Authorization: `Bearer ${process.env.CRON_SECRET}` } : {}),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ run_id: run.data.id }),
        cache: "no-store"
      }).catch(() => undefined));
    }

    revalidatePath(pagePath);
    revalidatePath("/ops-pulse/cod/portal-checks");
    const notice = difference < 0
      ? `COD submitted with shortage ₹${shortAmount.toFixed(2)}. Manager notified; Driver Reconciliation is running.`
      : difference > 0
        ? `COD submitted with excess ₹${excessAmount.toFixed(2)}. Manager notified; Driver Reconciliation is running.`
        : "COD submitted with no variance. Driver Reconciliation is running.";
    redirectWithFlash({ notice }, returnHref);
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithFlash({ error: error instanceof Error ? error.message : "Unable to submit COD cash." }, returnHref);
  }
}

export async function pasteSccDriverReconciliationRoster(formData: FormData) {
  const authorization = await requirePagePermission("cod_executive_reconciliation", "add");
  const companyId = requireCompanyId(authorization);

  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const returnHref = safeReturnHref(formData.get("return_href"));
    const businessDate = required(formData.get("business_date"), "Business date");
    const locationId = clean(formData.get("location_id"));
    const pastedRoster = required(formData.get("pasted_roster"), "SCC table rows");
    if (!locationId) throw new Error("Select one station before importing SCC rows.");

    const station = await stationForInput(companyId, locationId, null);
    assertLocationAccess(authorization, station.id);

    const rows = parseSccRosterPaste(pastedRoster, station.station_code, businessDate);
    if (!rows.length) {
      throw new Error("Could not read associate rows. Copy the visible Driver Reconciliation table rows from SCC and paste again.");
    }

    const now = new Date().toISOString();
    const payload = rows.map((row) => withCompany({
      location_id: station.id,
      station_code: station.station_code,
      portal_station_code: station.station_code,
      business_date: businessDate,
      provider_employee_id: row.providerEmployeeId,
      associate_name: row.associateName,
      normalized_associate_name: normalizeAssociateName(row.associateName),
      route_code: null,
      reconciliation_state: row.reconciliationState,
      pending_amount: row.pendingAmount,
      pending_details: [],
      last_detail_checked_at: null,
      raw_row: {
        cells: row.cells,
        headers: row.headers,
        imported_at: now,
        source: "scc_paste"
      },
      source: "scc_driver_reconciliation",
      first_seen_at: now,
      last_seen_at: now
    }, companyId));

    const { error } = await supabaseAdmin
      .from("cod_driver_reconciliation_roster")
      .upsert(payload, { onConflict: "company_id,business_date,station_code,provider_employee_id" });
    if (error) throw new Error(error.message);

    revalidatePath(pagePath);
    redirectWithFlash(
      { notice: `${payload.length} SCC associate${payload.length === 1 ? "" : "s"} imported. Count cash against each row now.` },
      returnHref
    );
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithFlash({ error: (error as Error).message }, safeReturnHref(formData.get("return_href")));
  }
}

export async function refreshExecutiveReconciliationRoster(formData: FormData) {
  const authorization = await requirePagePermission("cod_executive_reconciliation", "edit");
  const companyId = requireCompanyId(authorization);

  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const returnHref = safeReturnHref(formData.get("return_href"));
    const businessDate = required(formData.get("business_date"), "Business date");
    const locationId = clean(formData.get("location_id"));
    if (!locationId) throw new Error("Select one station before fetching SCC roster.");

    const station = await stationForInput(companyId, locationId, null);
    assertLocationAccess(authorization, station.id);

    const settingResult = await supabaseAdmin
      .from("cod_station_settings")
      .select("id, portal_station_code, portal_check_interval_minutes, is_active")
      .eq("company_id", companyId)
      .eq("location_id", station.id)
      .maybeSingle();

    if (settingResult.error) throw new Error(settingResult.error.message);
    const setting = settingResult.data as {
      id: string;
      portal_station_code: string | null;
      portal_check_interval_minutes: number | string | null;
      is_active: boolean | null;
    } | null;

    if (!setting?.id || setting.is_active === false) {
      throw new Error("Add this station in COD Master before SCC refresh.");
    }

    const workerUrl = process.env.OPS_PORTAL_WORKER_URL?.trim();
    const workerSecret = process.env.OPS_PORTAL_WORKER_SECRET?.trim();
    if (!workerUrl || !workerSecret) {
      throw new Error("Automatic SCC sync worker is not connected on this deployment yet. Configure OPS_PORTAL_WORKER_URL and OPS_PORTAL_WORKER_SECRET for the SCC worker. This is separate from the biometric middleware.");
    }

    const payload = withCompany({
      location_id: station.id,
      cod_master_id: setting.id,
      station_code: station.station_code,
      portal_station_code: setting.portal_station_code ?? station.station_code,
      check_date: businessDate,
      check_type: "driver_reconciliation",
      status: "Queued",
      pending_count: 0,
      pending_amount: 0,
      summary: "Queued from Executive Reconciliation.",
      evidence: {},
      raw_result: {},
      attempt_count: 0,
      error_message: null,
      next_check_at: new Date().toISOString()
    }, companyId);

    let runId = "";
    const existingRun = await supabaseAdmin
      .from("ops_portal_check_runs")
      .select("id")
      .eq("company_id", companyId)
      .eq("location_id", station.id)
      .eq("check_date", businessDate)
      .eq("check_type", "driver_reconciliation")
      .maybeSingle();

    if (existingRun.error) {
      if (isMissingPortalCheckSetup(existingRun.error)) {
        redirectWithFlash(
          {
            error: "SCC roster automation is not installed yet. Run scripts/ops_pulse_cod_portal_checks_v1.sql in Supabase SQL Editor."
          },
          returnHref
        );
      }
      throw new Error(existingRun.error.message);
    }

    if (existingRun.data?.id) {
      const updated = await supabaseAdmin
        .from("ops_portal_check_runs")
        .update({
          cod_master_id: setting.id,
          station_code: station.station_code,
          portal_station_code: setting.portal_station_code ?? station.station_code,
          status: "Queued",
          pending_count: 0,
          pending_amount: 0,
          summary: "Queued from Executive Reconciliation.",
          evidence: {},
          raw_result: {},
          attempt_count: 0,
          error_message: null,
          next_check_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", existingRun.data.id)
        .select("id")
        .single();

      if (updated.error) throw new Error(updated.error.message);
      runId = updated.data.id as string;
    } else {
      const inserted = await supabaseAdmin
        .from("ops_portal_check_runs")
        .insert(payload)
        .select("id")
        .single();

      if (inserted.error?.code === "23505") {
        const racedRun = await supabaseAdmin
          .from("ops_portal_check_runs")
          .select("id")
          .eq("company_id", companyId)
          .eq("location_id", station.id)
          .eq("check_date", businessDate)
          .eq("check_type", "driver_reconciliation")
          .maybeSingle();

        if (racedRun.error) throw new Error(racedRun.error.message);
        if (racedRun.data?.id) {
          const resetRun = await supabaseAdmin
            .from("ops_portal_check_runs")
            .update({
              cod_master_id: setting.id,
              station_code: station.station_code,
              portal_station_code: setting.portal_station_code ?? station.station_code,
              status: "Queued",
              pending_count: 0,
              pending_amount: 0,
              summary: "Queued from Executive Reconciliation.",
              evidence: {},
              raw_result: {},
              attempt_count: 0,
              error_message: null,
              next_check_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq("id", racedRun.data.id)
            .select("id")
            .single();

          if (resetRun.error) throw new Error(resetRun.error.message);
          runId = resetRun.data.id as string;
        }
      } else if (inserted.error) {
        if (isMissingPortalCheckSetup(inserted.error)) {
          redirectWithFlash(
            {
              error: "SCC roster automation is not installed yet. Run scripts/ops_pulse_cod_portal_checks_v1.sql in Supabase SQL Editor."
            },
            returnHref
          );
        }
        throw new Error(inserted.error.message);
      } else {
        runId = inserted.data.id as string;
      }
    }

    if (!runId) {
      const existing = await supabaseAdmin
        .from("ops_portal_check_runs")
        .select("id")
        .eq("company_id", companyId)
        .eq("location_id", station.id)
        .eq("check_date", businessDate)
        .eq("check_type", "driver_reconciliation")
        .maybeSingle();
      if (existing.error) throw new Error(existing.error.message);
      runId = existing.data?.id as string;
    }

    if (!runId) throw new Error("Could not create SCC refresh run.");

    const baseUrl = appBaseUrl();
    if (baseUrl) {
      waitUntil(fetch(`${baseUrl}/api/cron/ops-pulse-portal-checks`, {
        method: "POST",
        headers: {
          ...(process.env.CRON_SECRET ? { Authorization: `Bearer ${process.env.CRON_SECRET}` } : {}),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ run_id: runId }),
        cache: "no-store"
      }).catch(() => undefined));
    }

    revalidatePath(pagePath);
    redirectWithFlash({
      notice: `SCC refresh queued for ${station.station_code}. You can keep working; this sheet updates automatically.`
    }, returnHref);
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithFlash({ error: (error as Error).message }, safeReturnHref(formData.get("return_href")));
  }
}

export async function deleteExecutiveReconciliation(formData: FormData) {
  const authorization = await requirePagePermission("cod_executive_reconciliation", "edit");
  const companyId = requireCompanyId(authorization);
  const returnHref = safeReturnHref(formData.get("return_href"));
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const businessDate = required(formData.get("business_date"), "Business date");
    const locationId = required(formData.get("location_id"), "Station");
    const providerEmployeeId = required(formData.get("provider_employee_id"), "Associate");
    const station = await stationForInput(companyId, locationId, null);
    assertLocationAccess(authorization, station.id);
    await assertClosureEditable(companyId, businessDate, locationId);
    const existing = await supabaseAdmin
      .from("cod_executive_reconciliations")
      .select("*")
      .eq("company_id", companyId)
      .eq("business_date", businessDate)
      .eq("location_id", locationId)
      .eq("provider_employee_id", providerEmployeeId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (!existing.data) throw new Error("COD reconciliation entry was not found.");
    const { error } = await supabaseAdmin
      .from("cod_executive_reconciliations")
      .delete()
      .eq("company_id", companyId)
      .eq("business_date", businessDate)
      .eq("location_id", locationId)
      .eq("provider_employee_id", providerEmployeeId);
    if (error) throw new Error(error.message);
    await writeCodAudit({
      action: "Executive deleted",
      before: existing.data as Record<string, unknown>,
      authorization,
      businessDate,
      locationId,
      stationCode: station.station_code,
      reconciliationId: existing.data.id,
      providerEmployeeId,
      associateName: existing.data.source_associate_name ?? existing.data.manual_associate_name
    });
    await markCashSubmissionStale(companyId, businessDate, locationId);
    revalidatePath(pagePath);
    redirectWithFlash({ notice: `${providerEmployeeId} reconciliation entry deleted.` }, returnHref);
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithFlash({ error: error instanceof Error ? error.message : "Unable to delete reconciliation entry." }, returnHref);
  }
}

export async function queueCodClosureCheck(formData: FormData) {
  const authorization = await requirePagePermission("cod_executive_reconciliation", "edit");
  const companyId = requireCompanyId(authorization);
  const returnHref = safeReturnHref(formData.get("return_href"));
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const businessDate = required(formData.get("business_date"), "Business date");
    const locationId = required(formData.get("location_id"), "Station");
    const checkType = required(formData.get("check_type"), "Check type");
    if (!["driver_reconciliation", "prepared_deposit"].includes(checkType)) throw new Error("Invalid COD validation step.");
    const station = await stationForInput(companyId, locationId, null);
    assertLocationAccess(authorization, station.id);
    await assertClosureEditable(companyId, businessDate, locationId);

    const settingResult = await supabaseAdmin
      .from("cod_station_settings")
      .select("id, portal_station_code, is_active")
      .eq("company_id", companyId)
      .eq("location_id", locationId)
      .maybeSingle();
    if (settingResult.error) throw new Error(settingResult.error.message);
    if (!settingResult.data?.id || settingResult.data.is_active === false) {
      throw new Error("Add this station in COD Master before running Amazon validation.");
    }

    let closureResult = await supabaseAdmin
      .from("cod_day_closures")
      .select("id, driver_check_status, is_final_submitted")
      .eq("company_id", companyId)
      .eq("business_date", businessDate)
      .eq("location_id", locationId)
      .maybeSingle();
    if (closureResult.error) throw new Error(closureResult.error.message);

    if (checkType === "prepared_deposit") {
      const driverRun = await supabaseAdmin
        .from("ops_portal_check_runs")
        .select("status, pending_amount")
        .eq("company_id", companyId)
        .eq("location_id", locationId)
        .eq("check_date", businessDate)
        .eq("check_type", "driver_reconciliation")
        .maybeSingle();
      if (driverRun.error) throw new Error(driverRun.error.message);
      const driverPassed = driverRun.data?.status === "Pass" && Number(driverRun.data.pending_amount ?? 0) === 0;
      const driverApproved = closureResult.data?.driver_check_status === "Exception approved";
      if (!driverPassed && !driverApproved) {
        throw new Error("Complete Driver Reconciliation or obtain manager exception approval before Bank Deposit.");
      }
    }

    if (!closureResult.data) {
      closureResult = await supabaseAdmin
        .from("cod_day_closures")
        .insert({
          company_id: companyId,
          business_date: businessDate,
          location_id: locationId,
          station_code: station.station_code,
          submission_status: "Draft",
          manager_status: "Not required",
          driver_check_status: checkType === "driver_reconciliation" ? "Queued" : "Passed",
          deposit_check_status: checkType === "prepared_deposit" ? "Queued" : "Locked",
          submitted_by: authorization.userId
        })
        .select("id, driver_check_status, is_final_submitted")
        .single();
      if (closureResult.error) throw new Error(closureResult.error.message);
    } else {
      const gateColumn = checkType === "driver_reconciliation" ? "driver_check_status" : "deposit_check_status";
      const { error } = await supabaseAdmin
        .from("cod_day_closures")
        .update({ [gateColumn]: "Queued", updated_at: new Date().toISOString() })
        .eq("id", closureResult.data.id);
      if (error) throw new Error(error.message);
    }

    const now = new Date().toISOString();
    const run = await supabaseAdmin
      .from("ops_portal_check_runs")
      .upsert({
        company_id: companyId,
        location_id: locationId,
        cod_master_id: settingResult.data.id,
        station_code: station.station_code,
        portal_station_code: settingResult.data.portal_station_code ?? station.station_code,
        check_date: businessDate,
        check_type: checkType,
        status: "Queued",
        pending_count: 0,
        pending_amount: 0,
        summary: `Queued from COD closure step: ${checkType}.`,
        evidence: {},
        raw_result: {},
        attempt_count: 0,
        next_check_at: now,
        error_message: null,
        updated_at: now,
        created_by: authorization.userId
      }, { onConflict: "company_id,location_id,check_date,check_type" })
      .select("id")
      .single();
    if (run.error) throw new Error(run.error.message);
    const closureId = closureResult.data?.id;
    if (!closureId) throw new Error("Could not create the COD closure audit record.");
    await writeCodAudit({
      action: checkType === "driver_reconciliation" ? "Driver check queued" : "Bank Deposit check queued",
      after: { run_id: run.data.id, check_type: checkType, status: "Queued" },
      authorization,
      businessDate,
      closureId,
      locationId,
      stationCode: station.station_code
    });

    const baseUrl = appBaseUrl();
    if (baseUrl) {
      waitUntil(fetch(`${baseUrl}/api/cron/ops-pulse-portal-checks`, {
        method: "POST",
        headers: {
          ...(process.env.CRON_SECRET ? { Authorization: `Bearer ${process.env.CRON_SECRET}` } : {}),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ run_id: run.data.id }),
        cache: "no-store"
      }).catch(() => undefined));
    }
    revalidatePath(pagePath);
    redirectWithFlash({
      notice: checkType === "driver_reconciliation"
        ? `Driver Reconciliation queued for ${station.station_code}.`
        : `Bank Deposit validation queued for ${station.station_code}.`
    }, returnHref);
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithFlash({ error: error instanceof Error ? error.message : "Unable to queue COD validation." }, returnHref);
  }
}

export async function requestCodGateException(formData: FormData) {
  const authorization = await requirePagePermission("cod_executive_reconciliation", "edit");
  const companyId = requireCompanyId(authorization);
  const returnHref = safeReturnHref(formData.get("return_href"));
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const businessDate = required(formData.get("business_date"), "Business date");
    const locationId = required(formData.get("location_id"), "Station");
    const gate = required(formData.get("gate"), "Validation gate");
    const reason = required(formData.get("exception_reason"), "Exception reason");
    if (!["driver", "deposit"].includes(gate)) throw new Error("Invalid exception gate.");
    const station = await stationForInput(companyId, locationId, null);
    assertLocationAccess(authorization, station.id);
    await assertClosureEditable(companyId, businessDate, locationId);

    const { data: closure, error: closureError } = await supabaseAdmin
      .from("cod_day_closures")
      .select("id, driver_check_status")
      .eq("company_id", companyId)
      .eq("business_date", businessDate)
      .eq("location_id", locationId)
      .maybeSingle();
    if (closureError) throw new Error(closureError.message);
    if (!closure) throw new Error("Run the validation step before requesting an exception.");
    if (gate === "deposit" && !["Passed", "Exception approved"].includes(closure.driver_check_status)) {
      throw new Error("Driver Reconciliation must be cleared before requesting a Bank Deposit exception.");
    }

    const prefix = gate === "driver" ? "driver" : "deposit";
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin.from("cod_day_closures").update({
      [`${prefix}_check_status`]: "Exception requested",
      [`${prefix}_exception_reason`]: reason,
      [`${prefix}_exception_requested_by`]: authorization.userId,
      [`${prefix}_exception_requested_at`]: now,
      submission_status: "Manager approval required",
      manager_status: "Pending",
      updated_at: now
    }).eq("id", closure.id);
    if (error) throw new Error(error.message);

    const label = gate === "driver" ? "Driver Reconciliation" : "Bank Deposit";
    await writeCodAudit({
      action: `${label} exception requested`,
      after: { gate, reason, status: "Exception requested" },
      authorization,
      businessDate,
      closureId: closure.id,
      locationId,
      stationCode: station.station_code
    });
    await notifyCodManager({
      closureId: closure.id,
      companyId,
      locationId,
      stationCode: station.station_code,
      notificationType: `${label} exception`,
      title: `COD ${label} exception: ${station.station_code} on ${businessDate}`,
      message: `${label} is pending, but the station requested permission to continue. Reason: ${reason}`
    });
    revalidatePath(pagePath);
    redirectWithFlash({ notice: `${label} exception sent to the manager for approval.` }, returnHref);
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithFlash({ error: error instanceof Error ? error.message : "Unable to request manager approval." }, returnHref);
  }
}

export async function continueCodWithPendingDriverReconciliation(formData: FormData) {
  const authorization = await requirePagePermission("cod_executive_reconciliation", "edit");
  const companyId = requireCompanyId(authorization);
  const returnHref = safeReturnHref(formData.get("return_href"));
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const businessDate = required(formData.get("business_date"), "Business date");
    const locationId = required(formData.get("location_id"), "Station");
    const reason = required(formData.get("exception_reason"), "Reason");
    const station = await stationForInput(companyId, locationId, null);
    assertLocationAccess(authorization, station.id);
    await assertClosureEditable(companyId, businessDate, locationId);

    const [closureResult, runResult] = await Promise.all([
      supabaseAdmin.from("cod_day_closures").select("id,driver_check_status")
        .eq("company_id", companyId).eq("business_date", businessDate).eq("location_id", locationId).maybeSingle(),
      supabaseAdmin.from("ops_portal_check_runs").select("status,pending_count,pending_amount,summary")
        .eq("company_id", companyId).eq("check_date", businessDate).eq("location_id", locationId)
        .eq("check_type", "driver_reconciliation").maybeSingle()
    ]);
    if (closureResult.error) throw new Error(closureResult.error.message);
    if (runResult.error) throw new Error(runResult.error.message);
    if (!closureResult.data?.id) throw new Error("Submit COD and run Driver Reconciliation first.");
    if (!runResult.data || runResult.data.status === "Pass") throw new Error("No pending Driver Reconciliation exception is available.");

    const pendingCount = Number(runResult.data.pending_count ?? 0);
    const pendingAmount = Number(runResult.data.pending_amount ?? 0);
    const now = new Date().toISOString();
    const continuationReason = `Continued with SCC pending. ${reason}`;
    const updated = await supabaseAdmin.from("cod_day_closures").update({
      driver_check_status: "Exception approved",
      driver_exception_reason: continuationReason,
      driver_exception_requested_by: authorization.userId,
      driver_exception_requested_at: now,
      driver_exception_manager_remarks: "Operational continuation recorded; manager and Control Tower notified.",
      deposit_check_status: "Not run",
      manager_status: "Pending",
      updated_at: now
    }).eq("id", closureResult.data.id);
    if (updated.error) throw new Error(updated.error.message);

    await notifyCodManager({
      closureId: closureResult.data.id,
      companyId,
      locationId,
      stationCode: station.station_code,
      notificationType: "Driver Reconciliation pending continuation",
      title: `SCC pending continuation: ${station.station_code} on ${businessDate}`,
      message: `The station continued with ${pendingCount} SCC associate reconciliation${pendingCount === 1 ? "" : "s"} pending for ₹${pendingAmount.toFixed(2)}. Reason: ${reason}. Bank Deposit validation is now permitted; the pending SCC remains visible in the closure summary.`
    });
    await writeCodAudit({
      action: "Continued with Driver Reconciliation pending",
      after: { pending_count: pendingCount, pending_amount: pendingAmount, reason, status: "Exception approved" },
      authorization,
      businessDate,
      closureId: closureResult.data.id,
      locationId,
      stationCode: station.station_code
    });
    revalidatePath(pagePath);
    redirectWithFlash({ notice: "Continued with SCC pending. Manager and Control Tower notifications were created." }, returnHref);
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithFlash({ error: error instanceof Error ? error.message : "Unable to continue with SCC pending." }, returnHref);
  }
}

export async function reviewCodGateException(formData: FormData) {
  const authorization = await requirePagePermission("cod_executive_reconciliation", "edit");
  const companyId = requireCompanyId(authorization);
  const returnHref = safeReturnHref(formData.get("return_href"));
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    if (!canAccessCodAudit(authorization)) throw new Error("Only a manager or administrator can review COD exceptions.");
    const closureId = required(formData.get("closure_id"), "Closure");
    const gate = required(formData.get("gate"), "Validation gate");
    const decision = required(formData.get("decision"), "Decision");
    const remarks = clean(formData.get("manager_remarks"));
    if (!["driver", "deposit"].includes(gate) || !["approve", "reject"].includes(decision)) {
      throw new Error("Invalid manager decision.");
    }
    const { data: closure, error: closureError } = await supabaseAdmin
      .from("cod_day_closures")
      .select("id, location_id, business_date, station_code")
      .eq("id", closureId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (closureError) throw new Error(closureError.message);
    if (!closure) throw new Error("COD closure was not found.");
    assertLocationAccess(authorization, closure.location_id);

    const prefix = gate === "driver" ? "driver" : "deposit";
    const approved = decision === "approve";
    const now = new Date().toISOString();
    const update: Record<string, unknown> = {
      [`${prefix}_check_status`]: approved ? "Exception approved" : "Exception rejected",
      [`${prefix}_exception_reviewed_by`]: authorization.userId,
      [`${prefix}_exception_reviewed_at`]: now,
      [`${prefix}_exception_manager_remarks`]: remarks,
      manager_status: approved ? "Approved" : "Rejected",
      submission_status: approved ? "Draft" : "Rejected",
      updated_at: now
    };
    if (gate === "driver" && approved) update.deposit_check_status = "Not run";
    const { error } = await supabaseAdmin.from("cod_day_closures").update(update).eq("id", closureId);
    if (error) throw new Error(error.message);
    await writeCodAudit({
      action: `COD ${gate} exception ${approved ? "approved" : "rejected"}`,
      after: { gate, decision, remarks, status: approved ? "Exception approved" : "Exception rejected" },
      authorization,
      businessDate: closure.business_date,
      closureId,
      locationId: closure.location_id,
      stationCode: closure.station_code
    });
    await supabaseAdmin.from("cod_manager_notifications").update({
      status: "Resolved",
      resolved_at: now
    }).eq("closure_id", closureId).eq("status", "Unread");
    revalidatePath(pagePath);
    redirectWithFlash({ notice: `COD ${gate} exception ${approved ? "approved" : "rejected"}.` }, returnHref);
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithFlash({ error: error instanceof Error ? error.message : "Unable to review COD exception." }, returnHref);
  }
}

export async function submitCodDayClosure(formData: FormData) {
  const authorization = await requirePagePermission("cod_executive_reconciliation", "edit");
  const companyId = requireCompanyId(authorization);
  const returnHref = safeReturnHref(formData.get("return_href"));
  try {
    const businessDate = required(formData.get("business_date"), "Business date");
    const locationId = required(formData.get("location_id"), "Station");
    const station = await stationForInput(companyId, locationId, null);
    assertLocationAccess(authorization, station.id);
    const result = await finalizeCodClosure({
      businessDate,
      companyId,
      locationId,
      stationCode: station.station_code,
      userId: authorization.userId
    });
    const closure = await supabaseAdmin
      ?.from("cod_day_closures")
      .select("id")
      .eq("company_id", companyId)
      .eq("business_date", businessDate)
      .eq("location_id", locationId)
      .maybeSingle();
    await writeCodAudit({
      action: "Final COD closure submitted",
      after: { collected_cod: result.collectedCod, difference_amount: result.difference, locked: true },
      authorization,
      businessDate,
      closureId: closure?.data?.id ?? null,
      locationId,
      stationCode: station.station_code
    });
    revalidatePath(pagePath);
    revalidatePath("/ops-pulse/cod");
    redirectWithFlash({ notice: `COD day closure submitted for ${station.station_code}. Collected ₹${result.collectedCod.toFixed(2)}.` }, returnHref);
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithFlash({ error: error instanceof Error ? error.message : "Unable to submit COD day closure." }, returnHref);
  }
}
