"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId, withCompany } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

function clean(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

function required(value: FormDataEntryValue | null, field: string) {
  const text = clean(value);
  if (!text) throw new Error(`${field} is required.`);
  return text;
}

function timeValue(value: FormDataEntryValue | null) {
  const text = clean(value);
  return text && /^\d{2}:\d{2}$/.test(text) ? text : null;
}

function intValue(value: FormDataEntryValue | null, fallback: number) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function redirectWithFlash(params: { error?: string; notice?: string }) {
  cookies().set("dropx_cod_master_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 25,
    path: "/master/cod-master",
    sameSite: "lax"
  });
  redirect("/master/cod-master");
}

function isNextRedirectError(error: unknown) {
  return typeof (error as { digest?: unknown })?.digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT");
}

async function stationDetails(companyId: string, locationId: string) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const { data, error } = await supabaseAdmin
    .from("stations")
    .select("id, station_code, state")
    .eq("company_id", companyId)
    .eq("id", locationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Selected station is not available.");
  return data;
}

async function buildPayload(companyId: string, formData: FormData) {
  const locationId = required(formData.get("location_id"), "Station");
  const station = await stationDetails(companyId, locationId);
  const codDepositDay = required(formData.get("cod_deposit_day"), "COD deposit day");
  if (!["Same Day", "Next Day"].includes(codDepositDay)) throw new Error("Select Same Day or Next Day.");

  return {
    location_id: locationId,
    station_code: clean(formData.get("station_code")) ?? station.station_code,
    state: clean(formData.get("state")) ?? station.state ?? null,
    cms_agency: required(formData.get("cms_agency"), "CMS agency"),
    agent_name: required(formData.get("agent_name"), "Agent name"),
    agent_mobile: required(formData.get("agent_mobile"), "Mobile no."),
    cod_deposit_day: codDepositDay,
    pickup_time: required(formData.get("pickup_time"), "Pickup time"),
    pickup_window_start: timeValue(formData.get("pickup_window_start")),
    pickup_window_end: timeValue(formData.get("pickup_window_end")),
    cod_submission_due_time: timeValue(formData.get("cod_submission_due_time")),
    eod_submission_due_time: timeValue(formData.get("eod_submission_due_time")),
    escalation_contact: clean(formData.get("escalation_contact")),
    escalation_email: clean(formData.get("escalation_email")),
    cod_sheet_link: clean(formData.get("cod_sheet_link")),
    portal_station_code: clean(formData.get("portal_station_code")) ?? station.station_code,
    portal_login_url: clean(formData.get("portal_login_url")),
    portal_username: clean(formData.get("portal_username")),
    portal_secret_name: clean(formData.get("portal_secret_name")),
    amazon_driver_recon_url: clean(formData.get("amazon_driver_recon_url")),
    amazon_bank_deposit_url: clean(formData.get("amazon_bank_deposit_url")),
    driver_recon_due_time: timeValue(formData.get("driver_recon_due_time")),
    prepared_deposit_due_time: timeValue(formData.get("prepared_deposit_due_time")),
    portal_check_interval_minutes: intValue(formData.get("portal_check_interval_minutes"), 30),
    portal_checks_enabled: clean(formData.get("portal_checks_enabled")) === "true",
    is_active: clean(formData.get("is_active")) !== "false"
  };
}

export async function createCodMaster(formData: FormData) {
  const authorization = await requirePagePermission("cod_master", "add");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const payload = await buildPayload(companyId, formData);
    if (!authorization.hasAllLocationAccess && !authorization.locationScopeIds.includes(payload.location_id)) {
      throw new Error("You do not have access to the selected station.");
    }
    const { error } = await supabaseAdmin.from("cod_station_settings").insert(withCompany({
      ...payload,
      created_by: authorization.userId,
      updated_by: authorization.userId
    }, companyId));
    if (error) throw new Error(error.message.includes("duplicate") ? "COD Master is already configured for this station. Edit that row instead." : error.message);
    revalidatePath("/master/cod-master");
    redirectWithFlash({ notice: "COD Master saved." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithFlash({ error: error instanceof Error ? error.message : "Unable to save COD Master." });
  }
}

export async function updateCodMaster(formData: FormData) {
  const authorization = await requirePagePermission("cod_master", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const id = required(formData.get("id"), "COD Master row");
    const payload = await buildPayload(companyId, formData);
    if (!authorization.hasAllLocationAccess && !authorization.locationScopeIds.includes(payload.location_id)) {
      throw new Error("You do not have access to the selected station.");
    }
    const { error } = await supabaseAdmin
      .from("cod_station_settings")
      .update({
        ...payload,
        updated_by: authorization.userId,
        updated_at: new Date().toISOString()
      })
      .eq("company_id", companyId)
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/master/cod-master");
    redirectWithFlash({ notice: "COD Master updated." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithFlash({ error: error instanceof Error ? error.message : "Unable to update COD Master." });
  }
}

export async function deleteCodMaster(formData: FormData) {
  const authorization = await requirePagePermission("cod_master", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const id = required(formData.get("id"), "COD Master row");
    const { error } = await supabaseAdmin
      .from("cod_station_settings")
      .delete()
      .eq("company_id", companyId)
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/master/cod-master");
    redirectWithFlash({ notice: "COD Master removed." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithFlash({ error: error instanceof Error ? error.message : "Unable to remove COD Master." });
  }
}
