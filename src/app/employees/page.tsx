import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { EmployeeForm } from "@/components/employee-form";
import { PageHead } from "@/components/page-head";
import { StatusPill } from "@/components/status-pill";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";
import { createEmployee } from "./actions";

type LocationRow = {
  id: string;
  station_code: string;
  station_name: string | null;
  hide_from_location_list?: boolean | null;
};

type DesignationRow = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

type EmployeeRow = {
  id: string;
  employee_code: string | null;
  biometric_id?: string | null;
  full_name: string;
  mobile_country_code: string | null;
  mobile: string;
  email: string | null;
  date_of_join: string;
  statutory_applicability: string[] | null;
  profile_completion_status?: string | null;
  profile_completed_at?: string | null;
  aadhaar_number?: string | null;
  pan_number?: string | null;
  bank_account_no?: string | null;
  ifsc?: string | null;
  aadhaar_front_path?: string | null;
  aadhaar_back_path?: string | null;
  pan_upload_path?: string | null;
  profile_photo_path?: string | null;
  is_active: boolean;
  stations?: { station_code: string; station_name: string | null } | { station_code: string; station_name: string | null }[] | null;
  designations?: { code: string; name: string } | { code: string; name: string }[] | null;
};

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function loadFlash() {
  const raw = cookies().get("dropx_employees_flash")?.value;
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

function statutoryLabel(values: string[] | null | undefined) {
  const labels = new Map([
    ["not_applicable", "Not Applicable"],
    ["pf", "PF"],
    ["esi", "ESI"]
  ]);
  const selected = values?.length ? values : ["not_applicable"];
  return selected.map((value) => labels.get(value) ?? value).join(", ");
}

function employeeStatus(employee: EmployeeRow) {
  if (!employee.is_active) return "Inactive";
  if (employee.profile_completion_status === "active") return "Active";
  if (employee.profile_completion_status === "submitted") return "Submitted";
  if (employee.profile_completion_status === "rejected") return "Rejected";
  const hasCompletedProfile = [
    employee.aadhaar_number,
    employee.pan_number,
    employee.bank_account_no,
    employee.ifsc,
    employee.aadhaar_front_path,
    employee.aadhaar_back_path,
    employee.pan_upload_path,
    employee.profile_photo_path
  ].every((value) => String(value ?? "").trim().length > 0);
  if (employee.profile_completion_status === "active" && employee.profile_completed_at && hasCompletedProfile) return "Active";
  return "Pending";
}

function isMissingColumnError(error: unknown) {
  const message = String((error as { message?: unknown })?.message ?? "").toLowerCase();
  return message.includes("column") && (message.includes("does not exist") || message.includes("schema cache"));
}

async function loadEmployees(companyId: string, locationScopeIds: string[], hasAllLocationAccess: boolean) {
  if (!supabaseAdmin) {
    return {
      employees: [] as EmployeeRow[],
      locations: [] as LocationRow[],
      designations: [] as DesignationRow[],
      error: "Supabase service role key is not configured."
    };
  }

  const [initialEmployeesResult, locationsResult, designationsResult] = await Promise.all([
    supabaseAdmin
      .from("employees")
      .select("id, employee_code, biometric_id, full_name, mobile_country_code, mobile, email, date_of_join, statutory_applicability, profile_completion_status, profile_completed_at, aadhaar_number, pan_number, bank_account_no, ifsc, aadhaar_front_path, aadhaar_back_path, pan_upload_path, profile_photo_path, is_active, stations (station_code, station_name), designations (code, name)")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("stations")
      .select("id, station_code, station_name, hide_from_location_list")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("station_code"),
    supabaseAdmin
      .from("designations")
      .select("id, code, name, is_active")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("name")
  ]);
  let employeesResult = initialEmployeesResult;
  if (isMissingColumnError(initialEmployeesResult.error)) {
    const fallbackEmployeesResult = await supabaseAdmin
      .from("employees")
      .select("id, employee_code, full_name, mobile_country_code, mobile, email, date_of_join, statutory_applicability, is_active, stations (station_code, station_name), designations (code, name)")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    employeesResult = {
      ...fallbackEmployeesResult,
      data: (fallbackEmployeesResult.data ?? []).map((employee) => ({ ...employee, profile_completion_status: "pending", profile_completed_at: null }))
    } as typeof initialEmployeesResult;
  }

  if (employeesResult.error) {
    return { employees: [], locations: [], designations: [], error: employeesResult.error.message };
  }
  if (locationsResult.error) {
    return { employees: [], locations: [], designations: [], error: locationsResult.error.message };
  }
  if (designationsResult.error) {
    return { employees: [], locations: [], designations: [], error: designationsResult.error.message };
  }

  const allowedLocations = hasAllLocationAccess
    ? (locationsResult.data ?? [])
    : (locationsResult.data ?? []).filter((location) => locationScopeIds.includes(location.id) && !location.hide_from_location_list);
  const allowedCodes = new Set(allowedLocations.map((location) => location.station_code));
  const employees = hasAllLocationAccess
    ? (employeesResult.data ?? [])
    : (employeesResult.data ?? []).filter((employee) => {
      const location = firstRelation(employee.stations);
      return location?.station_code ? allowedCodes.has(location.station_code) : false;
    });

  return {
    employees: employees as EmployeeRow[],
    locations: allowedLocations as LocationRow[],
    designations: (designationsResult.data ?? []) as DesignationRow[],
    error: null
  };
}

export const dynamic = "force-dynamic";

export default async function EmployeesPage() {
  const authorization = await requirePagePermission("employees", "access");
  const companyId = requireCompanyId(authorization);
  const pagePermission = authorization.permissions.employees;
  const { employees, locations, designations, error } = await loadEmployees(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess);
  const flash = loadFlash();
  const locationOptions = locations.map((location) => ({
    value: location.id,
    label: location.station_code,
    helper: location.station_name ?? undefined
  }));
  const designationOptions = designations.map((designation) => ({
    value: designation.id,
    label: designation.name,
    helper: designation.code
  }));

  return (
    <AppShell active="Employees" pageCode="employees">
      <PageHead
        eyebrow="Workforce Master"
        title="Employees"
        subtitle="Register and maintain employees by location."
        action={<span className={`status-pill ${isSupabaseAdminConfigured ? "good" : "warn"}`}>{isSupabaseAdminConfigured ? "Database connected" : "Database key missing"}</span>}
      />

      {error ? (
        <section className="panel message-panel error">
          <div className="panel-body">
            <strong>Database setup needed</strong>
            <p className="subtle" style={{ marginTop: 6 }}>
              {error} Run `scripts/employees_v1.sql` in Supabase SQL Editor, then refresh this page.
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

      {!error && pagePermission.canAdd ? (
        <section className="panel">
          <div className="panel-head"><h2>Add employee</h2></div>
          <EmployeeForm action={createEmployee} designationOptions={designationOptions} locationOptions={locationOptions} />
        </section>
      ) : null}

      {!error && pagePermission.canView ? (
        <section className="panel">
          <div className="panel-head toolbar">
            <div>
              <h2>Employee register</h2>
              <p className="subtle">{employees.length} records</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Emp ID</th>
                  <th>Full name</th>
                  <th>Biometric ID</th>
                  <th>Mobile</th>
                  <th>Email</th>
                  <th>Date of join</th>
                  <th>Location</th>
                  <th>Designation</th>
                  <th>Statutory</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {employees.length ? employees.map((employee) => {
                  const location = firstRelation(employee.stations);
                  const designation = firstRelation(employee.designations);
                  return (
                    <tr key={employee.id}>
                      <td><strong>{employee.employee_code ?? "-"}</strong></td>
                      <td><strong>{employee.full_name}</strong></td>
                      <td>{employee.biometric_id ?? "-"}</td>
                      <td>+{employee.mobile_country_code ?? "91"} {employee.mobile}</td>
                      <td>{employee.email || "-"}</td>
                      <td>{employee.date_of_join}</td>
                      <td>{location?.station_code ?? "-"}</td>
                      <td>{designation?.name ?? "-"}</td>
                      <td>{statutoryLabel(employee.statutory_applicability)}</td>
                      <td><StatusPill status={employeeStatus(employee)} /></td>
                    </tr>
                  );
                }) : (
                  <tr><td className="empty-cell" colSpan={10}>No employees added yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </AppShell>
  );
}
