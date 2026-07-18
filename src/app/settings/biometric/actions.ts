"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

function clean(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function required(value: FormDataEntryValue | null, field: string) {
  const text = clean(value);
  if (!text) throw new Error(`${field} is required.`);
  return text;
}

function numberValue(value: FormDataEntryValue | null, field: string) {
  const text = required(value, field);
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`${field} must be a valid port number.`);
  }
  return parsed;
}

function positiveNumberValue(value: FormDataEntryValue | null, field: string) {
  const text = required(value, field);
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive whole number.`);
  }
  return parsed;
}

function settingsRedirect(params: { error?: string; notice?: string }): never {
  cookies().set("dropx_biometric_settings_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 20,
    path: "/settings",
    sameSite: "lax"
  });
  redirect("/settings/biometric");
}

export async function saveBiometricSettings(formData: FormData) {
  const authorization = await requirePagePermission("app_settings", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const hostPcAddress = required(formData.get("host_pc_address"), "Host PC address");
    const hostPcPort = numberValue(formData.get("host_pc_port"), "Host PC port");
    const enrolmentStartNumber = positiveNumberValue(formData.get("enrolment_start_number"), "Biometric enrolment start number");
    const eventTransferMode = required(formData.get("event_transfer_mode"), "Event transfer mode");
    const communicationPasswordEnabled = clean(formData.get("communication_password_enabled")) === "true";
    const communicationPassword = communicationPasswordEnabled ? clean(formData.get("communication_password")) : null;

    const { error } = await supabaseAdmin.from("biometric_middleware_settings").upsert({
      id: true,
      company_id: companyId,
      host_pc_address: hostPcAddress,
      host_pc_port: hostPcPort,
      enrolment_start_number: enrolmentStartNumber,
      event_transfer_mode: eventTransferMode,
      communication_password_enabled: communicationPasswordEnabled,
      communication_password: communicationPassword,
      middleware_server_ip: clean(formData.get("middleware_server_ip")),
      webhook_url: clean(formData.get("webhook_url")) ?? "https://dashboard.dropxlogistics.com/api/biometric/punch",
      notes: clean(formData.get("notes")),
      is_enabled: formData.get("is_enabled") === "on",
      updated_by: authorization.userId,
      updated_at: new Date().toISOString()
    }, { onConflict: "company_id,id" });
    if (error) throw new Error(error.message);

    revalidatePath("/settings");
    revalidatePath("/settings/biometric");
  } catch (error) {
    settingsRedirect({ error: error instanceof Error ? error.message : "Unable to save biometric settings." });
  }

  settingsRedirect({ notice: "Biometric settings saved." });
}
