import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import {
  WorkforceDropxOneUserPreview,
  type WorkforceDropxOnePreviewUser
} from "@/components/workforce-dropx-one-user-preview";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { firstDesignationBusinessCategory } from "@/lib/designation-business-categories";
import {
  intersectProfileFieldChannelRules,
  normalizeCategoryProfileFieldRules,
  profileFieldRulesForCategory
} from "@/lib/profile-field-rules";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  defaultWorkforceAppPageAccess,
  normalizeWorkforceAppPageAccess
} from "@/lib/workforce-app-pages";
import { loadWorkforceCommunicationRecipients } from "@/lib/workforce-communication-recipients";

export const dynamic = "force-dynamic";

type DesignationRow = {
  id: string;
  code: string;
  name: string;
  app_page_access: unknown;
  onboarding_categories: unknown;
  registration_category_code: string | null;
  profile_field_rules: unknown;
  designation_category?: unknown;
};

type CategoryRow = { code: string; profile_field_rules: unknown };

function registrationCategory(designation: DesignationRow | undefined) {
  const configured = String(designation?.registration_category_code ?? "").trim().toLowerCase();
  if (configured) return configured;
  const categories = Array.isArray(designation?.onboarding_categories)
    ? designation.onboarding_categories.map(String).map((value) => value.trim().toLowerCase()).filter(Boolean)
    : [];
  return categories[0] ?? "workforce";
}

export default async function DropxOneUserPreviewPage() {
  const authorization = await requirePagePermission("designations", "access");
  const companyId = requireCompanyId(authorization);
  let users: WorkforceDropxOnePreviewUser[] = [];
  let error: string | null = null;

  if (!supabaseAdmin) {
    error = "Supabase service role key is not configured.";
  } else {
    try {
      const [recipientResult, designationResult, categoryResult] = await Promise.all([
        loadWorkforceCommunicationRecipients(authorization),
        supabaseAdmin
          .from("designations")
          .select("id,code,name,app_page_access,onboarding_categories,registration_category_code,profile_field_rules,designation_category:designation_categories!designations_designation_category_id_fkey(id,code,name,people_module,is_active)")
          .eq("company_id", companyId)
          .eq("is_active", true)
          .order("name"),
        supabaseAdmin
          .from("workforce_categories")
          .select("code,profile_field_rules")
          .eq("company_id", companyId)
          .eq("is_active", true)
      ]);

      error = designationResult.error?.message ?? categoryResult.error?.message ?? null;
      if (!error) {
        const designations = ((designationResult.data ?? []) as DesignationRow[])
          .filter((designation) => firstDesignationBusinessCategory(designation.designation_category)?.people_module === "delivery_network");
        const categories = (categoryResult.data ?? []) as CategoryRow[];
        const designationByName = new Map(designations.map((designation) => [designation.name.trim().toLowerCase(), designation]));
        const categoryByCode = new Map(categories.map((category) => [category.code.trim().toLowerCase(), category]));

        users = recipientResult
          .filter((record) => record.isActive || [
            "pending",
            "registration in progress",
            "submitted",
            "under review",
            "returned",
            "draft"
          ].includes(record.status.trim().toLowerCase()))
          .sort((left, right) => Number(right.isActive) - Number(left.isActive) || left.name.localeCompare(right.name))
          .map((record) => {
            const designation = designationByName.get(String(record.designation ?? "").trim().toLowerCase());
            const categoryCode = registrationCategory(designation);
            const categoryRules = normalizeCategoryProfileFieldRules(categoryByCode.get(categoryCode)?.profile_field_rules);
            const designationRules = profileFieldRulesForCategory(designation?.profile_field_rules, categoryCode, "field_executives");
            const pages = normalizeWorkforceAppPageAccess(
              Array.isArray(designation?.app_page_access) ? designation.app_page_access : defaultWorkforceAppPageAccess
            );
            return {
              id: `${record.profileType}:${record.accountId}`,
              name: record.name || "Unnamed Workforce user",
              reference: record.reference || "",
              designation: designation?.name || record.designation || "Workforce",
              status: record.status,
              location: record.location || "",
              pageAccess: pages,
              fieldRules: intersectProfileFieldChannelRules(categoryRules, designationRules)
            };
          });
      }
    } catch (loadError) {
      error = loadError instanceof Error ? loadError.message : "Unable to load registered Workforce users.";
    }
  }

  return (
    <AppShell active="DropX One User Preview" pageCode="designations">
      <PageHead
        eyebrow="Workforce mobile experience"
        title="DropX One User Preview"
        subtitle="Select an active or in-progress registered Workforce account and inspect its real designation menu, registration fields, status and station in a read-only in-app experience."
        action={<span className="status-pill neutral">Read-only preview</span>}
      />
      {error ? <section className="panel message-panel error"><div className="panel-body"><strong>Preview data is unavailable</strong><p className="subtle" style={{ marginTop: 6 }}>{error}</p></div></section> : null}
      {!error ? <WorkforceDropxOneUserPreview users={users} /> : null}
    </AppShell>
  );
}
