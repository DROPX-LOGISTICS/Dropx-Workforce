"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { syncBiometricEnrolment } from "@/lib/biometric/enrolments";
import { generateBiometricEnrolmentId } from "@/lib/biometric/ids";
import { requireCompanyId, withCompany } from "@/lib/company-scope";
import { cleanCountryCode } from "@/lib/country-codes";
import { supabaseAdmin } from "@/lib/supabase-admin";

function required(value: FormDataEntryValue | null, field: string) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${field} is required.`);
  return text;
}

function optional(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function employeesRedirect(params: { edit?: string; error?: string; notice?: string }): never {
  cookies().set("dropx_employees_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 30,
    path: "/employees",
    sameSite: "lax"
  });
  const query = params.edit ? `?edit=${encodeURIComponent(params.edit)}` : "";
  redirect(`/employees${query}`);
}

function isNextRedirectError(error: unknown) {
  return typeof (error as { digest?: unknown })?.digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT");
}

function normalizeStatutory(values: FormDataEntryValue[]) {
  const selected = values.map((value) => String(value)).filter((value) => ["not_applicable", "pf", "esi"].includes(value));
  if (!selected.length || selected.includes("not_applicable")) return ["not_applicable"];
  return Array.from(new Set(selected));
}

function generatedEmployeeCode() {
  return `EMP-${Date.now().toString(36).toUpperCase()}`;
}

export async function createEmployee(formData: FormData) {
  const authorization = await requirePagePermission("employees", "add");
  const companyId = requireCompanyId(authorization);
  if (!supabaseAdmin) employeesRedirect({ error: "Supabase service role key is not configured." });

  try {
    const autoGenerateEmployeeCode = formData.get("auto_generate_employee_code") === "yes";
    const employeeCode = autoGenerateEmployeeCode
      ? generatedEmployeeCode()
      : required(formData.get("employee_code"), "Employee ID").toUpperCase();
    const fullName = required(formData.get("full_name"), "Full name");
    const submittedBiometricId = optional(formData.get("biometric_id"))?.replace(/\D/g, "") ?? null;
    const biometricId = submittedBiometricId ?? await generateBiometricEnrolmentId(companyId);
    const mobileCountryCode = cleanCountryCode(formData.get("mobile_country_code"));
    const mobile = required(formData.get("mobile"), "Mobile number").replace(/\D/g, "");
    const email = optional(formData.get("email"))?.toLowerCase() ?? null;
    const dateOfJoin = required(formData.get("date_of_join"), "Date of join");
    const locationId = required(formData.get("location_id"), "Location");
    const designationId = required(formData.get("designation_id"), "Designation");
    const statutoryApplicability = normalizeStatutory(formData.getAll("statutory_applicability"));

    if (!/^\d{6,15}$/.test(mobile)) throw new Error("Mobile number must contain 6 to 15 digits.");
    if (biometricId && !/^\d{1,20}$/.test(biometricId)) throw new Error("Biometric enrolment ID must be numeric.");
    if (!/^[A-Z0-9_-]{2,32}$/.test(employeeCode)) throw new Error("Employee ID must contain 2 to 32 letters, numbers, underscore, or hyphen.");
    if (Number.isNaN(Date.parse(dateOfJoin))) throw new Error("Enter a valid date of join.");
    if (!authorization.hasAllLocationAccess && !authorization.locationScopeIds.includes(locationId)) {
      throw new Error("You do not have access to the selected location.");
    }

    const [locationResult, designationResult] = await Promise.all([
      supabaseAdmin.from("stations").select("id").eq("id", locationId).eq("company_id", companyId).maybeSingle(),
      supabaseAdmin.from("designations").select("id").eq("id", designationId).eq("company_id", companyId).eq("is_active", true).maybeSingle()
    ]);
    if (locationResult.error) throw new Error(locationResult.error.message);
    if (designationResult.error) throw new Error(designationResult.error.message);
    if (!locationResult.data) throw new Error("Selected location is not available for this company.");
    if (!designationResult.data) throw new Error("Selected designation is not available.");

    const { data: employee, error } = await supabaseAdmin.from("employees").insert(withCompany({
      employee_code: employeeCode,
      biometric_id: biometricId,
      full_name: fullName,
      mobile_country_code: mobileCountryCode,
      mobile,
      email,
      date_of_join: dateOfJoin,
      location_id: locationId,
      designation_id: designationId,
      statutory_applicability: statutoryApplicability,
      created_by: authorization.userId,
      profile_completion_status: "pending",
      is_active: true
    }, companyId)).select("id").single();
    if (error) {
      if (error.message.toLowerCase().includes("duplicate") || error.message.toLowerCase().includes("unique")) {
        throw new Error("Employee ID is already registered.");
      }
      throw new Error(error.message);
    }

    await syncBiometricEnrolment({
      companyId,
      createdBy: authorization.userId,
      effectiveFrom: dateOfJoin,
      employeeId: employee.id,
      enrolmentId: biometricId,
      isActive: true,
      locationId,
      workerType: "employee"
    });

    revalidatePath("/employees");
    employeesRedirect({ notice: "Employee added successfully." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    employeesRedirect({ error: error instanceof Error ? error.message : "Unable to add employee." });
  }
}

export async function updateEmployee(formData: FormData) {
  const authorization = await requirePagePermission("employees", "edit");
  const companyId = requireCompanyId(authorization);
  if (!supabaseAdmin) employeesRedirect({ error: "Supabase service role key is not configured." });

  try {
    const id = required(formData.get("id"), "Employee");
    const fullName = required(formData.get("full_name"), "Full name");
    const biometricId = optional(formData.get("biometric_id"))?.replace(/\D/g, "") ?? null;
    const mobileCountryCode = cleanCountryCode(formData.get("mobile_country_code"));
    const mobile = required(formData.get("mobile"), "Mobile number").replace(/\D/g, "");
    const email = optional(formData.get("email"))?.toLowerCase() ?? null;
    const dateOfJoin = required(formData.get("date_of_join"), "Date of join");
    const locationId = required(formData.get("location_id"), "Location");
    const designationId = required(formData.get("designation_id"), "Designation");
    const statutoryApplicability = normalizeStatutory(formData.getAll("statutory_applicability"));
    const isActive = optional(formData.get("is_active")) !== "false";

    if (!/^\d{6,15}$/.test(mobile)) throw new Error("Mobile number must contain 6 to 15 digits.");
    if (biometricId && !/^\d{1,20}$/.test(biometricId)) throw new Error("Biometric enrolment ID must be numeric.");
    if (Number.isNaN(Date.parse(dateOfJoin))) throw new Error("Enter a valid date of join.");
    if (!authorization.hasAllLocationAccess && !authorization.locationScopeIds.includes(locationId)) {
      throw new Error("You do not have access to the selected location.");
    }

    const [locationResult, designationResult] = await Promise.all([
      supabaseAdmin.from("stations").select("id").eq("id", locationId).eq("company_id", companyId).maybeSingle(),
      supabaseAdmin.from("designations").select("id").eq("id", designationId).eq("company_id", companyId).eq("is_active", true).maybeSingle()
    ]);
    if (locationResult.error) throw new Error(locationResult.error.message);
    if (designationResult.error) throw new Error(designationResult.error.message);
    if (!locationResult.data) throw new Error("Selected location is not available for this company.");
    if (!designationResult.data) throw new Error("Selected designation is not available.");

    const { error } = await supabaseAdmin.from("employees").update({
      biometric_id: biometricId,
      full_name: fullName,
      mobile_country_code: mobileCountryCode,
      mobile,
      email,
      date_of_join: dateOfJoin,
      location_id: locationId,
      designation_id: designationId,
      statutory_applicability: statutoryApplicability,
      is_active: isActive,
      updated_at: new Date().toISOString()
    }).eq("id", id).eq("company_id", companyId);
    if (error) throw new Error(error.message);

    await syncBiometricEnrolment({
      companyId,
      createdBy: authorization.userId,
      effectiveFrom: dateOfJoin,
      employeeId: id,
      enrolmentId: biometricId,
      isActive,
      locationId,
      workerType: "employee"
    });

    revalidatePath("/employees");
    employeesRedirect({ notice: "Employee updated successfully." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    employeesRedirect({ edit: String(formData.get("id") ?? ""), error: error instanceof Error ? error.message : "Unable to update employee." });
  }
}
