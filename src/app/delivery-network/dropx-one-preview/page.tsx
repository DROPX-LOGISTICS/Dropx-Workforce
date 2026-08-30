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

export const dynamic = "force-dynamic";

type WorkforceRow = {
  id: string;
  full_name: string | null;
  dropx_id: string | null;
  designation_id: string | null;
  designation: string | null;
  onboarding_status: string | null;
  is_active: boolean | null;
  location_id: string | null;
  stations?: { station_code?: string | null; station_name?: string | null } | Array<{ station_code?: string | null; station_name?: string | null }> | null;
};

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

function relation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function statusLabel(status: string | null, isActive: boolean | null) {
  const value = String(status ?? "pending").trim().toLowerCase();
  if (isActive || value === "active") return "Active";
  if (value === "under_review") return "Under review";
  if (value === "returned") return "Returned";
  if (value === "submitted") return "Submitted";
  return "Registration in progress";
}

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
    let workforceQuery = supabaseAdmin
      .from("workforce")
      .select("id,full_name,dropx_id,designation_id,designation,onboarding_status,is_active,location_id,stations:stations!workforce_location_id_fkey(station_code,station_name)")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .not("migration_state", "in", "(reclassified,moved_to_vendor)")
      .not("onboarding_status", "in", "(rejected,cancelled)")
      .order("is_active", { ascending: false })
      .order("full_name");
    if (!authorization.hasAllLocationAccess) {
      workforceQuery = workforceQuery.in("location_id", authorization.locationScopeIds.length
        ? authorization.locationScopeIds
        : ["00000000-0000-0000-0000-000000000000"]);
    }

    const [workforceResult, designationResult, categoryResult] = await Promise.all([
      workforceQuery,
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

    error = workforceResult.error?.message ?? designationResult.error?.message ?? categoryResult.error?.message ?? null;
    if (!error) {
      const workforce = (workforceResult.data ?? []) as WorkforceRow[];
      const designations = ((designationResult.data ?? []) as DesignationRow[])
        .filter((designation) => firstDesignationBusinessCategory(designation.designation_category)?.people_module === "delivery_network");
      const categories = (categoryResult.data ?? []) as CategoryRow[];
      const designationById = new Map(designations.map((designation) => [designation.id, designation]));
      const designationByName = new Map(designations.map((designation) => [designation.name.trim().toLowerCase(), designation]));
      const categoryByCode = new Map(categories.map((category) => [category.code.trim().toLowerCase(), category]));

      users = workforce.map((record) => {
        const designation = designationById.get(String(record.designation_id ?? ""))
          ?? designationByName.get(String(record.designation ?? "").trim().toLowerCase());
        const categoryCode = registrationCategory(designation);
        const categoryRules = normalizeCategoryProfileFieldRules(categoryByCode.get(categoryCode)?.profile_field_rules);
        const designationRules = profileFieldRulesForCategory(designation?.profile_field_rules, categoryCode, "field_executives");
        const station = relation(record.stations);
        const pages = normalizeWorkforceAppPageAccess(
          Array.isArray(designation?.app_page_access) ? designation.app_page_access : defaultWorkforceAppPageAccess
        );
        return {
          id: record.id,
          name: record.full_name || "Unnamed Workforce user",
          reference: record.dropx_id || "",
          designation: designation?.name || record.designation || "Workforce",
          status: statusLabel(record.onboarding_status, record.is_active),
          location: station?.station_code || station?.station_name || "",
          pageAccess: pages,
          fieldRules: intersectProfileFieldChannelRules(categoryRules, designationRules)
        };
      });
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
