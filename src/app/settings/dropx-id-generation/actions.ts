"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId, withCompany } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

const settingTypes = ["dropx_id", "biometric_id"] as const;
const scopeTypes = ["company", "category", "model", "location", "designation"] as const;

type SettingType = typeof settingTypes[number];
type ScopeType = typeof scopeTypes[number];

function clean(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function required(value: FormDataEntryValue | null, field: string) {
  const text = clean(value);
  if (!text) throw new Error(`${field} is required.`);
  return text;
}

function flash(params: { error?: string; notice?: string }, type: SettingType = "dropx_id"): never {
  cookies().set("dropx_id_generation_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 30,
    path: "/settings/dropx-id-generation",
    sameSite: "lax"
  });
  redirect(`/settings/dropx-id-generation?type=${type}`);
}

function isNextRedirectError(error: unknown) {
  return typeof (error as { digest?: unknown })?.digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT");
}

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to save ID generation settings.";
  if (message.toLowerCase().includes("dropx_id_generation_settings")) {
    return `${message} Run scripts/dropx_id_generation_settings_v1.sql in Supabase SQL Editor.`;
  }
  return message;
}

function settingType(value: FormDataEntryValue | null): SettingType {
  const text = required(value, "Setting type");
  if (!settingTypes.includes(text as SettingType)) throw new Error("Select a valid setting.");
  return text as SettingType;
}

function scopeType(value: FormDataEntryValue | null): ScopeType {
  const text = required(value, "Generation method");
  if (!scopeTypes.includes(text as ScopeType)) throw new Error("Select a valid generation method.");
  return text as ScopeType;
}

function buildConfigs(formData: FormData, selectedScope: ScopeType) {
  const keys = formData.getAll("row_key").map((value) => String(value));
  const scopes = formData.getAll("row_scope").map((value) => String(value));
  const labels = formData.getAll("row_label").map((value) => String(value));
  const prefixes = formData.getAll("row_prefix").map((value) => String(value).trim().toUpperCase());
  const separators = formData.getAll("row_separator").map((value) => String(value).trim());
  const suffixes = formData.getAll("row_suffix").map((value) => String(value).trim().toUpperCase());
  const serials = formData.getAll("row_next_serial_no").map((value) => String(value));
  const digits = formData.getAll("row_serial_digits").map((value) => String(value));
  const configs: Record<string, Record<string, unknown>> = {};

  keys.forEach((key, index) => {
    if (!key || scopes[index] !== selectedScope) return;
    const nextSerialNo = Number.parseInt(serials[index] || "1", 10);
    const serialDigits = Number.parseInt(digits[index] || "3", 10);
    if (!Number.isInteger(nextSerialNo) || nextSerialNo < 1) {
      throw new Error("Starting number must be 1 or above.");
    }
    if (!Number.isInteger(serialDigits) || serialDigits < 1 || serialDigits > 12) {
      throw new Error("Minimum digit must be between 1 and 12.");
    }
    configs[key] = {
      label: labels[index] || key,
      prefix: prefixes[index] || null,
      separator: separators[index] ?? "",
      suffix: suffixes[index] || null,
      next_serial_no: nextSerialNo,
      serial_digits: serialDigits
    };
  });

  if (!Object.keys(configs).length) throw new Error("Add at least one structure for the selected method.");
  return configs;
}

export async function saveIdGenerationSetting(formData: FormData) {
  const authorization = await requirePagePermission("app_settings", "edit");
  const companyId = requireCompanyId(authorization);
  let selectedSetting: SettingType = "dropx_id";
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    selectedSetting = settingType(formData.get("setting_type"));
    const selectedScope = scopeType(formData.get("scope_type"));
    const configs = buildConfigs(formData, selectedScope);

    const existing = await (supabaseAdmin.from("dropx_id_generation_settings") as any)
      .select("id, is_locked")
      .eq("company_id", companyId)
      .eq("setting_type", selectedSetting)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data?.is_locked) {
      throw new Error(`${selectedSetting === "dropx_id" ? "DropX ID" : "Biometric ID"} generation is locked because an ID was already generated.`);
    }

    const payload = withCompany({
      setting_type: selectedSetting,
      scope_type: selectedScope,
      configs,
      is_active: true,
      updated_at: new Date().toISOString(),
      created_by: authorization.userId
    }, companyId);

    const result = await (supabaseAdmin.from("dropx_id_generation_settings") as any)
      .upsert(payload, { onConflict: "company_id,setting_type" });
    if (result.error) throw new Error(result.error.message);

    revalidatePath("/settings/dropx-id-generation");
    revalidatePath("/settings");
    flash({ notice: "ID generation setting saved." }, selectedSetting);
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    flash({ error: friendlyError(error) }, selectedSetting);
  }
}
