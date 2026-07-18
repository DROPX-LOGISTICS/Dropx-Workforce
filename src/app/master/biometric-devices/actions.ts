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

function numberValue(value: FormDataEntryValue | null, field: string) {
  const text = required(value, field);
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) throw new Error("Enter a valid number.");
  if (parsed < 1 || parsed > 65535) throw new Error("Device port must be between 1 and 65535.");
  return parsed;
}

function deviceRedirect(params: { error?: string; notice?: string }) {
  cookies().set("dropx_biometric_devices_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 20,
    path: "/master/biometric-devices",
    sameSite: "lax"
  });
  redirect("/master/biometric-devices");
}

function isNextRedirectError(error: unknown) {
  return typeof (error as { digest?: unknown })?.digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT");
}

function payloadFromForm(formData: FormData) {
  const deviceSerial = required(formData.get("device_serial"), "Serial number").toUpperCase();
  const terminalId = required(formData.get("terminal_id"), "Device ID");
  if (!/^\d{1,10}$/.test(terminalId)) throw new Error("Device ID must be numeric.");
  return {
    device_serial: deviceSerial,
    terminal_id: terminalId,
    device_no: terminalId,
    location_id: required(formData.get("location_id"), "Location"),
    device_name: null,
    model: required(formData.get("model"), "Model no."),
    local_ip_address: required(formData.get("local_ip_address"), "Local IP address"),
    local_port: numberValue(formData.get("local_port"), "Local port no."),
    p2p_type: clean(formData.get("p2p_type")),
    p2p_device_id: clean(formData.get("p2p_device_id")),
    connection_mode: clean(formData.get("connection_mode")) ?? "TCP_PUSH",
    network_password: clean(formData.get("network_password")),
    status: "Disconnected",
    is_active: true,
    remarks: null
  };
}

export async function createBiometricDevice(formData: FormData) {
  const authorization = await requirePagePermission("biometric_devices", "add");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const payload = payloadFromForm(formData);
    const { error } = await supabaseAdmin.from("biometric_devices").insert(withCompany({
      ...payload,
      created_by: authorization.userId
    }, companyId));
    if (error) throw new Error(error.message);
    revalidatePath("/master/biometric-devices");
    deviceRedirect({ notice: "Device added." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    deviceRedirect({ error: error instanceof Error ? error.message : "Unable to add device." });
  }
}

export async function updateBiometricDevice(formData: FormData) {
  const authorization = await requirePagePermission("biometric_devices", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const id = required(formData.get("id"), "Device");
    const payload = payloadFromForm(formData);
    const { error } = await supabaseAdmin
      .from("biometric_devices")
      .update({
        ...payload,
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);
    revalidatePath("/master/biometric-devices");
    deviceRedirect({ notice: "Device updated." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    deviceRedirect({ error: error instanceof Error ? error.message : "Unable to update device." });
  }
}

export async function deleteBiometricDevice(formData: FormData) {
  const authorization = await requirePagePermission("biometric_devices", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const id = required(formData.get("id"), "Device");
    const { error } = await supabaseAdmin
      .from("biometric_devices")
      .delete()
      .eq("id", id)
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);
    revalidatePath("/master/biometric-devices");
    deviceRedirect({ notice: "Device deleted." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    deviceRedirect({ error: error instanceof Error ? error.message : "Unable to delete device." });
  }
}
