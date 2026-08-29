import {
  intersectProfileFieldChannelRules,
  normalizeCategoryProfileFieldRules,
  profileFieldRulesForCategory,
  type ProfileFieldChannelRules
} from "./profile-field-rules";
import { supabaseAdmin } from "./supabase-admin";
import {
  profileFieldRuleCategory,
  type NonEmployeeProfileType
} from "./workforce-profiles";

type DesignationPolicyRow = {
  id: string;
  code: string | null;
  name: string | null;
  onboarding_categories: string[] | null;
  registration_category_code?: string | null;
  profile_destination?: string | null;
  profile_field_rules: unknown;
};

export type WorkforceRegistrationPolicy = {
  categoryCode: string;
  designationCode: string;
  designationId: string;
  fieldRules: ProfileFieldChannelRules;
  pageAccess: string[];
  statutoryEnabled: boolean;
};

function normalizeCategoryCode(value: unknown) {
  const code = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9_]+$/.test(code) ? code : "";
}

function categoryCodes(value: unknown) {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map(normalizeCategoryCode)
    .filter(Boolean)));
}

function isMissingColumnError(error: unknown) {
  const message = String((error as { message?: unknown })?.message ?? "").toLowerCase();
  return (message.includes("column") || message.includes("schema cache")) &&
    (message.includes("does not exist") || message.includes("schema cache"));
}

function explicitRuleSet(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.enabled) && Array.isArray(record.required)) return true;
  const dropxOne = record.dropx_one;
  if (!dropxOne || typeof dropxOne !== "object") return false;
  const channel = dropxOne as Record<string, unknown>;
  return Array.isArray(channel.enabled) && Array.isArray(channel.required);
}

export function resolveRegistrationCategoryCode({
  onboardingCategories,
  profileType,
  registrationCategoryCode
}: {
  onboardingCategories: unknown;
  profileType: NonEmployeeProfileType;
  registrationCategoryCode?: unknown;
}) {
  const categories = categoryCodes(onboardingCategories);
  const configured = normalizeCategoryCode(registrationCategoryCode);
  if (configured) {
    if (!categories.includes(configured)) {
      throw new Error("The designation registration policy is outside its configured engagement types.");
    }
    return configured;
  }
  if (categories.length === 1) return categories[0];
  if (profileType !== "workforce") {
    const legacyCategory = profileFieldRuleCategory(profileType);
    if (categories.includes(legacyCategory)) return legacyCategory;
  }
  if (!categories.length) {
    throw new Error("No registration policy is assigned to this designation in Workforce Master.");
  }
  throw new Error("Choose one Registration policy for this designation in Workforce Master.");
}

async function designationPolicyRow({
  companyId,
  designationId,
  designationName
}: {
  companyId: string;
  designationId?: string | null;
  designationName?: string | null;
}) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const columns = "id, code, name, onboarding_categories, registration_category_code, profile_destination, profile_field_rules";
  const fallbackColumns = "id, code, name, onboarding_categories, profile_destination, profile_field_rules";

  async function execute(selectColumns: string, caseInsensitiveName = false) {
    let query = supabaseAdmin!
      .from("designations")
      .select(selectColumns)
      .eq("company_id", companyId)
      .eq("is_active", true);
    if (designationId) query = query.eq("id", designationId);
    else if (designationName && caseInsensitiveName) query = query.ilike("name", designationName);
    else if (designationName) query = query.eq("name", designationName);
    else throw new Error("A designation is required for Workforce registration.");
    return query.maybeSingle();
  }

  let result = await execute(columns);
  if (result.error && isMissingColumnError(result.error)) result = await execute(fallbackColumns);
  if (result.error) throw new Error(result.error.message);
  if (!result.data && !designationId && designationName) {
    result = await execute(fallbackColumns, true);
    if (result.error) throw new Error(result.error.message);
  }
  if (!result.data) {
    throw new Error("The assigned designation is not available in Workforce Master.");
  }
  return result.data as unknown as DesignationPolicyRow;
}

export async function loadWorkforceRegistrationPolicy({
  companyId,
  designationId,
  designationName,
  profileType
}: {
  companyId: string;
  designationId?: string | null;
  designationName?: string | null;
  profileType: NonEmployeeProfileType;
}): Promise<WorkforceRegistrationPolicy> {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const designation = await designationPolicyRow({ companyId, designationId, designationName });
  if (profileType === "workforce" && designation.profile_destination && designation.profile_destination !== "workforce") {
    throw new Error("This designation is not routed to the Workforce register.");
  }
  const categoryCode = resolveRegistrationCategoryCode({
    onboardingCategories: designation.onboarding_categories,
    profileType,
    registrationCategoryCode: designation.registration_category_code
  });
  const designationRuleRecord = designation.profile_field_rules && typeof designation.profile_field_rules === "object"
    ? designation.profile_field_rules as Record<string, unknown>
    : {};
  if (!explicitRuleSet(designationRuleRecord[categoryCode])) {
    throw new Error("Registration fields are not defined for this designation in Workforce Master.");
  }

  let categoryResult = await supabaseAdmin
    .from("workforce_categories")
    .select("profile_field_rules, app_page_access, statutory_enabled")
    .eq("company_id", companyId)
    .eq("code", categoryCode)
    .eq("is_active", true)
    .maybeSingle();
  if (categoryResult.error && isMissingColumnError(categoryResult.error)) {
    const fallback = await supabaseAdmin
      .from("workforce_categories")
      .select("profile_field_rules, app_page_access")
      .eq("company_id", companyId)
      .eq("code", categoryCode)
      .eq("is_active", true)
      .maybeSingle();
    categoryResult = {
      ...fallback,
      data: fallback.data ? { ...fallback.data, statutory_enabled: false } : null
    } as typeof categoryResult;
  }
  if (categoryResult.error) throw new Error(categoryResult.error.message);
  if (!categoryResult.data) {
    throw new Error("The designation registration policy is inactive or missing in Workforce Categories.");
  }
  if (!explicitRuleSet(categoryResult.data.profile_field_rules)) {
    throw new Error("Registration fields are not defined for this Workforce category.");
  }

  const fieldRules = intersectProfileFieldChannelRules(
    normalizeCategoryProfileFieldRules(categoryResult.data.profile_field_rules),
    profileFieldRulesForCategory(designation.profile_field_rules, categoryCode, categoryCode)
  );
  if (!fieldRules.dropx_one.enabled.length) {
    throw new Error("No DropX One registration fields are enabled for this designation policy.");
  }
  return {
    categoryCode,
    designationCode: String(designation.code ?? "").trim().toUpperCase(),
    designationId: designation.id,
    fieldRules,
    pageAccess: Array.isArray(categoryResult.data.app_page_access)
      ? categoryResult.data.app_page_access.map(String)
      : [],
    statutoryEnabled: Boolean(categoryResult.data.statutory_enabled)
  };
}
