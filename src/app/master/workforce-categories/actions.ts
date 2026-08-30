"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId, withCompany } from "@/lib/company-scope";
import { dynamicWorkforceTable } from "@/lib/dynamic-workforce";
import { normalizeCategoryProfileFieldRules } from "@/lib/profile-field-rules";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { defaultWorkforceAppPageAccess } from "@/lib/workforce-app-pages";

const categoryPath = "/delivery-network/engagement-types";
const peopleOnlyEngagementCodes = new Set(["employees", "field_executives"]);

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
  const code = required(value, "Registration policy code").toLowerCase().replace(/\s+/g, "_");
  if (!/^[a-z0-9_]+$/.test(code)) throw new Error("Registration policy code can contain lowercase letters, numbers, and underscores only.");
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

function categoryRedirect(params: { error?: string; notice?: string }) {
  cookies().set("dropx_workforce_category_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 20,
    path: categoryPath,
    sameSite: "lax"
  });
  redirect(categoryPath);
}

function isNextRedirectError(error: unknown) {
  return typeof (error as { digest?: unknown })?.digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT");
}

function revalidateWorkforceCategoryPaths() {
  revalidatePath(categoryPath);
  revalidatePath("/master/designations");
  revalidatePath("/settings/dropx-id-generation");
  revalidatePath("/settings/meta");
  revalidatePath("/people/all");
  revalidatePath("/employees");
  revalidatePath("/field-executive");
  revalidatePath("/contractors");
  revalidatePath("/vendors");
  revalidatePath("/workers");
}

export async function createWorkforceCategory(formData: FormData) {
  const authorization = await requirePagePermission("workforce_categories", "add");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const code = categoryCode(formData.get("code"));
    if (peopleOnlyEngagementCodes.has(code)) throw new Error("People/HR employee policies cannot be created in Workforce.");
    const { error } = await supabaseAdmin.from("workforce_categories").insert(withCompany({
      code,
      name: required(formData.get("name"), "Registration policy name"),
      profile_field_rules: categoryRules(formData),
      app_page_access: defaultWorkforceAppPageAccess,
      statutory_enabled: false,
      direct_activate: formData.get("direct_activate") === "true",
      is_system: false,
      is_active: true
    }, companyId));
    if (error) throw new Error(error.message);
    const systemCodes = new Set(["employees", "field_executives", "contractors", "vendors", "workers"]);
    if (!systemCodes.has(code)) {
      const provisionResult = await supabaseAdmin.rpc("provision_workforce_category_table", {
        p_category_code: code,
        p_company_id: companyId
      });
      if (provisionResult.error) {
        throw new Error(`${provisionResult.error.message} Run scripts/workforce_dynamic_category_tables_v1.sql in Supabase SQL Editor.`);
      }
    }
    revalidateWorkforceCategoryPaths();
    categoryRedirect({ notice: "Registration policy added." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    categoryRedirect({ error: error instanceof Error ? error.message : "Unable to add registration policy." });
  }
}

export async function updateWorkforceCategory(formData: FormData) {
  const authorization = await requirePagePermission("workforce_categories", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const id = required(formData.get("id"), "Registration policy");
    const existing = await supabaseAdmin
      .from("workforce_categories")
      .select("code, is_system")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (!existing.data) throw new Error("Registration policy was not found.");
    if (peopleOnlyEngagementCodes.has(existing.data.code)) throw new Error("People/HR employee policies cannot be edited in Workforce.");

    const code = existing.data.is_system ? existing.data.code : categoryCode(formData.get("code"));
    const { error } = await supabaseAdmin
      .from("workforce_categories")
      .update({
        code,
        name: required(formData.get("name"), "Registration policy name"),
        profile_field_rules: categoryRules(formData),
        statutory_enabled: false,
        direct_activate: formData.get("direct_activate") === "true",
        is_active: clean(formData.get("status")) !== "inactive",
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);
    revalidateWorkforceCategoryPaths();
    categoryRedirect({ notice: "Registration policy updated." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    categoryRedirect({ error: error instanceof Error ? error.message : "Unable to update registration policy." });
  }
}

export async function deleteWorkforceCategory(formData: FormData) {
  const authorization = await requirePagePermission("workforce_categories", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const id = required(formData.get("id"), "Registration policy");
    const existing = await supabaseAdmin
      .from("workforce_categories")
      .select("code, name, is_system")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (!existing.data) throw new Error("Registration policy was not found.");
    if (peopleOnlyEngagementCodes.has(existing.data.code)) throw new Error("People/HR employee policies cannot be deleted in Workforce.");
    if (existing.data.is_system) throw new Error("System registration policies cannot be deleted.");

    const designationUsage = await supabaseAdmin
      .from("designations")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .contains("onboarding_categories", [existing.data.code]);
    if (designationUsage.error) throw new Error(designationUsage.error.message);
    if ((designationUsage.count ?? 0) > 0) {
      throw new Error(`Remove ${existing.data.name} from all designations before deleting this category.`);
    }

    const peopleUsage = await supabaseAdmin
      .from(dynamicWorkforceTable(existing.data.code))
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId);
    if (peopleUsage.error) throw new Error(peopleUsage.error.message);
    if ((peopleUsage.count ?? 0) > 0) {
      throw new Error(`This category contains ${peopleUsage.count} people record${peopleUsage.count === 1 ? "" : "s"}. Move or delete them before deleting the category.`);
    }

    const deletion = await supabaseAdmin
      .from("workforce_categories")
      .delete()
      .eq("id", id)
      .eq("company_id", companyId)
      .eq("is_system", false);
    if (deletion.error) throw new Error(deletion.error.message);

    revalidateWorkforceCategoryPaths();
    categoryRedirect({ notice: "Registration policy deleted." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    categoryRedirect({ error: error instanceof Error ? error.message : "Unable to delete registration policy." });
  }
}

export async function forceDeleteWorkersCategory(formData: FormData) {
  const authorization = await requirePagePermission("workforce_categories", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!authorization.isMasterOwner && authorization.roleCode !== "OWNER") {
      throw new Error("Only the owner can force delete a system registration policy.");
    }
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const id = required(formData.get("id"), "Registration policy");
    const existing = await supabaseAdmin
      .from("workforce_categories")
      .select("code, name")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (!existing.data) throw new Error("Registration policy was not found.");
    if (existing.data.code !== "workers") throw new Error("This force-delete action is restricted to the Workers category.");

    const designationResult = await supabaseAdmin
      .from("designations")
      .select("id, onboarding_categories")
      .eq("company_id", companyId)
      .contains("onboarding_categories", ["workers"]);
    if (designationResult.error) throw new Error(designationResult.error.message);

    for (const designation of designationResult.data ?? []) {
      const categories = Array.isArray(designation.onboarding_categories)
        ? designation.onboarding_categories.filter((category) => category !== "workers")
        : [];
      const update = await supabaseAdmin
        .from("designations")
        .update({ onboarding_categories: categories })
        .eq("id", designation.id)
        .eq("company_id", companyId);
      if (update.error) throw new Error(update.error.message);
    }

    const deletion = await supabaseAdmin
      .from("workforce_categories")
      .delete()
      .eq("id", id)
      .eq("company_id", companyId)
      .eq("code", "workers");
    if (deletion.error) throw new Error(deletion.error.message);

    revalidateWorkforceCategoryPaths();
    categoryRedirect({ notice: "Workers registration policy force deleted. Historical Workforce records were retained." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    categoryRedirect({ error: error instanceof Error ? error.message : "Unable to force delete the Workers category." });
  }
}
