import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { DesignationForm } from "@/components/designation-form";
import { PageHead } from "@/components/page-head";
import { PendingLink } from "@/components/pending-link";
import { StatusPill } from "@/components/status-pill";
import { SubmitButton } from "@/components/submit-button";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import {
  firstDesignationBusinessCategory,
  type DesignationBusinessCategory,
  type DesignationPeopleModule
} from "@/lib/designation-business-categories";
import { designationCategoryLabel, normalizeDesignationCategories } from "@/lib/designation-categories";
import {
  designationProfileDestinationLabel,
  inferDesignationProfileDestination,
  type DesignationProfileDestination
} from "@/lib/designation-profile-destination";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";
import {
  createWorkforceDesignation,
  deleteWorkforceDesignation,
  updateWorkforceDesignation
} from "@/app/master/designations/actions";

type ProviderRow = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

type LocationRow = {
  id: string;
  station_code: string;
  station_name: string | null;
  hide_from_location_list?: boolean | null;
};

type ModelRow = {
  id: string;
  provider_id: string | null;
  code: string;
  name: string;
  is_active: boolean;
  providers?: { code: string; name: string } | { code: string; name: string }[] | null;
};

type DesignationRow = {
  id: string;
  code: string;
  name: string;
  designation_category_id?: string | null;
  designation_category?: DesignationBusinessCategory | DesignationBusinessCategory[] | null;
  profile_destination?: DesignationProfileDestination | null;
  registration_category_code?: string | null;
  provider_ids: string[];
  location_ids?: string[];
  model_ids?: string[] | null;
  onboarding_categories: string[];
  app_page_access?: string[] | null;
  onboarding_role_ids?: string[] | null;
  portal_permissions?: unknown;
  profile_field_rules?: unknown;
  is_field_operations?: boolean | null;
  is_active: boolean;
};

type UserRoleRow = { id: string; code: string; name: string; is_active: boolean };

type WorkforceCategoryRow = {
  code: string;
  name: string;
  is_active: boolean;
};

function loadFlash() {
  const raw = cookies().get("dropx_designation_flash")?.value;
  if (!raw) return { error: null as string | null, notice: null as string | null };
  try {
    const parsed = JSON.parse(raw) as { error?: unknown; notice?: unknown };
    return {
      error: typeof parsed.error === "string" ? parsed.error : null,
      notice: typeof parsed.notice === "string" ? parsed.notice : null
    };
  } catch {
    return { error: null, notice: null };
  }
}

function isMissingColumnError(error: unknown) {
  const message = String((error as { message?: unknown })?.message ?? "").toLowerCase();
  return (message.includes("column") && (message.includes("does not exist") || message.includes("schema cache"))) ||
    message.includes("designation_categories") || message.includes("designation_category_id");
}

async function loadDesignations(
  companyId: string,
  locationScopeIds: string[],
  hasAllLocationAccess: boolean,
  peopleModule: DesignationPeopleModule
) {
  if (!supabaseAdmin) {
    return {
      designations: [] as DesignationRow[],
      providers: [] as ProviderRow[],
      locations: [] as LocationRow[],
      models: [] as ModelRow[],
      categories: [] as WorkforceCategoryRow[],
      businessCategories: [] as DesignationBusinessCategory[],
      roles: [] as UserRoleRow[],
      error: "Supabase service role key is not configured."
    };
  }

  const [designationsResult, providersResult, locationsResult, modelsResult, categoriesResult, businessCategoriesResult, rolesResult] = await Promise.all([
    supabaseAdmin.from("designations").select("id, code, name, designation_category_id, designation_category:designation_categories!designations_designation_category_id_fkey!inner(id, code, name, people_module, is_active), profile_destination, registration_category_code, provider_ids, model_ids, location_ids, onboarding_categories, profile_field_rules, app_page_access, onboarding_role_ids, portal_permissions, is_field_operations, is_active").eq("company_id", companyId).eq("designation_category.people_module", peopleModule).eq("designation_category.is_active", true).order("code"),
    supabaseAdmin.from("providers").select("id, code, name, is_active").eq("company_id", companyId).order("code"),
    supabaseAdmin.from("stations").select("id, station_code, station_name, hide_from_location_list").eq("company_id", companyId).eq("is_active", true).order("station_code"),
    supabaseAdmin.from("location_models").select("id, provider_id, code, name, is_active, providers (code, name)").eq("company_id", companyId).eq("is_active", true).order("code"),
    supabaseAdmin.from("workforce_categories").select("code, name, is_active").eq("company_id", companyId).eq("is_active", true).order("sort_order").order("name"),
    supabaseAdmin.from("designation_categories").select("id, code, name, people_module, is_active").eq("company_id", companyId).eq("people_module", peopleModule).eq("is_active", true).order("sort_order").order("name"),
    supabaseAdmin.from("user_roles").select("id, code, name, is_active").eq("company_id", companyId).eq("is_active", true).order("name")
  ]);
  let designationRows: unknown[] = designationsResult.data ?? [];
  let designationError: { message?: string } | null = designationsResult.error;
  if (isMissingColumnError(designationsResult.error)) {
    const registrationCompatibleResult = await supabaseAdmin
      .from("designations")
      .select("id, code, name, designation_category_id, designation_category:designation_categories!designations_designation_category_id_fkey!inner(id, code, name, people_module, is_active), profile_destination, provider_ids, model_ids, location_ids, onboarding_categories, profile_field_rules, app_page_access, onboarding_role_ids, portal_permissions, is_field_operations, is_active")
      .eq("company_id", companyId)
      .eq("designation_category.people_module", peopleModule)
      .eq("designation_category.is_active", true)
      .order("code");
    if (!registrationCompatibleResult.error) {
      designationRows = (registrationCompatibleResult.data ?? []).map((row) => ({
        ...row,
        registration_category_code: null
      }));
      designationError = null;
    } else {
      let fallbackRows: unknown[] = [];
      let fallbackError: { message?: string } | null = null;
      // Product isolation is fail-closed. A database that cannot classify a
      // designation must not fall back to exposing the shared legacy master.
      fallbackRows = [];
      fallbackError = registrationCompatibleResult.error;
      designationRows = fallbackRows.map((row) => ({
        ...(row as Record<string, unknown>),
        location_ids: Array.isArray((row as { location_ids?: unknown }).location_ids) ? (row as { location_ids: string[] }).location_ids : [],
        model_ids: Array.isArray((row as { model_ids?: unknown }).model_ids) ? (row as { model_ids: string[] }).model_ids : [],
        onboarding_categories: Array.isArray((row as { onboarding_categories?: unknown }).onboarding_categories) ? (row as { onboarding_categories: string[] }).onboarding_categories : ["employees"],
        app_page_access: ["dashboard", "attendance", "leave"],
        profile_field_rules: {},
        onboarding_role_ids: [],
        portal_permissions: null,
        designation_category_id: null,
        designation_category: null,
        profile_destination: null,
        registration_category_code: null,
        is_field_operations: false,
      }));
      designationError = fallbackError;
    }
  }

  if (designationError) {
    return {
      designations: [] as DesignationRow[],
      providers: [] as ProviderRow[],
      locations: [] as LocationRow[],
      models: [] as ModelRow[],
      categories: [] as WorkforceCategoryRow[],
      businessCategories: [] as DesignationBusinessCategory[],
      roles: [] as UserRoleRow[],
      error: designationError.message
    };
  }
  if (providersResult.error) {
    return {
      designations: [] as DesignationRow[],
      providers: [] as ProviderRow[],
      locations: [] as LocationRow[],
      models: [] as ModelRow[],
      categories: [] as WorkforceCategoryRow[],
      businessCategories: [] as DesignationBusinessCategory[],
      roles: [] as UserRoleRow[],
      error: providersResult.error.message
    };
  }
  if (locationsResult.error) {
    return {
      designations: [] as DesignationRow[],
      providers: [] as ProviderRow[],
      locations: [] as LocationRow[],
      models: [] as ModelRow[],
      categories: [] as WorkforceCategoryRow[],
      businessCategories: [] as DesignationBusinessCategory[],
      roles: [] as UserRoleRow[],
      error: locationsResult.error.message
    };
  }
  if (modelsResult.error) {
    return {
      designations: [] as DesignationRow[],
      providers: [] as ProviderRow[],
      locations: [] as LocationRow[],
      models: [] as ModelRow[],
      categories: [] as WorkforceCategoryRow[],
      businessCategories: [] as DesignationBusinessCategory[],
      roles: [] as UserRoleRow[],
      error: modelsResult.error.message
    };
  }
  if (businessCategoriesResult.error) {
    return {
      designations: [] as DesignationRow[],
      providers: [] as ProviderRow[],
      locations: [] as LocationRow[],
      models: [] as ModelRow[],
      categories: [] as WorkforceCategoryRow[],
      businessCategories: [] as DesignationBusinessCategory[],
      roles: [] as UserRoleRow[],
      error: businessCategoriesResult.error.message
    };
  }
  const fallbackCategories: WorkforceCategoryRow[] = [
    { code: "employees", name: "Employees", is_active: true },
    { code: "field_executives", name: "Field Executives", is_active: true },
    { code: "contractors", name: "Independent Contractor", is_active: true },
    { code: "vendors", name: "Vendors", is_active: true },
    { code: "workers", name: "Workers", is_active: true }
  ];

  const locations = hasAllLocationAccess
    ? (locationsResult.data ?? [])
    : (locationsResult.data ?? []).filter((location) => locationScopeIds.includes(location.id) && !location.hide_from_location_list);

  return {
    designations: (designationRows as DesignationRow[]).map((designation) => {
      const businessCategory = firstDesignationBusinessCategory(designation.designation_category);
      const onboardingCategories = normalizeDesignationCategories(designation.onboarding_categories);
      return {
        ...designation,
        onboarding_categories: onboardingCategories,
        profile_destination: inferDesignationProfileDestination({
          onboardingCategories,
          peopleModule: businessCategory?.people_module ?? null,
          profileDestination: designation.profile_destination
        })
      };
    }),
    providers: (providersResult.data ?? []) as ProviderRow[],
    locations: locations as LocationRow[],
    models: (modelsResult.data ?? []) as ModelRow[],
    categories: categoriesResult.error ? fallbackCategories : (categoriesResult.data ?? []) as WorkforceCategoryRow[],
    businessCategories: (businessCategoriesResult.data ?? []) as DesignationBusinessCategory[],
    roles: rolesResult.error ? [] : (rolesResult.data ?? []) as UserRoleRow[],
    error: null
  };
}

export type DesignationMasterScope = {
  activeLabel: string;
  basePath: "/delivery-network/designations";
  eyebrow: string;
  peopleModule: "delivery_network";
  subtitle: string;
  title: string;
};

export async function DesignationMasterPageContent({
  scope,
  searchParams
}: {
  scope: DesignationMasterScope;
  searchParams?: { add?: string; edit?: string; q?: string };
}) {
  const authorization = await requirePagePermission("designations", "access");
  const companyId = requireCompanyId(authorization);
  const pagePermission = authorization.permissions.designations;
  const { designations, providers, models, categories, businessCategories, roles, error } = await loadDesignations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess, scope.peopleModule);
  const flash = loadFlash();
  const query = String(searchParams?.q ?? "").trim().toLowerCase();
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  const modelById = new Map(models.map((model) => [model.id, model]));
  const categoryNameByCode = new Map(categories.map((category) => [category.code, category.name]));
  const scopedDesignations = designations;
  const scopedBusinessCategories = businessCategories;
  const filteredDesignations = scopedDesignations.filter((designation) => {
    const providerText = designation.provider_ids
      .map((providerId) => providerById.get(providerId))
      .filter(Boolean)
      .map((provider) => `${provider?.code} ${provider?.name}`)
      .join(" ");
    const modelText = (designation.model_ids ?? [])
      .map((modelId) => modelById.get(modelId))
      .filter(Boolean)
      .map((model) => `${model?.code} ${model?.name}`)
      .join(" ");
    const categoryText = normalizeDesignationCategories(designation.onboarding_categories).map((category) => categoryNameByCode.get(category) ?? designationCategoryLabel(category)).join(" ");
    const businessCategory = firstDesignationBusinessCategory(designation.designation_category);
    return `${designation.code} ${designation.name} ${providerText} ${modelText} ${categoryText} ${businessCategory?.name ?? "unassigned"} ${designationProfileDestinationLabel(designation.profile_destination)}`.toLowerCase().includes(query);
  });
  const editDesignation = scopedDesignations.find((designation) => designation.id === searchParams?.edit) ?? null;
  const createAction = createWorkforceDesignation;
  const updateAction = updateWorkforceDesignation;
  const deleteAction = deleteWorkforceDesignation;

  return (
    <AppShell active={scope.activeLabel} pageCode="designations">
      <PageHead
        eyebrow={scope.eyebrow}
        title={scope.title}
        subtitle={scope.subtitle}
        action={<span className={`status-pill ${isSupabaseAdminConfigured ? "good" : "warn"}`}>{isSupabaseAdminConfigured ? "Database connected" : "Database key missing"}</span>}
      />

      {error ? (
        <section className="panel message-panel error">
          <div className="panel-body">
            <strong>Database setup needed</strong>
            <p className="subtle" style={{ marginTop: 6 }}>
              {error} Run `scripts/designations_v1.sql` in Supabase SQL Editor, then refresh this page.
            </p>
          </div>
        </section>
      ) : null}

      {!error && (flash.error || flash.notice) ? (
        <section className={`panel message-panel ${flash.error ? "error" : "success"}`}>
          <div className="panel-body">
            <strong>{flash.error ? "Action required" : "Completed"}</strong>
            <p className="subtle" style={{ marginTop: 6 }}>{flash.error ?? flash.notice}</p>
          </div>
        </section>
      ) : null}

      {!error ? (
        <section className="panel designation-master-panel">
          <div className="panel-head toolbar">
            <div>
              <h2>Designation list</h2>
              <p className="subtle">{filteredDesignations.length} of {scopedDesignations.length} records</p>
            </div>
            <div className="master-toolbar">
              <form className="inline-search" action={scope.basePath}>
                <input className="field" defaultValue={searchParams?.q ?? ""} name="q" placeholder="Search designation or model" />
                <button className="button secondary compact" type="submit">Search</button>
                {query ? <PendingLink className="button secondary compact" href={scope.basePath}>Clear</PendingLink> : null}
              </form>
              {pagePermission.canAdd ? <PendingLink className="button compact" href={`${scope.basePath}?add=1`} scroll={false}>Add designation</PendingLink> : null}
            </div>
          </div>
          <div className="table-wrap">
            <table className="designation-master-table">
              <thead>
                <tr>
                  <th>Designation</th>
                  <th>Profile destination</th>
                  <th>Engagement</th>
                  <th>Coverage</th>
                  <th>Field ops</th>
                  <th>Status</th>
                  {pagePermission.canEdit ? <th>Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {filteredDesignations.length ? filteredDesignations.map((designation) => {
                  const designationModels = (designation.model_ids ?? [])
                    .map((modelId) => modelById.get(modelId))
                    .filter(Boolean) as ModelRow[];
                  return (
                    <tr key={designation.id}>
                      <td>
                        <div className="designation-name-cell">
                          <span>{designation.code}</span>
                          <strong>{designation.name}</strong>
                        </div>
                      </td>
                      <td>
                        <span className={`destination-badge ${designation.profile_destination ?? "unset"}`}>
                          {designationProfileDestinationLabel(designation.profile_destination)}
                        </span>
                      </td>
                      <td>
                        <div className="mini-chip-list">
                          {normalizeDesignationCategories(designation.onboarding_categories).slice(0, 1).map((category) => (
                            <span className="mini-tag" key={category}>{categoryNameByCode.get(category) ?? designationCategoryLabel(category)}</span>
                          ))}
                          {normalizeDesignationCategories(designation.onboarding_categories).length > 1
                            ? <span className="designation-more-count">+{normalizeDesignationCategories(designation.onboarding_categories).length - 1}</span>
                            : null}
                        </div>
                      </td>
                      <td>
                        <div className="designation-coverage-cell">
                          <span>{designationModels.length} model{designationModels.length === 1 ? "" : "s"}</span>
                          <span>{(designation.app_page_access ?? []).length} app page{(designation.app_page_access ?? []).length === 1 ? "" : "s"}</span>
                        </div>
                      </td>
                      <td><span className={`designation-boolean ${designation.is_field_operations ? "yes" : "no"}`}>{designation.is_field_operations ? "Yes" : "No"}</span></td>
                      <td><StatusPill status={designation.is_active ? "Active" : "Inactive"} /></td>
                      {pagePermission.canEdit ? <td><PendingLink className="button secondary compact" href={`${scope.basePath}?edit=${designation.id}`} scroll={false}>Edit</PendingLink></td> : null}
                    </tr>
                  );
                }) : (
                  <tr><td className="empty-cell" colSpan={pagePermission.canEdit ? 7 : 6}>No designations found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {!error && searchParams?.add === "1" && pagePermission.canAdd ? (
        <div className="modal-backdrop">
          <section className="modal-panel wide designation-modal">
            <div className="panel-head">
              <div>
                <h2>Add designation</h2>
                <p className="subtle">Select one or more models where this designation applies.</p>
              </div>
              <PendingLink className="icon-button" href={scope.basePath} scroll={false} aria-label="Close">x</PendingLink>
            </div>
            <DesignationForm action={createAction} businessCategories={scopedBusinessCategories} categories={categories} peopleModule={scope.peopleModule} roles={roles} models={models.map((model) => ({
              id: model.id,
              code: model.code,
              name: model.name,
              provider: (Array.isArray(model.providers) ? model.providers[0] : model.providers)?.name ?? null
            }))} />
          </section>
        </div>
      ) : null}

      {!error && editDesignation && pagePermission.canEdit ? (
        <div className="modal-backdrop">
          <section className="modal-panel wide designation-modal">
            <div className="panel-head">
              <div>
                <h2>Edit designation</h2>
                <p className="subtle">Code and model assignment can be changed without affecting old rows.</p>
              </div>
              <PendingLink className="icon-button" href={scope.basePath} scroll={false} aria-label="Close">x</PendingLink>
            </div>
            <DesignationForm action={updateAction} businessCategories={scopedBusinessCategories} categories={categories} initial={editDesignation} peopleModule={scope.peopleModule} roles={roles} models={models.map((model) => ({
              id: model.id,
              code: model.code,
              name: model.name,
              provider: (Array.isArray(model.providers) ? model.providers[0] : model.providers)?.name ?? null
            }))} submitLabel="Save changes" />
            <form action={deleteAction} className="danger-form">
              <input name="id" type="hidden" value={editDesignation.id} />
              <SubmitButton
                className="button warning"
                confirmMessage="Delete this designation?"
                confirmSubmitText="Delete"
                pendingText="Deleting"
              >
                Delete designation
              </SubmitButton>
            </form>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
