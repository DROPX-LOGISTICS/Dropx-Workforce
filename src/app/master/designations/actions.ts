"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId, withCompany } from "@/lib/company-scope";
import {
  firstDesignationBusinessCategory,
  normalizeDesignationPeopleModule,
  type DesignationPeopleModule
} from "@/lib/designation-business-categories";
import { normalizeDesignationCategories } from "@/lib/designation-categories";
import {
  designationProfileDestinationAllowed,
  normalizeDesignationProfileDestination
} from "@/lib/designation-profile-destination";
import { designationPortalOptions } from "@/lib/designation-portal-access";
import { normalizeCategoryProfileFieldRules } from "@/lib/profile-field-rules";
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

type DesignationActionScope = {
  peopleModule: "delivery_network";
  returnPath: "/delivery-network/designations";
};

const workforceDesignationScope: DesignationActionScope = {
  peopleModule: "delivery_network",
  returnPath: "/delivery-network/designations"
};

function designationScopeLabel(peopleModule: DesignationPeopleModule) {
  if (peopleModule === "delivery_network") return "Workforce Designation Master";
  return "People Designation Master";
}

function designationRedirect(params: { error?: string; notice?: string }, returnPath: DesignationActionScope["returnPath"]) {
  cookies().set("dropx_designation_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 20,
    path: returnPath,
    sameSite: "lax"
  });
  redirect(returnPath);
}

function isNextRedirectError(error: unknown) {
  return typeof (error as { digest?: unknown })?.digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT");
}

function friendlyError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (message.toLowerCase().includes("model_ids")) {
    return "Designation model setup is pending. Run scripts/designations_model_scope_v1.sql in Supabase SQL Editor, then try again.";
  }
  if (message.toLowerCase().includes("app_page_access")) {
    return "Designation app-page setup is pending. Run scripts/designation_app_pages_v1.sql in Supabase SQL Editor, then try again.";
  }
  if (message.toLowerCase().includes("onboarding_role_ids")) {
    return "Designation onboarding access setup is pending. Run scripts/designations_onboarding_role_access_v1.sql in Supabase SQL Editor, then try again.";
  }
  if (message.toLowerCase().includes("portal_permissions")) {
    return "Designation portal access setup is pending. Run scripts/designations_portal_permissions_v1.sql in Supabase SQL Editor, then try again.";
  }
  if (message.toLowerCase().includes("is_field_operations")) {
    return "Field Operations setup is pending. Apply the field operations mapping migration, then try again.";
  }
  if (message.toLowerCase().includes("designation_category")) {
    return "Designation Category setup is pending. Apply the designation category isolation migration, then try again.";
  }
  if (message.toLowerCase().includes("profile_destination")) {
    return "Profile destination setup is pending. Apply the committed designation profile destination migration, then try again.";
  }
  return message;
}

function providerIds(formData: FormData) {
  return Array.from(new Set(
    formData.getAll("provider_ids")
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
  ));
}

function modelIds(formData: FormData) {
  return Array.from(new Set(
    formData.getAll("model_ids")
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
  ));
}

function onboardingRoleIds(formData: FormData) {
  return Array.from(new Set(formData.getAll("onboarding_role_ids").map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function portalPermissions(formData: FormData) {
  return Object.fromEntries(designationPortalOptions.map(({ code }) => {
    const edit = formData.has(`portal_${code}_edit`);
    return [code, {
      add: formData.has(`portal_${code}_add`),
      view: formData.has(`portal_${code}_view`) || edit,
      edit
    }];
  }));
}

async function validateOnboardingRoles(companyId: string, roleIds: string[]) {
  if (!roleIds.length) return;
  const { data, error } = await supabaseAdmin!.from("user_roles").select("id").eq("company_id", companyId).eq("is_active", true).in("id", roleIds);
  if (error) throw new Error(error.message);
  if ((data ?? []).length !== roleIds.length) throw new Error("One or more onboarding roles are not available for this company.");
}

function onboardingCategories(formData: FormData) {
  const categories = normalizeDesignationCategories(formData.getAll("onboarding_categories"), []);
  if (!categories.length) throw new Error("Select at least one engagement type.");
  if (categories.some((category) => category === "employees" || category === "field_executives")) {
    throw new Error("Employee and Field Executive engagement types belong to People and cannot be used for a Workforce designation.");
  }
  return categories;
}

function registrationCategoryCode(formData: FormData, categories: string[]) {
  const code = required(formData.get("registration_category_code"), "Registration policy").toLowerCase();
  if (!categories.includes(code)) {
    throw new Error("Registration policy must be one of the selected engagement types.");
  }
  return code;
}

async function designationCategoryId(
  companyId: string,
  formData: FormData,
  requiredPeopleModule: DesignationPeopleModule | null
) {
  const categoryId = required(formData.get("designation_category_id"), "Designation category");
  const { data, error } = await supabaseAdmin!
    .from("designation_categories")
    .select("id, people_module")
    .eq("id", categoryId)
    .eq("company_id", companyId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const peopleModule = normalizeDesignationPeopleModule(data?.people_module);
  if (!data || !peopleModule) {
    throw new Error("Select an active designation category for this company.");
  }
  if (requiredPeopleModule && peopleModule !== requiredPeopleModule) {
    throw new Error(`${designationScopeLabel(requiredPeopleModule)} accepts ${requiredPeopleModule === "delivery_network" ? "Workforce" : "HR"} designations only.`);
  }
  return { id: data.id, peopleModule };
}

function profileDestination(formData: FormData, peopleModule: DesignationPeopleModule) {
  const destination = normalizeDesignationProfileDestination(formData.get("profile_destination"));
  if (!destination) throw new Error("Profile destination is required.");
  if (!designationProfileDestinationAllowed(peopleModule, destination)) {
    throw new Error(`${designationScopeLabel(peopleModule)} cannot route profiles to the ${destination} table.`);
  }
  return destination;
}

async function requireExistingDesignationScope(
  companyId: string,
  designationId: string,
  requiredPeopleModule: DesignationPeopleModule | null
) {
  if (!requiredPeopleModule) return;
  const { data, error } = await supabaseAdmin!
    .from("designations")
    .select("id, designation_category:designation_categories!designations_designation_category_id_fkey(id, code, name, people_module, is_active)")
    .eq("id", designationId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Designation was not found.");
  if (firstDesignationBusinessCategory(data.designation_category)?.people_module !== requiredPeopleModule) {
    throw new Error(`This designation is outside the ${designationScopeLabel(requiredPeopleModule)}.`);
  }
}

async function validateOnboardingCategories(companyId: string, categories: string[]) {
  const { data, error } = await supabaseAdmin!
    .from("workforce_categories")
    .select("code")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .in("code", categories);
  if (error) throw new Error(error.message);
  if ((data ?? []).length !== categories.length) {
    throw new Error("Remove deleted engagement types before saving this designation.");
  }
}

function appPageAccess(formData: FormData) {
  return Array.from(new Set(
    formData.getAll("app_page_access")
      .map((value) => String(value ?? "").trim().toLowerCase())
      .filter((value) => ["dashboard", "attendance", "roster", "leave", "performance"].includes(value))
  ));
}

function profileFieldRules(formData: FormData, categories: string[]) {
  return Object.fromEntries(categories.map((category) => [
    category,
    normalizeCategoryProfileFieldRules({
      dropx_one: {
        enabled: formData.getAll(`${category}_dropx_one_enabled_fields`),
        required: formData.getAll(`${category}_dropx_one_required_fields`)
      },
      dashboard: {
        enabled: formData.getAll(`${category}_dashboard_enabled_fields`),
        required: formData.getAll(`${category}_dashboard_required_fields`)
      }
    })
  ]));
}

async function createDesignationForScope(formData: FormData, scope: DesignationActionScope) {
  const authorization = await requirePagePermission("designations", "add");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const code = required(formData.get("code"), "Designation code").toUpperCase();
    const name = required(formData.get("name"), "Designation name");
    const designationCategory = await designationCategoryId(companyId, formData, scope.peopleModule);
    const destination = profileDestination(formData, designationCategory.peopleModule);
    const categories = onboardingCategories(formData);
    const registrationCategory = registrationCategoryCode(formData, categories);
    await validateOnboardingCategories(companyId, categories);
    const roleIds = onboardingRoleIds(formData);
    await validateOnboardingRoles(companyId, roleIds);
    const { error } = await supabaseAdmin.from("designations").insert(withCompany({
      code,
      name,
      designation_category_id: designationCategory.id,
      profile_destination: destination,
      provider_ids: providerIds(formData),
      model_ids: modelIds(formData),
      location_ids: [],
      onboarding_categories: categories,
      registration_category_code: registrationCategory,
      profile_field_rules: profileFieldRules(formData, categories),
      app_page_access: appPageAccess(formData),
      onboarding_role_ids: roleIds,
      portal_permissions: portalPermissions(formData),
      is_field_operations: formData.has("is_field_operations"),
      is_active: true
    }, companyId));
    if (error) throw new Error(error.message);

    revalidatePath("/delivery-network/designations");
    revalidatePath("/delivery-network");
    revalidatePath("/delivery-network/onboarding");
    designationRedirect({ notice: "Designation added." }, scope.returnPath);
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    designationRedirect({ error: friendlyError(error, "Unable to add designation.") }, scope.returnPath);
  }
}

async function updateDesignationForScope(formData: FormData, scope: DesignationActionScope) {
  const authorization = await requirePagePermission("designations", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const id = required(formData.get("id"), "Designation");
    await requireExistingDesignationScope(companyId, id, scope.peopleModule);
    const code = required(formData.get("code"), "Designation code").toUpperCase();
    const name = required(formData.get("name"), "Designation name");
    const designationCategory = await designationCategoryId(companyId, formData, scope.peopleModule);
    const destination = profileDestination(formData, designationCategory.peopleModule);
    const status = clean(formData.get("status")) === "inactive" ? false : true;
    const categories = onboardingCategories(formData);
    const registrationCategory = registrationCategoryCode(formData, categories);
    await validateOnboardingCategories(companyId, categories);
    const roleIds = onboardingRoleIds(formData);
    await validateOnboardingRoles(companyId, roleIds);

    const { error } = await supabaseAdmin
      .from("designations")
      .update({
        code,
        name,
        designation_category_id: designationCategory.id,
        profile_destination: destination,
        provider_ids: providerIds(formData),
        model_ids: modelIds(formData),
        location_ids: [],
        onboarding_categories: categories,
        registration_category_code: registrationCategory,
        profile_field_rules: profileFieldRules(formData, categories),
        app_page_access: appPageAccess(formData),
        onboarding_role_ids: roleIds,
        portal_permissions: portalPermissions(formData),
        is_field_operations: formData.has("is_field_operations"),
        is_active: status,
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);

    revalidatePath("/delivery-network/designations");
    revalidatePath("/delivery-network");
    revalidatePath("/delivery-network/onboarding");
    designationRedirect({ notice: "Designation updated." }, scope.returnPath);
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    designationRedirect({ error: friendlyError(error, "Unable to update designation.") }, scope.returnPath);
  }
}

async function deleteDesignationForScope(formData: FormData, scope: DesignationActionScope) {
  const authorization = await requirePagePermission("designations", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const id = required(formData.get("id"), "Designation");
    await requireExistingDesignationScope(companyId, id, scope.peopleModule);
    const { error } = await supabaseAdmin.from("designations").delete().eq("id", id).eq("company_id", companyId);
    if (error) throw new Error(error.message);

    revalidatePath("/delivery-network/designations");
    designationRedirect({ notice: "Designation deleted." }, scope.returnPath);
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    designationRedirect({ error: error instanceof Error ? error.message : "Unable to delete designation." }, scope.returnPath);
  }
}

export async function createWorkforceDesignation(formData: FormData) {
  return createDesignationForScope(formData, workforceDesignationScope);
}

export async function updateWorkforceDesignation(formData: FormData) {
  return updateDesignationForScope(formData, workforceDesignationScope);
}

export async function deleteWorkforceDesignation(formData: FormData) {
  return deleteDesignationForScope(formData, workforceDesignationScope);
}

export async function transferWorkforceDesignationToPeople(formData: FormData) {
  const authorization = await requirePagePermission("designations", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!authorization.isMasterOwner) {
      throw new Error("Only Super Admin can transfer a designation between products.");
    }
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const id = required(formData.get("id"), "Designation");
    const destination = required(formData.get("people_profile_destination"), "People profile destination").toLowerCase();
    if (!["employees", "contractors", "workers"].includes(destination)) {
      throw new Error("Select an employee, contractor or worker destination in People.");
    }
    await requireExistingDesignationScope(companyId, id, workforceDesignationScope.peopleModule);

    const categoryResult = await supabaseAdmin
      .from("designation_categories")
      .select("id")
      .eq("company_id", companyId)
      .eq("people_module", "people_hr")
      .eq("is_active", true)
      .order("sort_order")
      .order("name")
      .limit(1)
      .maybeSingle();
    if (categoryResult.error) throw new Error(categoryResult.error.message);
    if (!categoryResult.data?.id) throw new Error("Create an active People designation category before transferring this role.");

    const designationResult = await supabaseAdmin
      .from("designations")
      .update({
        designation_category_id: categoryResult.data.id,
        profile_destination: destination,
        onboarding_categories: [destination],
        registration_category_code: destination,
        is_field_operations: false,
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .eq("company_id", companyId)
      .select("id, name")
      .maybeSingle();
    if (designationResult.error || !designationResult.data) {
      throw new Error(designationResult.error?.message ?? "Designation was not found.");
    }

    revalidatePath("/delivery-network/designations");
    revalidatePath("/settings/designations");
    designationRedirect({ notice: `${designationResult.data.name} transferred to the People Designation Master.` }, workforceDesignationScope.returnPath);
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    designationRedirect({ error: friendlyError(error, "Unable to transfer the designation to People.") }, workforceDesignationScope.returnPath);
  }
}
