import { cookies } from "next/headers";
import { UserRound } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { EmployeeActionMenu } from "@/components/employee-action-menu";
import { EmployeeForm } from "@/components/employee-form";
import { PageHead } from "@/components/page-head";
import { PendingLink } from "@/components/pending-link";
import { StatusPill } from "@/components/status-pill";
import { SubmitButton } from "@/components/submit-button";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { normalizeDesignationCategories } from "@/lib/designation-categories";
import { normalizeProfileFieldRules } from "@/lib/profile-field-rules";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";
import { bulkImportEmployees, createEmployee, updateEmployee } from "./actions";

type LocationRow = {
  id: string;
  station_code: string;
  station_name: string | null;
  location_model_id?: string | null;
  hide_from_location_list?: boolean | null;
};

type DesignationRow = {
  id: string;
  code: string;
  name: string;
  model_ids?: string[] | null;
  onboarding_categories?: string[] | null;
  profile_field_rules?: unknown;
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
  location_id?: string | null;
  designation_id?: string | null;
  gender?: string | null;
  date_of_birth?: string | null;
  father_name?: string | null;
  blood_group?: string | null;
  address?: string | null;
  state_code?: string | null;
  pincode?: string | null;
  landmark?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_number?: string | null;
  emergency_contact_relation?: string | null;
  statutory_applicability: string[] | null;
  profile_completion_status?: string | null;
  profile_completed_at?: string | null;
  aadhaar_number?: string | null;
  pan_number?: string | null;
  bank_account_no?: string | null;
  ifsc?: string | null;
  pf_uan?: string | null;
  pf_account_no?: string | null;
  aadhaar_front_path?: string | null;
  aadhaar_back_path?: string | null;
  pan_upload_path?: string | null;
  profile_photo_path?: string | null;
  upload_urls?: Record<string, string>;
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

function displayValue(value: string | boolean | null | undefined) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value || "-";
}

function EmployeeDetail({ label, value }: { label: string; value: string | boolean | null | undefined }) {
  return (
    <div className="executive-detail-item">
      <dt>{label}</dt>
      <dd>{displayValue(value)}</dd>
    </div>
  );
}

function UploadDetail({ label, url }: { label: string; url?: string | null }) {
  return (
    <div className="executive-detail-item">
      <dt>{label}</dt>
      <dd>
        {url ? (
          <span className="inline-actions">
            <a className="button secondary compact" href={url} rel="noreferrer" target="_blank">View</a>
            <a className="button secondary compact" download href={url}>Download</a>
          </span>
        ) : "-"}
      </dd>
    </div>
  );
}

function EmployeeDetails({ employee }: { employee: EmployeeRow }) {
  const location = firstRelation(employee.stations);
  const designation = firstRelation(employee.designations);
  return (
    <div className="executive-details">
      <section>
        <h3>Employment</h3>
        <dl className="executive-detail-grid">
          <EmployeeDetail label="Employee ID" value={employee.employee_code} />
          <EmployeeDetail label="Full name" value={employee.full_name} />
          <EmployeeDetail label="Biometric ID" value={employee.biometric_id} />
          <EmployeeDetail label="Date of join" value={employee.date_of_join} />
          <EmployeeDetail label="Location" value={location?.station_name || location?.station_code} />
          <EmployeeDetail label="Designation" value={designation?.name} />
          <EmployeeDetail label="Statutory" value={statutoryLabel(employee.statutory_applicability)} />
          <EmployeeDetail label="PF UAN" value={employee.pf_uan} />
          <EmployeeDetail label="PF Account No" value={employee.pf_account_no} />
          <EmployeeDetail label="Status" value={employeeStatus(employee)} />
        </dl>
      </section>
      <section>
        <h3>Personal and contact</h3>
        <dl className="executive-detail-grid">
          <EmployeeDetail label="Mobile" value={`+${employee.mobile_country_code ?? "91"} ${employee.mobile}`} />
          <EmployeeDetail label="Email" value={employee.email} />
          <EmployeeDetail label="Gender" value={employee.gender} />
          <EmployeeDetail label="Date of birth" value={employee.date_of_birth} />
          <EmployeeDetail label="Father name" value={employee.father_name} />
          <EmployeeDetail label="Blood group" value={employee.blood_group} />
        </dl>
      </section>
      <section>
        <h3>Emergency contact</h3>
        <dl className="executive-detail-grid">
          <EmployeeDetail label="Contact number" value={employee.emergency_contact_number} />
          <EmployeeDetail label="Contact name" value={employee.emergency_contact_name} />
          <EmployeeDetail label="Relation" value={employee.emergency_contact_relation} />
        </dl>
      </section>
      <section>
        <h3>Identity and address</h3>
        <dl className="executive-detail-grid">
          <EmployeeDetail label="Aadhaar number" value={employee.aadhaar_number} />
          <EmployeeDetail label="PAN number" value={employee.pan_number} />
          <EmployeeDetail label="Address" value={employee.address} />
          <EmployeeDetail label="State" value={employee.state_code} />
          <EmployeeDetail label="Postal PIN" value={employee.pincode} />
          <EmployeeDetail label="Landmark" value={employee.landmark} />
        </dl>
      </section>
      <section>
        <h3>Bank</h3>
        <dl className="executive-detail-grid">
          <EmployeeDetail label="Bank account number" value={employee.bank_account_no} />
          <EmployeeDetail label="IFSC" value={employee.ifsc} />
        </dl>
      </section>
      <section>
        <h3>Uploads</h3>
        <dl className="executive-detail-grid">
          <UploadDetail label="Aadhaar front" url={employee.upload_urls?.aadhaarFront} />
          <UploadDetail label="Aadhaar back" url={employee.upload_urls?.aadhaarBack} />
          <UploadDetail label="PAN upload" url={employee.upload_urls?.pan} />
          <UploadDetail label="Profile photo" url={employee.upload_urls?.profilePhoto} />
        </dl>
      </section>
    </div>
  );
}

function EmployeeBulkImportPanel() {
  return (
    <section className="panel workforce-bulk-panel">
      <div className="panel-head">
        <div>
          <h2>Bulk upload employees</h2>
          <p className="subtle">Upload existing employee rows and keep the profile completion pending for the app.</p>
        </div>
      </div>
      <form action={bulkImportEmployees} className="workforce-bulk-form">
        <div className="workforce-template-note">
          <strong>Excel columns</strong>
          <span>DropX ID, Biometric ID, Full name, Mob country code, Mob no, Email, Date of join (DD/MM/YYYY), Location, Designation code, Statutory applicability</span>
        </div>
        <input accept=".xlsx,.xls,.csv" className="field" name="bulk_file" required type="file" />
        <SubmitButton
          confirmCancelText="No"
          confirmDescription="This will create pending employee profiles from the uploaded file."
          confirmMessage="Import employees from this file?"
          confirmSubmitText="Yes"
          confirmTitle="Confirm bulk upload"
        >
          Upload employees
        </SubmitButton>
      </form>
    </section>
  );
}

async function signedDocumentUrl(path: string | null | undefined) {
  if (!supabaseAdmin || !path) return "";
  const result = await supabaseAdmin.storage
    .from("employee-profile-documents")
    .createSignedUrl(path, 60 * 60);
  return result.data?.signedUrl ?? "";
}

async function loadEmployees(companyId: string, locationScopeIds: string[], hasAllLocationAccess: boolean, editId?: string, viewId?: string) {
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
      .select("id, employee_code, biometric_id, full_name, mobile_country_code, mobile, email, date_of_join, location_id, designation_id, statutory_applicability, profile_completion_status, profile_completed_at, gender, date_of_birth, aadhaar_number, pan_number, father_name, blood_group, address, state_code, pincode, landmark, emergency_contact_name, emergency_contact_number, emergency_contact_relation, bank_account_no, ifsc, pf_uan, pf_account_no, aadhaar_front_path, aadhaar_back_path, pan_upload_path, profile_photo_path, is_active, stations (station_code, station_name), designations (code, name)")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("stations")
      .select("id, station_code, station_name, location_model_id, hide_from_location_list")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("station_code"),
    supabaseAdmin
      .from("designations")
      .select("id, code, name, model_ids, onboarding_categories, profile_field_rules, is_active")
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
  let designationRows = designationsResult.data ?? [];
  let designationError = designationsResult.error;
  if (isMissingColumnError(designationsResult.error)) {
    const fallbackDesignationsResult = await supabaseAdmin
      .from("designations")
      .select("id, code, name, is_active")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("name");
    designationRows = (fallbackDesignationsResult.data ?? []).map((designation) => ({ ...designation, model_ids: [], onboarding_categories: ["employees"], profile_field_rules: {} }));
    designationError = fallbackDesignationsResult.error;
  }

  if (designationError) {
    return { employees: [], locations: [], designations: [], error: designationError.message };
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

  const employeesWithUrls = await Promise.all((employees as EmployeeRow[]).map(async (employee) => ({
    ...employee,
    upload_urls: {
      aadhaarFront: await signedDocumentUrl(employee.aadhaar_front_path),
      aadhaarBack: await signedDocumentUrl(employee.aadhaar_back_path),
      pan: await signedDocumentUrl(employee.pan_upload_path),
      profilePhoto: await signedDocumentUrl(employee.profile_photo_path)
    }
  })));

  return {
    employees: employeesWithUrls,
    editEmployee: editId ? employeesWithUrls.find((employee) => employee.id === editId) ?? null : null,
    viewEmployee: viewId ? employeesWithUrls.find((employee) => employee.id === viewId) ?? null : null,
    locations: allowedLocations as LocationRow[],
    designations: (designationRows as DesignationRow[])
      .filter((designation) => normalizeDesignationCategories(designation.onboarding_categories).includes("employees")),
    error: null
  };
}

export const dynamic = "force-dynamic";

export default async function EmployeesPage({ searchParams }: { searchParams?: { edit?: string; view?: string } }) {
  const authorization = await requirePagePermission("employees", "access");
  const companyId = requireCompanyId(authorization);
  const pagePermission = authorization.permissions.employees;
  const { employees, editEmployee, locations, designations, error, viewEmployee } = await loadEmployees(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess, searchParams?.edit, searchParams?.view);
  const flash = loadFlash();
  const locationOptions = locations.map((location) => ({
    value: location.id,
    label: location.station_code,
    helper: location.station_name ?? undefined,
    modelId: location.location_model_id ?? null
  }));
  const designationOptions = designations.map((designation) => ({
    value: designation.id,
    label: designation.name,
    helper: designation.code,
    modelIds: designation.model_ids ?? [],
    dashboardRules: normalizeProfileFieldRules(designation.profile_field_rules).employees.dashboard
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

      {!error && pagePermission.canAdd ? <EmployeeBulkImportPanel /> : null}

      {!error && pagePermission.canView ? (
        <section className="panel">
          <div className="panel-head toolbar">
            <div>
              <h2>Employee register</h2>
              <p className="subtle">{employees.length} records</p>
            </div>
          </div>
          <div className="table-wrap field-executive-table-wrap employee-table-wrap">
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
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {employees.length ? employees.map((employee) => {
                  const location = firstRelation(employee.stations);
                  const designation = firstRelation(employee.designations);
                  return (
                    <tr key={employee.id}>
                      <td>
                        <div className="executive-name-cell">
                          <span className="executive-avatar" aria-hidden="true">
                            {employee.upload_urls?.profilePhoto ? <img alt="" src={employee.upload_urls.profilePhoto} /> : <UserRound size={17} />}
                          </span>
                          <strong>{employee.employee_code ?? "-"}</strong>
                        </div>
                      </td>
                      <td><strong>{employee.full_name}</strong></td>
                      <td>{employee.biometric_id ?? "-"}</td>
                      <td>+{employee.mobile_country_code ?? "91"} {employee.mobile}</td>
                      <td>{employee.email || "-"}</td>
                      <td>{employee.date_of_join}</td>
                      <td>{location?.station_code ?? "-"}</td>
                      <td>{designation?.name ?? "-"}</td>
                      <td>{statutoryLabel(employee.statutory_applicability)}</td>
                      <td><StatusPill status={employeeStatus(employee)} /></td>
                      <td className="action-cell">
                        <EmployeeActionMenu canEdit={pagePermission.canEdit} employeeId={employee.id} fullName={employee.full_name} />
                      </td>
                    </tr>
                  );
                }) : (
                  <tr><td className="empty-cell" colSpan={11}>No employees added yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {!error && pagePermission.canView && viewEmployee ? (
        <div className="modal-backdrop">
          <section className="modal-panel wide" aria-label="View employee">
            <div className="panel-head">
              <div>
                <h2>{viewEmployee.full_name}</h2>
                <p className="subtle">Complete Employee profile</p>
              </div>
              <PendingLink className="icon-button" href="/employees" scroll={false} aria-label="Close employee details">x</PendingLink>
            </div>
            <EmployeeDetails employee={viewEmployee} />
          </section>
        </div>
      ) : null}

      {!error && pagePermission.canEdit && editEmployee ? (
        <div className="modal-backdrop">
          <section className="modal-panel wide" aria-label="Edit employee">
            <div className="panel-head">
              <div>
                <h2>Edit employee</h2>
                <p className="subtle">Maintain employee registration details.</p>
              </div>
              <PendingLink className="icon-button" href="/employees" scroll={false} aria-label="Close edit employee">x</PendingLink>
            </div>
            <EmployeeForm action={updateEmployee} designationOptions={designationOptions} employee={editEmployee} locationOptions={locationOptions} mode="edit" />
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
