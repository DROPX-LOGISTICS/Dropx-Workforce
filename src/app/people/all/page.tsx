import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { StatusPill } from "@/components/status-pill";
import { getAuthorization, hasPermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { dynamicWorkforceTable, isCustomWorkforceCategoryCode } from "@/lib/dynamic-workforce";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { redirect } from "next/navigation";

type PersonRow = {
  category: string;
  categoryCode: string;
  code: string;
  biometricId: string;
  fullName: string;
  mobile: string;
  email: string;
  location: string;
  designation: string;
  status: string;
};

const sources = [
  { categoryCode: "employees", category: "Employees", pageCode: "employees", table: "employees", codeField: "employee_code", statusField: "profile_completion_status", employeeDesignation: true },
  { categoryCode: "field_executives", category: "Field Executives", pageCode: "delivery_associates", table: "field_executives", codeField: "dropx_id", statusField: "onboarding_status", employeeDesignation: false },
  { categoryCode: "contractors", category: "Independent Contractor", pageCode: "contractors", table: "contractors", codeField: "dropx_id", statusField: "onboarding_status", employeeDesignation: false },
  { categoryCode: "vendors", category: "Vendors", pageCode: "vendors", table: "vendors", codeField: "dropx_id", statusField: "onboarding_status", employeeDesignation: false },
  { categoryCode: "workers", category: "Workers", pageCode: "workers", table: "workers", codeField: "dropx_id", statusField: "onboarding_status", employeeDesignation: false }
] as const;

function first<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function displayStatus(value: unknown, active: boolean) {
  if (!active) return "Inactive";
  const text = String(value ?? "pending").replaceAll("_", " ");
  return text.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function loadPeople(
  companyId: string,
  allowedSources: Array<(typeof sources)[number]>,
  locationScopeIds: string[],
  hasAllLocationAccess: boolean
) {
  if (!supabaseAdmin) {
    return {
      categories: [] as Array<{ code: string; name: string }>,
      rows: [] as PersonRow[],
      error: "Supabase service role key is not configured."
    };
  }
  const categoryResult = await supabaseAdmin
    .from("workforce_categories")
    .select("code, name")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("sort_order")
    .order("name");
  const categories = (categoryResult.data ?? []) as Array<{ code: string; name: string }>;
  const customSources = categories
    .filter((category) => isCustomWorkforceCategoryCode(category.code))
    .map((category) => ({
      categoryCode: category.code,
      category: category.name,
      table: dynamicWorkforceTable(category.code),
      codeField: "dropx_id",
      statusField: "onboarding_status"
    }));
  const results = await Promise.all(allowedSources.map(async (source) => {
    const designationFields = source.employeeDesignation ? ", designations (name)" : ", designation";
    const result = await supabaseAdmin!
      .from(source.table)
      .select(`full_name, mobile_country_code, mobile, email, biometric_id, location_id, is_active, ${source.codeField}, ${source.statusField}, stations (station_code)${designationFields}`)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (result.error) return { rows: [] as PersonRow[], error: result.error.message };
    return {
      error: null,
      rows: (result.data ?? [])
        .filter((row: Record<string, unknown>) => hasAllLocationAccess || locationScopeIds.includes(String(row.location_id ?? "")))
        .map((row: Record<string, unknown>) => ({
        category: source.category,
        categoryCode: source.categoryCode,
        code: String(row[source.codeField] ?? "-"),
        biometricId: String(row.biometric_id ?? "-"),
        fullName: String(row.full_name ?? "-"),
        mobile: `+${String(row.mobile_country_code ?? "91")} ${String(row.mobile ?? "")}`,
        email: String(row.email ?? "-"),
        location: String((first(row.stations as { station_code?: string } | Array<{ station_code?: string }> | null) ?? {}).station_code ?? "-"),
        designation: String(
          row.designation ??
          (first(row.designations as { name?: string } | Array<{ name?: string }> | null) ?? {}).name ??
          "-"
        ),
        status: displayStatus(row[source.statusField], row.is_active !== false)
      }))
    };
  }));
  const customResults = await Promise.all(customSources.map(async (source) => {
    const result = await supabaseAdmin!
      .from(source.table)
      .select("full_name, mobile_country_code, mobile, email, biometric_id, location_id, is_active, dropx_id, onboarding_status, stations (station_code), designation")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (result.error) return { rows: [] as PersonRow[], error: result.error.message };
    return {
      error: null,
      rows: (result.data ?? [])
        .filter((row: Record<string, unknown>) => hasAllLocationAccess || locationScopeIds.includes(String(row.location_id ?? "")))
        .map((row: Record<string, unknown>) => ({
          category: source.category,
          categoryCode: source.categoryCode,
          code: String(row[source.codeField] ?? "-"),
          biometricId: String(row.biometric_id ?? "-"),
          fullName: String(row.full_name ?? "-"),
          mobile: `+${String(row.mobile_country_code ?? "91")} ${String(row.mobile ?? "")}`,
          email: String(row.email ?? "-"),
          location: String((first(row.stations as { station_code?: string } | Array<{ station_code?: string }> | null) ?? {}).station_code ?? "-"),
          designation: String(row.designation ?? "-"),
          status: displayStatus(row[source.statusField], row.is_active !== false)
        }))
    };
  }));
  const allResults = [...results, ...customResults];
  return {
    categories,
    rows: allResults.flatMap((result) => result.rows),
    error: categoryResult.error?.message ?? allResults.find((result) => result.error)?.error ?? null
  };
}

export const dynamic = "force-dynamic";

export default async function AllPeoplePage({
  searchParams
}: {
  searchParams?: { category?: string; q?: string; status?: string };
}) {
  const authorization = await getAuthorization();
  if (!authorization) redirect("/login");
  const allowedSources = sources.filter((source) => hasPermission(authorization, source.pageCode, "access"));
  if (!allowedSources.length) redirect("/unauthorized?page=people&action=access");
  const companyId = requireCompanyId(authorization);
  const data = await loadPeople(
    companyId,
    allowedSources,
    authorization.locationScopeIds,
    authorization.hasAllLocationAccess
  );
  const query = String(searchParams?.q ?? "").trim().toLowerCase();
  const category = String(searchParams?.category ?? "").trim();
  const status = String(searchParams?.status ?? "").trim().toLowerCase();
  const rows = data.rows.filter((row) => {
    if (category && row.categoryCode !== category) return false;
    if (status && row.status.toLowerCase() !== status) return false;
    return !query || `${row.code} ${row.biometricId} ${row.fullName} ${row.mobile} ${row.email} ${row.location} ${row.designation}`.toLowerCase().includes(query);
  });

  return (
    <AppShell active="All People">
      <PageHead eyebrow="People" title="All People" subtitle="View every workforce category in one consolidated register." />
      {data.error ? (
        <section className="panel message-panel error"><div className="panel-body"><strong>Unable to load people</strong><p className="subtle">{data.error}</p></div></section>
      ) : null}
      <section className="panel">
        <div className="panel-head toolbar">
          <div><h2>People register</h2><p className="subtle">{rows.length} records</p></div>
          <form className="master-toolbar">
            <input className="field" defaultValue={searchParams?.q ?? ""} name="q" placeholder="Search ID, name, mobile, email" />
            <select className="field" defaultValue={category} name="category">
              <option value="">All categories</option>
              {data.categories.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
            </select>
            <select className="field" defaultValue={status} name="status">
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="under review">Under Review</option>
              <option value="returned">Returned</option>
              <option value="inactive">Inactive</option>
            </select>
            <button className="button secondary compact" type="submit">Filter</button>
          </form>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>DropX ID</th><th>Biometric ID</th><th>Full name</th><th>Category</th><th>Mobile</th><th>Email</th><th>Location</th><th>Designation</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.category}:${row.code}`}>
                  <td><strong>{row.code}</strong></td><td>{row.biometricId}</td><td><strong>{row.fullName}</strong></td>
                  <td>{row.category}</td><td>{row.mobile}</td><td>{row.email}</td><td>{row.location}</td><td>{row.designation}</td>
                  <td><StatusPill status={row.status} /></td>
                </tr>
              ))}
              {!rows.length ? <tr><td className="empty-cell" colSpan={9}>No people match the selected filters.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
