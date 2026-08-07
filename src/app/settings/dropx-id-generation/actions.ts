"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId, withCompany } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

const settingTypes = ["dropx_id", "biometric_id"] as const;
const scopeTypes = ["company", "category", "model", "location", "designation", "multi_designation"] as const;

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
  const designationIds = formData.getAll("row_designation_ids").map((value) => String(value));
  const configs: Record<string, Record<string, unknown>> = {};
  const assignedDesignations = new Set<string>();

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
    let mappedDesignationIds: string[] | undefined;
    if (selectedScope === "multi_designation") {
      try {
        const parsed = JSON.parse(designationIds[index] || "[]");
        mappedDesignationIds = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string" && Boolean(id)) : [];
      } catch {
        throw new Error(`Select valid designations for ${labels[index] || "the series"}.`);
      }
      if (!mappedDesignationIds.length) throw new Error(`Select at least one designation for ${labels[index] || "each series"}.`);
      for (const designationId of mappedDesignationIds) {
        if (assignedDesignations.has(designationId)) throw new Error("A designation cannot be mapped to more than one series.");
        assignedDesignations.add(designationId);
      }
    }
    configs[key] = {
      label: labels[index] || key,
      prefix: prefixes[index] || null,
      separator: separators[index] ?? "",
      suffix: suffixes[index] || null,
      next_serial_no: nextSerialNo,
      serial_digits: serialDigits,
      is_locked: false,
      ...(mappedDesignationIds ? { designation_ids: mappedDesignationIds } : {})
    };
  });

  if (!Object.keys(configs).length) throw new Error("Add at least one structure for the selected method.");
  return configs;
}

function generationStructure(config: Record<string, unknown> | undefined) {
  return {
    label: config?.label ?? null,
    prefix: config?.prefix ?? null,
    separator: config?.separator ?? "",
    suffix: config?.suffix ?? null,
    next_serial_no: config?.next_serial_no ?? 1,
    serial_digits: config?.serial_digits ?? 3
  };
}

function validateLockedMultiDesignationUpdate(
  existingConfigs: Record<string, Record<string, unknown>>,
  proposedConfigs: Record<string, Record<string, unknown>>
) {
  const existingKeys = Object.keys(existingConfigs).sort();
  const existingAssignments = new Map<string, string>();
  for (const key of existingKeys) {
    const seriesLocked = existingConfigs[key].is_locked !== false;
    if (seriesLocked && !proposedConfigs[key]) {
      throw new Error("A series that has generated an ID cannot be removed.");
    }
    if (seriesLocked && JSON.stringify(generationStructure(existingConfigs[key])) !== JSON.stringify(generationStructure(proposedConfigs[key]))) {
      throw new Error("Series name, prefix, separator, starting number, digits and suffix are locked after ID generation has started.");
    }
    if (!seriesLocked || !proposedConfigs[key]) continue;
    const existingIds = Array.isArray(existingConfigs[key].designation_ids) ? existingConfigs[key].designation_ids as string[] : [];
    existingIds.forEach((designationId) => existingAssignments.set(designationId, key));
  }
  for (const [designationId, key] of existingAssignments) {
    const proposedIds = Array.isArray(proposedConfigs[key].designation_ids) ? proposedConfigs[key].designation_ids as string[] : [];
    if (!proposedIds.includes(designationId)) {
      throw new Error("Existing designation mappings cannot be removed or moved after ID generation has started.");
    }
  }
  for (const [key, config] of Object.entries(proposedConfigs)) {
    config.is_locked = existingConfigs[key]?.is_locked !== false && Boolean(existingConfigs[key]) ? true : false;
  }
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
      .select("id, is_locked, scope_type, configs")
      .eq("company_id", companyId)
      .eq("setting_type", selectedSetting)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    const lockedMultiDesignation = Boolean(existing.data?.is_locked && existing.data?.scope_type === "multi_designation" && selectedScope === "multi_designation");
    if (existing.data?.is_locked && !lockedMultiDesignation) {
      throw new Error(`${selectedSetting === "dropx_id" ? "DropX ID" : "Biometric ID"} generation is locked because an ID was already generated.`);
    }
    if (lockedMultiDesignation) {
      validateLockedMultiDesignationUpdate(existing.data.configs ?? {}, configs);
      const existingIds = new Set<string>(Object.values(existing.data.configs ?? {}).flatMap((config: any) => Array.isArray(config.designation_ids) ? config.designation_ids : []));
      const proposedIds = Array.from(new Set(Object.values(configs).flatMap((config: any) => Array.isArray(config.designation_ids) ? config.designation_ids : [])));
      const addedIds = proposedIds.filter((id) => !existingIds.has(id));
      if (addedIds.length) {
        const validDesignations = await supabaseAdmin.from("designations").select("id").eq("company_id", companyId).eq("is_active", true).in("id", addedIds);
        if (validDesignations.error) throw new Error(validDesignations.error.message);
        if ((validDesignations.data ?? []).length !== addedIds.length) throw new Error("One or more selected designations are not active for this company.");
      }
      const mappingUpdate = await (supabaseAdmin.rpc as any)("update_locked_multi_designation_mappings", {
        p_company_id: companyId,
        p_configs: configs,
        p_setting_type: selectedSetting
      });
      if (mappingUpdate.error) throw new Error(mappingUpdate.error.message);
      revalidatePath("/settings/dropx-id-generation");
      revalidatePath("/settings");
      flash({ notice: "New designation mappings saved. Series structure and counters remain locked." }, selectedSetting);
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
