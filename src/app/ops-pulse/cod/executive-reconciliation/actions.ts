"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyId, withCompany } from "@/lib/company-scope";
import {
  clean,
  required,
} from "@/lib/ops-pulse/cod";
import { requirePagePermission, type AuthorizationContext } from "@/lib/authorization";
import { supabaseAdmin } from "@/lib/supabase-admin";

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

  const { error } = await supabaseAdmin
    .from("cod_executive_reconciliations")
    .upsert(payload, { onConflict: "company_id,business_date,station_code,provider_employee_id" });
  if (error) throw new Error(error.message);

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
      throw new Error("Automatic SCC sync is not connected on the server yet. Configure the live SCC worker URL and secret, then retry.");
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
        runId = racedRun.data?.id as string;
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
    if (!baseUrl) {
      throw new Error("Dashboard base URL is not configured for live SCC sync.");
    }

    const response = await fetch(`${baseUrl}/api/cron/ops-pulse-portal-checks`, {
      method: "POST",
      headers: {
        ...(process.env.CRON_SECRET ? { Authorization: `Bearer ${process.env.CRON_SECRET}` } : {}),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ run_id: runId }),
      cache: "no-store"
    });
    const responseBody = await response.json().catch(() => ({} as Record<string, unknown>));
    if (!response.ok) {
      throw new Error(String(responseBody.error ?? `SCC worker returned HTTP ${response.status}`));
    }

    const run = responseBody.run && typeof responseBody.run === "object"
      ? responseBody.run as Record<string, unknown>
      : {};
    const rawResult = run.raw_result && typeof run.raw_result === "object"
      ? run.raw_result as Record<string, unknown>
      : {};
    const rosterSync = rawResult.roster_sync && typeof rawResult.roster_sync === "object"
      ? rawResult.roster_sync as Record<string, unknown>
      : {};
    const imported = Number(rosterSync.imported ?? 0) || 0;
    const status = String(run.status ?? "");
    const summary = String(run.summary ?? "").trim();
    const errorMessage = String(run.error_message ?? "").trim();

    revalidatePath(pagePath);
    if (imported > 0) {
      redirectWithFlash({ notice: `SCC sync completed. ${imported} associate${imported === 1 ? "" : "s"} imported for ${station.station_code}.` }, returnHref);
    }
    if (status === "Manual Review") {
      redirectWithFlash({
        error: summary || "Amazon SCC needs MFA/manual approval. Save the authenticator setup key in Settings > Amazon Connector, then approve Amazon once if it asks for push/captcha verification."
      }, returnHref);
    }
    if (status === "Error") {
      throw new Error(errorMessage || summary || "SCC worker could not complete the refresh.");
    }
    redirectWithFlash({ notice: summary || `SCC sync completed, but no associates were found for ${station.station_code} on ${businessDate}.` }, returnHref);
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithFlash({ error: (error as Error).message }, safeReturnHref(formData.get("return_href")));
  }
}
