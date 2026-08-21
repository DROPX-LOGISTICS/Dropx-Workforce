"use server";

import { revalidatePath } from "next/cache";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

function value(formData: FormData, key: string, required = true) {
  const result = String(formData.get(key) ?? "").trim();
  if (required && !result) throw new Error(`${key.replaceAll("_", " ")} is required.`);
  return result || null;
}

function code(formData: FormData, key: string) {
  const result = value(formData, key)!.toUpperCase().replace(/[^A-Z0-9_-]/g, "_");
  if (result.length < 2) throw new Error("Code must contain at least two letters or numbers.");
  return result;
}

export async function saveAssetCategory(formData: FormData) {
  const auth = await requirePagePermission("master_asset_types", formData.get("id") ? "edit" : "add");
  const companyId = requireCompanyId(auth);
  if (!supabaseAdmin) throw new Error("Database connection is unavailable.");
  const id = value(formData, "id", false);
  const payload = {
    company_id: companyId,
    code: code(formData, "code"),
    name: value(formData, "name"),
    description: value(formData, "description", false),
    parent_category_id: value(formData, "parent_category_id", false),
    is_active: formData.get("is_active") !== "false",
    updated_by: auth.userId,
    updated_at: new Date().toISOString()
  };
  const result = id
    ? await supabaseAdmin.from("asset_categories").update(payload).eq("company_id", companyId).eq("id", id)
    : await supabaseAdmin.from("asset_categories").insert({ ...payload, created_by: auth.userId });
  if (result.error) throw new Error(result.error.message);
  revalidatePath("/master/assets");
}

export async function saveAssetType(formData: FormData) {
  const auth = await requirePagePermission("master_asset_types", formData.get("id") ? "edit" : "add");
  const companyId = requireCompanyId(auth);
  if (!supabaseAdmin) throw new Error("Database connection is unavailable.");
  const id = value(formData, "id", false);
  const usefulLife = value(formData, "useful_life_months", false);
  const payload = {
    company_id: companyId,
    category_id: value(formData, "category_id"),
    code: code(formData, "code"),
    name: value(formData, "name"),
    description: value(formData, "description", false),
    asset_code_prefix: code(formData, "asset_code_prefix"),
    useful_life_months: usefulLife ? Number(usefulLife) : null,
    requires_serial_number: formData.get("requires_serial_number") === "true",
    is_active: formData.get("is_active") !== "false",
    updated_by: auth.userId,
    updated_at: new Date().toISOString()
  };
  if (payload.useful_life_months && (!Number.isInteger(payload.useful_life_months) || payload.useful_life_months < 1)) {
    throw new Error("Useful life must be a whole number of months.");
  }
  const result = id
    ? await supabaseAdmin.from("asset_types").update(payload).eq("company_id", companyId).eq("id", id)
    : await supabaseAdmin.from("asset_types").insert({ ...payload, created_by: auth.userId });
  if (result.error) throw new Error(result.error.message);
  revalidatePath("/master/assets");
  revalidatePath("/assets");
}
