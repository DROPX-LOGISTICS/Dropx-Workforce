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

    const queued = await supabaseAdmin
      .from("ops_portal_check_runs")
      .upsert(payload, { onConflict: "company_id,station_code,check_date,check_type" });

    if (queued.error) {
      if (isMissingPortalCheckSetup(queued.error)) {
        redirectWithFlash(
          {
            error: "SCC roster automation is not installed yet. Run scripts/ops_pulse_cod_portal_checks_v1.sql in Supabase SQL Editor. The COD sheet is still usable for manual reconciliation."
          },
          returnHref
        );
      }
      if (queued.error.code === "42P10") {
        const inserted = await supabaseAdmin.from("ops_portal_check_runs").insert(payload);
        if (inserted.error) throw new Error(inserted.error.message);
      } else {
        throw new Error(queued.error.message);
      }
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || process.env.VERCEL_URL;
    const baseUrl = appUrl?.startsWith("http") ? appUrl : appUrl ? `https://${appUrl}` : "";
    if (baseUrl) {
      const headers = process.env.CRON_SECRET ? { Authorization: `Bearer ${process.env.CRON_SECRET}` } : undefined;
      fetch(`${baseUrl}/api/cron/ops-pulse-portal-checks`, { headers, cache: "no-store" }).catch(() => null);
    }

    revalidatePath(pagePath);
    redirectWithFlash({ notice: "SCC Driver Reconciliation refresh queued. Reopen this sheet in a minute to see tracking-level pending details." }, returnHref);
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithFlash({ error: (error as Error).message }, safeReturnHref(formData.get("return_href")));
  }
}
