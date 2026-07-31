import { notFound, redirect } from "next/navigation";
import { createDynamicWorkforceProfile } from "@/app/people/category/[code]/actions";
import { AppShell } from "@/components/app-shell";
import { FieldExecutiveList, type FieldExecutiveListRow } from "@/components/field-executive-list";
import { PageHead } from "@/components/page-head";
import { ScopedDesignationFields } from "@/components/scoped-designation-fields";
import { SearchableSelect } from "@/components/searchable-select";
import { SubmitButton } from "@/components/submit-button";
import { getAuthorization, hasPermission, isCompanyOwner } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { countryCodeOptions } from "@/lib/country-codes";
import { dynamicWorkforceTable, isCustomWorkforceCategoryCode, normalizeWorkforceCategoryCode, singularCategoryLabel } from "@/lib/dynamic-workforce";
import { supabaseAdmin } from "@/lib/supabase-admin";

type CategoryRow = {
  code: string;
  name: string;
  statutory_enabled: boolean;
};

type LocationRow = {
  id: string;
  station_code: string;
  station_name: string | null;
  location_model_id: string | null;
  hide_from_location_list?: boolean | null;
  providers?: { name?: string } | Array<{ name?: string }> | null;
  location_models?: { code?: string; name?: string } | Array<{ code?: string; name?: string }> | null;
};

type DesignationRow = {
  id: string;
  code: string;
  name: string;
  model_ids: string[] | null;
  onboarding_categories: string[] | null;
};

type ProfileRow = {
  id: string;
  dropx_id: string | null;
  biometric_id: string | null;
  full_name: string;
  mobile_country_code: string | null;
  mobile: string;
  email: string;
  location_id: string;
  designation: string | null;
  is_active: boolean;
  onboarding_status: string | null;
  profile_photo_path?: string | null;
  stations?: LocationRow | LocationRow[] | null;
};

function first<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function canAccessPeople(authorization: NonNullable<Awaited<ReturnType<typeof getAuthorization>>>, action: "view" | "add") {
  if (isCompanyOwner(authorization)) return true;
  return ["employees", "delivery_associates", "contractors", "vendors", "workers"]
    .some((pageCode) => hasPermission(authorization, pageCode, action));
}

function statusLabel(row: Pick<ProfileRow, "is_active" | "onboarding_status">) {
  if (!row.is_active) return "Inactive";
  const value = String(row.onboarding_status ?? "pending").replaceAll("_", " ");
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const countryOptions = countryCodeOptions.map((country) => ({
  value: country.code,
  label: `+${country.code}`,
  helper: country.label.replace(/\s*\(\+\d+\)\s*$/, "")
}));

export const dynamic = "force-dynamic";

export default async function DynamicWorkforceCategoryPage({
  params,
  searchParams
}: {
  params: { code: string };
  searchParams?: Record<string, string | undefined>;
}) {
  const code = normalizeWorkforceCategoryCode(params.code);
  if (!isCustomWorkforceCategoryCode(code)) notFound();
  const authorization = await getAuthorization();
  if (!authorization) redirect("/login");
  if (!canAccessPeople(authorization, "view")) redirect("/unauthorized?page=onboard&action=access");
  const companyId = requireCompanyId(authorization);
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

  const categoryResult = await supabaseAdmin
    .from("workforce_categories")
    .select("code, name, statutory_enabled")
    .eq("company_id", companyId)
    .eq("code", code)
    .eq("is_active", true)
    .maybeSingle();
  if (categoryResult.error || !categoryResult.data) notFound();
  const category = categoryResult.data as CategoryRow;
  const provisionResult = await supabaseAdmin.rpc("provision_workforce_category_table", {
    p_category_code: code,
    p_company_id: companyId
  });

  const [locationsResult, designationsResult] = await Promise.all([
    supabaseAdmin
      .from("stations")
      .select("id, station_code, station_name, location_model_id, hide_from_location_list, providers (name), location_models (code, name)")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("station_code"),
    supabaseAdmin
      .from("designations")
      .select("id, code, name, model_ids, onboarding_categories")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("name")
  ]);
  const profileResult = provisionResult.error
    ? { data: [] as ProfileRow[], error: provisionResult.error }
    : await supabaseAdmin
      .from(dynamicWorkforceTable(code))
      .select("id, dropx_id, biometric_id, full_name, mobile_country_code, mobile, email, location_id, designation, is_active, onboarding_status, profile_photo_path, stations (station_code, station_name, providers (name), location_models (code, name))")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

  const rawLocations = (locationsResult.data ?? []) as unknown as LocationRow[];
  const locations = rawLocations.filter((location) => (
    !location.hide_from_location_list &&
    (authorization.hasAllLocationAccess || authorization.locationScopeIds.includes(location.id))
  ));
  const designations = ((designationsResult.data ?? []) as unknown as DesignationRow[])
    .filter((designation) => (designation.onboarding_categories ?? []).includes(code));
  const locationOptions = locations.map((location) => ({
    value: location.id,
    label: location.station_code,
    helper: first(location.providers)?.name || location.station_name || undefined,
    modelId: location.location_model_id
  }));
  const designationOptions = designations.map((designation) => ({
    value: designation.name,
    label: designation.name,
    helper: designation.code,
    modelIds: designation.model_ids ?? []
  }));
  const rows: FieldExecutiveListRow[] = ((profileResult.data ?? []) as unknown as ProfileRow[])
    .filter((profile) => authorization.hasAllLocationAccess || authorization.locationScopeIds.includes(profile.location_id))
    .map((profile) => {
      const location = first(profile.stations);
      const model = first(location?.location_models);
      return {
        id: profile.id,
        dropxId: profile.dropx_id ?? "-",
        biometricId: profile.biometric_id ?? "-",
        fullName: profile.full_name,
        mobile: `+${profile.mobile_country_code ?? "91"} ${profile.mobile}`,
        email: profile.email,
        location: location?.station_code ?? "-",
        provider: first(location?.providers)?.name ?? "-",
        model: model?.code ?? model?.name ?? "-",
        designation: profile.designation ?? "-",
        isActive: profile.is_active,
        status: statusLabel(profile)
      };
    });
  const entityLabel = singularCategoryLabel(category.name);
  const error = searchParams?.error ?? provisionResult.error?.message ?? locationsResult.error?.message ?? designationsResult.error?.message ?? profileResult.error?.message;

  return (
    <AppShell active={category.name}>
      <PageHead eyebrow="Workforce master" title={category.name} subtitle={`Register and maintain ${category.name.toLowerCase()} by location.`} />
      {error || searchParams?.notice ? (
        <section className={`panel message-panel ${error ? "error" : "success"}`}>
          <div className="panel-body">
            <strong>{error ? "Action required" : "Completed"}</strong>
            <p className="subtle" style={{ marginTop: 6 }}>
              {error ?? searchParams?.notice}
              {provisionResult.error ? " Run scripts/workforce_dynamic_category_tables_v1.sql in Supabase SQL Editor, then refresh." : ""}
            </p>
          </div>
        </section>
      ) : null}

      {canAccessPeople(authorization, "add") ? (
        <section className="panel">
          <div className="panel-head"><h2>{`Add ${entityLabel.toLowerCase()}`}</h2></div>
          <form action={createDynamicWorkforceProfile} className="form-grid three field-executive-add-form">
            <input name="category_code" type="hidden" value={code} />
            <label>Full name<input className="field" defaultValue={searchParams?.full_name ?? ""} name="full_name" placeholder="Enter full name" required /></label>
            <label className="field-executive-mobile-group">Mobile number
              <div className="field-executive-mobile-row">
                <div className="field-executive-country-code">
                  <SearchableSelect name="mobile_country_code" options={countryOptions} placeholder="+91" required value={searchParams?.mobile_country_code ?? "91"} />
                </div>
                <input className="field" defaultValue={searchParams?.mobile ?? ""} inputMode="numeric" name="mobile" placeholder="Enter mobile number" required />
              </div>
            </label>
            <label>Email<input className="field" defaultValue={searchParams?.email ?? ""} name="email" placeholder="Enter email" required type="email" /></label>
            <label>Date of join<input className="field" defaultValue={searchParams?.date_of_join ?? ""} name="date_of_join" required type="date" /></label>
            <ScopedDesignationFields
              designationName="designation"
              designationOptions={designationOptions}
              initialDesignation={searchParams?.designation}
              initialLocationId={searchParams?.location_id}
              locationName="location_id"
              locationOptions={locationOptions}
            />
            {category.statutory_enabled ? (
              <fieldset className="statutory-fieldset">
                <legend>Statutory applicability</legend>
                <label className="check-option"><input defaultChecked name="statutory_applicability" type="checkbox" value="not_applicable" /> Not Applicable</label>
                <label className="check-option"><input name="statutory_applicability" type="checkbox" value="pf" /> PF</label>
                <label className="check-option"><input name="statutory_applicability" type="checkbox" value="esi" /> ESI</label>
              </fieldset>
            ) : null}
            <div className="form-actions align-right field-executive-submit-slot dynamic-workforce-submit-slot">
              <SubmitButton disabled={Boolean(provisionResult.error) || !locationOptions.length || !designationOptions.length} disabledText={provisionResult.error ? "Database setup required" : !locationOptions.length ? "Add location first" : "Add designation first"}>
                Add profile
              </SubmitButton>
            </div>
          </form>
        </section>
      ) : null}

      <FieldExecutiveList canEdit={false} emptyLabel={`No ${category.name.toLowerCase()} added yet.`} rows={rows} showActions={false} title={`${category.name} register`} />
    </AppShell>
  );
}
