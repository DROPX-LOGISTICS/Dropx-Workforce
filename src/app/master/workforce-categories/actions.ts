"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId, withCompany } from "@/lib/company-scope";
import { normalizeCategoryProfileFieldRules } from "@/lib/profile-field-rules";
import { supabaseAdmin } from "@/lib/supabase-admin";

function clean(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function required(value: FormDataEntryValue | null, label: string) {
  const valueText = clean(value);
  if (!valueText) throw new Error(`${label} is required.`);
  return valueText;
}

function categoryCode(value: FormDataEntryValue | null) {
  const code = required(value, "Category code").toLowerCase().replace(/\s+/g, "_");
  if (!/^[a-z0-9_]+$/.test(code)) throw new Error("Category code can contain lowercase letters, numbers, and underscores only.");
  return code;
}

function categoryRules(formData: FormData) {
  return normalizeCategoryProfileFieldRules({
    dropx_one: {
      enabled: formData.getAll("dropx_one_enabled_fields"),
      required: formData.getAll("dropx_one_required_fields")
    },
    dashboard: {
      enabled: formData.getAll("dashboard_enabled_fields"),
      required: formData.getAll("dashboard_required_fields")
    }
  });
}

const allowedAppPages = new Set(["dashboard", "attendance", "leave"]);

function appPageAccess(formData: FormData) {
  return Array.from(new Set(
    formData.getAll("app_page_access")
      .map((value) => String(value).trim().toLowerCase())
      .filter((value) => allowedAppPages.has(value))
  ));
}

function categoryRedirect(params: { error?: string; notice?: string }) {
  cookies().set("dropx_workforce_category_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 20,
    path: "/master/workforce-categories",
    sameSite: "lax"
  });
  redirect("/master/workforce-categories");
}

function isNextRedirectError(error: unknown) {
  return typeof (error as { digest?: unknown })?.digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT");
}

export async function createWorkforceCategory(formData: FormData) {
  const authorization = await requirePagePermission("designations", "add");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const { error } = await supabaseAdmin.from("workforce_categories").insert(withCompany({
      code: categoryCode(formData.get("code")),
      name: required(formData.get("name"), "Category name"),
      profile_field_rules: categoryRules(formData),
      app_page_access: appPageAccess(formData),
      is_system: false,
      is_active: true
    }, companyId));
    if (error) throw new Error(error.message);
    revalidatePath("/master/workforce-categories");
    revalidatePath("/master/designations");
    categoryRedirect({ notice: "Workforce category added." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    categoryRedirect({ error: error instanceof Error ? error.message : "Unable to add workforce category." });
  }
}

export async function updateWorkforceCategory(formData: FormData) {
  const authorization = await requirePagePermission("designations", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const id = required(formData.get("id"), "Workforce category");
    const existing = await supabaseAdmin
      .from("workforce_categories")
      .select("code, is_system")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (!existing.data) throw new Error("Workforce category was not found.");

    const code = existing.data.is_system ? existing.data.code : categoryCode(formData.get("code"));
    const { error } = await supabaseAdmin
      .from("workforce_categories")
      .update({
        code,
        name: required(formData.get("name"), "Category name"),
        profile_field_rules: categoryRules(formData),
        app_page_access: appPageAccess(formData),
        is_active: clean(formData.get("status")) !== "inactive",
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);
    revalidatePath("/master/workforce-categories");
    revalidatePath("/master/designations");
    categoryRedirect({ notice: "Workforce category updated." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    categoryRedirect({ error: error instanceof Error ? error.message : "Unable to update workforce category." });
  }
}
