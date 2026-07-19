"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyId, withCompany } from "@/lib/company-scope";
import {
  clean,
  executiveReconciliationStatuses,
  required,
  type ExecutiveReconciliationStatus
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

function statusFromForm(value: FormDataEntryValue | null) {
  const status = required(value, "Reconciliation status");
  if (!executiveReconciliationStatuses.includes(status as ExecutiveReconciliationStatus)) {
    throw new Error("Select a valid reconciliation status.");
  }
  return status as ExecutiveReconciliationStatus;
}

function optionalAmount(value: FormDataEntryValue | null) {
  const text = clean(value);
  if (!text) return 0;
  const parsed = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Pending amount must be a valid amount.");
  return Number(parsed.toFixed(2));
}

function optionalNumber(value: FormDataEntryValue | null) {
  const text = clean(value);
  if (!text) return 0;
  const parsed = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Shipment count must be a valid number.");
  return Number(parsed.toFixed(2));
}

async function stationForInput(companyId: string, locationId: string | null, stationCode: string) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const columns = "id, station_code, station_name, state";
  const query = supabaseAdmin.from("stations").select(columns).eq("company_id", companyId);
  const result = locationId
    ? await query.eq("id", locationId).maybeSingle()
    : await query.eq("station_code", stationCode).maybeSingle();

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
  const stationCode = required(formData.get("station_code"), "Station code").trim().toUpperCase();
  const station = await stationForInput(companyId, clean(formData.get("location_id")), stationCode);
  assertLocationAccess(authorization, station.id);

  const sourceAssociateName = clean(formData.get("source_associate_name"));
  const manualAssociateName = clean(formData.get("manual_associate_name"));
  if (!sourceAssociateName && !manualAssociateName) {
    throw new Error("Associate name is required when the executive is not available in shipment import.");
  }

  const payload = withCompany({
    business_date: required(formData.get("business_date"), "Business date"),
    location_id: station.id,
    station_code: station.station_code,
    provider_employee_id: required(formData.get("provider_employee_id"), "Executive ID").trim(),
    source_associate_name: sourceAssociateName,
    manual_associate_name: manualAssociateName,
    shipment_type: clean(formData.get("shipment_type")),
    total_delivery: optionalNumber(formData.get("total_delivery")),
    total_activity: optionalNumber(formData.get("total_activity")),
    reconciliation_status: statusFromForm(formData.get("reconciliation_status")),
    pending_amount: optionalAmount(formData.get("pending_amount")),
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
