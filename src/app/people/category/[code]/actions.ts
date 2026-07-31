"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAuthorization, hasPermission, isCompanyOwner } from "@/lib/authorization";
import { requireCompanyId, withCompany } from "@/lib/company-scope";
import { cleanCountryCode } from "@/lib/country-codes";
import { dynamicWorkforceTable, isCustomWorkforceCategoryCode, normalizeWorkforceCategoryCode } from "@/lib/dynamic-workforce";
import { generateConfiguredBiometricId, generateConfiguredWorkerId } from "@/lib/dropx-id-generation";
import { supabaseAdmin } from "@/lib/supabase-admin";

function required(value: FormDataEntryValue | null, label: string) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function canManagePeople(authorization: NonNullable<Awaited<ReturnType<typeof getAuthorization>>>, action: "add" | "edit" | "view") {
  if (isCompanyOwner(authorization)) return true;
  return ["employees", "delivery_associates", "contractors", "vendors", "workers"]
    .some((pageCode) => hasPermission(authorization, pageCode, action));
}

function categoryPath(code: string, params?: Record<string, string>) {
  const query = params ? `?${new URLSearchParams(params).toString()}` : "";
  return `/people/category/${encodeURIComponent(code)}${query}`;
}

function fallbackDropxId(code: string) {
  const prefix = code.replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase() || "WRK";
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

export async function createDynamicWorkforceProfile(formData: FormData) {
  const code = normalizeWorkforceCategoryCode(formData.get("category_code"));
  if (!isCustomWorkforceCategoryCode(code)) redirect("/people/all");
  const authorization = await getAuthorization();
  if (!authorization) redirect("/login");
  if (!canManagePeople(authorization, "add")) redirect("/unauthorized?page=onboard&action=add");
  const companyId = requireCompanyId(authorization);

  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const categoryResult = await supabaseAdmin
      .from("workforce_categories")
      .select("id, code, name, statutory_enabled")
      .eq("company_id", companyId)
      .eq("code", code)
      .eq("is_active", true)
      .maybeSingle();
    if (categoryResult.error) throw new Error(categoryResult.error.message);
    if (!categoryResult.data) throw new Error("Workforce category was not found.");

    const provisionResult = await supabaseAdmin.rpc("provision_workforce_category_table", {
      p_category_code: code,
      p_company_id: companyId
    });
    if (provisionResult.error) {
      throw new Error(`${provisionResult.error.message} Run scripts/workforce_dynamic_category_tables_v1.sql in Supabase SQL Editor.`);
    }

    const fullName = required(formData.get("full_name"), "Full name");
    const mobileCountryCode = cleanCountryCode(formData.get("mobile_country_code"));
    const mobile = required(formData.get("mobile"), "Mobile number").replace(/\D/g, "");
    const email = required(formData.get("email"), "Email").toLowerCase();
    const dateOfJoin = required(formData.get("date_of_join"), "Date of join");
    const locationId = required(formData.get("location_id"), "Location");
    const designation = required(formData.get("designation"), "Designation");
    if (!/^\d{6,15}$/.test(mobile)) throw new Error("Mobile number must contain 6 to 15 digits.");
    if (Number.isNaN(Date.parse(dateOfJoin))) throw new Error("Enter a valid date of join.");
    if (!authorization.hasAllLocationAccess && !authorization.locationScopeIds.includes(locationId)) {
      throw new Error("You do not have access to the selected location.");
    }

    const [locationResult, designationResult] = await Promise.all([
      supabaseAdmin.from("stations").select("id").eq("company_id", companyId).eq("id", locationId).eq("is_active", true).maybeSingle(),
      supabaseAdmin.from("designations").select("id, onboarding_categories").eq("company_id", companyId).eq("name", designation).eq("is_active", true).maybeSingle()
    ]);
    if (locationResult.error) throw new Error(locationResult.error.message);
    if (!locationResult.data) throw new Error("Selected location is unavailable.");
    if (designationResult.error) throw new Error(designationResult.error.message);
    if (!designationResult.data || !((designationResult.data.onboarding_categories ?? []) as string[]).includes(code)) {
      throw new Error("Selected designation is unavailable for this category.");
    }

    const [dropxId, biometricId] = await Promise.all([
      generateConfiguredWorkerId({
        category: code,
        companyId,
        designationId: designationResult.data.id,
        designationName: designation,
        fallback: () => fallbackDropxId(code),
        locationId
      }),
      generateConfiguredBiometricId({
        category: code,
        companyId,
        designationId: designationResult.data.id,
        designationName: designation,
        fallback: () => String(Date.now()).slice(-8),
        locationId
      })
    ]);
    const registrationToken = randomBytes(32).toString("base64url");
    const registrationTokenHash = createHash("sha256").update(registrationToken).digest("hex");
    const statutory = formData.getAll("statutory_applicability").map(String).filter(Boolean);
    const payload = withCompany({
      full_name: fullName,
      mobile_country_code: mobileCountryCode,
      mobile,
      email,
      date_of_join: dateOfJoin,
      location_id: locationId,
      designation,
      biometric_id: biometricId,
      dropx_id: dropxId,
      created_by: authorization.userId,
      statutory_applicability: categoryResult.data.statutory_enabled && statutory.length ? statutory : ["not_applicable"],
      onboarding_token_hash: registrationTokenHash,
      onboarding_token_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      onboarding_status: "pending",
      is_active: true
    }, companyId);
    const insertResult = await supabaseAdmin.from(dynamicWorkforceTable(code)).insert(payload);
    if (insertResult.error) {
      const message = insertResult.error.message.toLowerCase();
      if (message.includes("duplicate") || message.includes("unique")) throw new Error("DropX ID, biometric ID, mobile, or email is already registered in this category.");
      throw new Error(insertResult.error.message);
    }
    revalidatePath(`/people/category/${code}`);
    revalidatePath("/people/all");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to add profile.";
    redirect(categoryPath(code, {
      error: message,
      full_name: String(formData.get("full_name") ?? ""),
      mobile_country_code: cleanCountryCode(formData.get("mobile_country_code")),
      mobile: String(formData.get("mobile") ?? "").replace(/\D/g, ""),
      email: String(formData.get("email") ?? ""),
      date_of_join: String(formData.get("date_of_join") ?? ""),
      location_id: String(formData.get("location_id") ?? ""),
      designation: String(formData.get("designation") ?? "")
    }));
  }
  redirect(categoryPath(code, { notice: "Profile added successfully." }));
}
