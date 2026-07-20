"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId, withCompany } from "@/lib/company-scope";
import { normalizeDesignationCategories } from "@/lib/designation-categories";
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

function designationRedirect(params: { error?: string; notice?: string }) {
  cookies().set("dropx_designation_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 20,
    path: "/master/designations",
    sameSite: "lax"
  });
  redirect("/master/designations");
}

function isNextRedirectError(error: unknown) {
  return typeof (error as { digest?: unknown })?.digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT");
}

function providerIds(formData: FormData) {
  return Array.from(new Set(
    formData.getAll("provider_ids")
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
  ));
}

function locationIds(formData: FormData) {
  return Array.from(new Set(
    formData.getAll("location_ids")
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
  ));
}

function onboardingCategories(formData: FormData) {
  return normalizeDesignationCategories(formData.getAll("onboarding_categories"));
}

export async function createDesignation(formData: FormData) {
  const authorization = await requirePagePermission("designations", "add");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const code = required(formData.get("code"), "Designation code").toUpperCase();
    const name = required(formData.get("name"), "Designation name");
    const { error } = await supabaseAdmin.from("designations").insert(withCompany({
      code,
      name,
      provider_ids: providerIds(formData),
      location_ids: locationIds(formData),
      onboarding_categories: onboardingCategories(formData),
      is_active: true
    }, companyId));
    if (error) throw new Error(error.message);

    revalidatePath("/master/designations");
    designationRedirect({ notice: "Designation added." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    designationRedirect({ error: error instanceof Error ? error.message : "Unable to add designation." });
  }
}

export async function updateDesignation(formData: FormData) {
  const authorization = await requirePagePermission("designations", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const id = required(formData.get("id"), "Designation");
    const code = required(formData.get("code"), "Designation code").toUpperCase();
    const name = required(formData.get("name"), "Designation name");
    const status = clean(formData.get("status")) === "inactive" ? false : true;

    const { error } = await supabaseAdmin
      .from("designations")
      .update({
        code,
        name,
        provider_ids: providerIds(formData),
        location_ids: locationIds(formData),
        onboarding_categories: onboardingCategories(formData),
        is_active: status,
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);

    revalidatePath("/master/designations");
    designationRedirect({ notice: "Designation updated." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    designationRedirect({ error: error instanceof Error ? error.message : "Unable to update designation." });
  }
}

export async function deleteDesignation(formData: FormData) {
  const authorization = await requirePagePermission("designations", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const id = required(formData.get("id"), "Designation");
    const { error } = await supabaseAdmin.from("designations").delete().eq("id", id).eq("company_id", companyId);
    if (error) throw new Error(error.message);

    revalidatePath("/master/designations");
    designationRedirect({ notice: "Designation deleted." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    designationRedirect({ error: error instanceof Error ? error.message : "Unable to delete designation." });
  }
}
