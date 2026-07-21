"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId, withCompany } from "@/lib/company-scope";
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

function flash(params: { error?: string; notice?: string }): never {
  cookies().set("dropx_id_generation_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 30,
    path: "/settings/dropx-id-generation",
    sameSite: "lax"
  });
  redirect("/settings/dropx-id-generation");
}

function isNextRedirectError(error: unknown) {
  return typeof (error as { digest?: unknown })?.digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT");
}

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to save DropX ID generation settings.";
  if (message.toLowerCase().includes("dropx_id_generation_settings")) {
    return `${message} Run scripts/dropx_id_generation_settings_v1.sql in Supabase SQL Editor.`;
  }
  return message;
}

function category(value: FormDataEntryValue | null) {
  const text = required(value, "Category");
  if (!["employee", "field_executive", "vendor", "contractor", "worker"].includes(text)) {
    throw new Error("Select a valid category.");
  }
  return text;
}

function scope(formData: FormData, selectedCategory: string) {
  const scopeType = required(formData.get("scope_type"), "Generation basis");
  if (!["category", "model", "location", "designation"].includes(scopeType)) {
    throw new Error("Select a valid generation basis.");
  }
  if (scopeType === "category") return { scopeType, scopeKey: selectedCategory, scopeLabel: selectedCategory };
  const key = required(formData.get(`${scopeType}_id`), `${scopeType} scope`);
  const label = clean(formData.get(`${scopeType}_label`));
  return { scopeType, scopeKey: key, scopeLabel: label };
}

function structure(formData: FormData) {
  const nextSerialNo = Number.parseInt(String(formData.get("next_serial_no") ?? "1"), 10);
  const serialDigits = Number.parseInt(String(formData.get("serial_digits") ?? "3"), 10);
  if (!Number.isInteger(nextSerialNo) || nextSerialNo < 1) throw new Error("Starting serial number must be 1 or above.");
  if (!Number.isInteger(serialDigits) || serialDigits < 1 || serialDigits > 12) throw new Error("Decimal places must be between 1 and 12.");
  return {
    prefix: clean(formData.get("prefix"))?.toUpperCase() ?? null,
    separator: String(formData.get("separator") ?? "").trim(),
    suffix: clean(formData.get("suffix"))?.toUpperCase() ?? null,
    next_serial_no: nextSerialNo,
    serial_digits: serialDigits,
    is_active: clean(formData.get("is_active")) !== "false"
  };
}

export async function createDropxIdGenerationSetting(formData: FormData) {
  const authorization = await requirePagePermission("app_settings", "add");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const selectedCategory = category(formData.get("category"));
    const selectedScope = scope(formData, selectedCategory);
    const payload = withCompany({
      category: selectedCategory,
      scope_type: selectedScope.scopeType,
      scope_key: selectedScope.scopeKey,
      scope_label: selectedScope.scopeLabel,
      ...structure(formData),
      created_by: authorization.userId
    }, companyId);
    const { error } = await (supabaseAdmin.from("dropx_id_generation_settings") as any).insert(payload);
    if (error) throw new Error(error.message);
    revalidatePath("/settings/dropx-id-generation");
    flash({ notice: "DropX ID generation rule saved." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    flash({ error: friendlyError(error) });
  }
}

export async function updateDropxIdGenerationSetting(formData: FormData) {
  const authorization = await requirePagePermission("app_settings", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const id = required(formData.get("id"), "Rule");
    const existing = await (supabaseAdmin.from("dropx_id_generation_settings") as any)
      .select("is_locked")
      .eq("company_id", companyId)
      .eq("id", id)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data?.is_locked) throw new Error("This rule has already generated a DropX ID and cannot be edited.");

    const selectedCategory = category(formData.get("category"));
    const selectedScope = scope(formData, selectedCategory);
    const { error } = await (supabaseAdmin.from("dropx_id_generation_settings") as any)
      .update({
        category: selectedCategory,
        scope_type: selectedScope.scopeType,
        scope_key: selectedScope.scopeKey,
        scope_label: selectedScope.scopeLabel,
        ...structure(formData),
        updated_at: new Date().toISOString()
      })
      .eq("company_id", companyId)
      .eq("id", id)
      .eq("is_locked", false);
    if (error) throw new Error(error.message);
    revalidatePath("/settings/dropx-id-generation");
    flash({ notice: "DropX ID generation rule updated." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    flash({ error: friendlyError(error) });
  }
}
