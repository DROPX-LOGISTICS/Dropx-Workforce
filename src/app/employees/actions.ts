"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as XLSX from "xlsx";
import { waitUntil } from "@vercel/functions";
import { requirePagePermission } from "@/lib/authorization";
import { syncBiometricEnrolment } from "@/lib/biometric/enrolments";
import { generateBiometricEnrolmentId } from "@/lib/biometric/ids";
import { requireCompanyId, withCompany } from "@/lib/company-scope";
import { cleanCountryCode } from "@/lib/country-codes";
import { generateConfiguredBiometricId, generateConfiguredWorkerId } from "@/lib/dropx-id-generation";
import { moveProfileDocumentToTrash, uploadProfileDocument } from "@/lib/profile-document-storage";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendEmployeeOnboardingWhatsApp } from "@/lib/whatsapp";

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

type BulkImportRow = {
  dropxId: string | null;
  biometricId: string | null;
  fullName: string;
  mobileCountryCode: string;
  mobile: string;
  email: string | null;
  dateOfJoin: string;
  locationCode: string;
  designationCode: string;
  statutoryApplicability: string[];
};

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

const employeeDocumentFields = [
  { formKey: "aadhaar_front_file", pathKey: "aadhaar_front_path", label: "Aadhaar front" },
  { formKey: "aadhaar_back_file", pathKey: "aadhaar_back_path", label: "Aadhaar back" },
  { formKey: "pan_upload_file", pathKey: "pan_upload_path", label: "PAN upload" },
  { formKey: "profile_photo_file", pathKey: "profile_photo_path", label: "Profile photo" }
] as const;

export async function createEmployee(formData: FormData) {
  const authorization = await requirePagePermission("employees", "add");
  const companyId = requireCompanyId(authorization);
  if (!supabaseAdmin) employeesRedirect({ error: "Supabase service role key is not configured." });

  try {
    const fullName = required(formData.get("full_name"), "Full name");
    const mobileCountryCode = cleanCountryCode(formData.get("mobile_country_code"));
    const mobile = required(formData.get("mobile"), "Mobile number").replace(/\D/g, "");
    const email = optional(formData.get("email"))?.toLowerCase() ?? null;
    const dateOfJoin = required(formData.get("date_of_join"), "Date of join");
    const locationId = required(formData.get("location_id"), "Location");
    const designationId = required(formData.get("designation_id"), "Designation");
    const statutoryApplicability = normalizeStatutory(formData.getAll("statutory_applicability"));

    if (!/^\d{6,15}$/.test(mobile)) throw new Error("Mobile number must contain 6 to 15 digits.");
    if (Number.isNaN(Date.parse(dateOfJoin))) throw new Error("Enter a valid date of join.");
    if (!authorization.hasAllLocationAccess && !authorization.locationScopeIds.includes(locationId)) {
      throw new Error("You do not have access to the selected location.");
    }

    const [locationResult, designationResult] = await Promise.all([
      supabaseAdmin.from("stations").select("id, station_code, station_name").eq("id", locationId).eq("company_id", companyId).maybeSingle(),
      supabaseAdmin.from("designations").select("id, name").eq("id", designationId).eq("company_id", companyId).eq("is_active", true).maybeSingle()
    ]);
    if (locationResult.error) throw new Error(locationResult.error.message);
    if (designationResult.error) throw new Error(designationResult.error.message);
    if (!locationResult.data) throw new Error("Selected location is not available for this company.");
    if (!designationResult.data) throw new Error("Selected designation is not available.");
    const biometricId = await generateConfiguredBiometricId({
      category: "employee",
      companyId,
      designationId,
      fallback: () => generateBiometricEnrolmentId(companyId),
      locationId
    });
    if (biometricId && !/^\d{1,20}$/.test(biometricId)) throw new Error("Biometric enrolment ID must be numeric.");
    const employeeCode = await generateConfiguredWorkerId({
      category: "employee",
      companyId,
      designationId,
      fallback: generatedEmployeeCode,
      locationId
    });
    if (!/^[A-Z0-9_-]{2,32}$/.test(employeeCode)) throw new Error("Employee ID must contain 2 to 32 letters, numbers, underscore, or hyphen.");

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

    waitUntil(sendEmployeeOnboardingWhatsApp({
      companyId,
      employeeId: employee.id,
      fullName,
      mobile,
      dropxId: employeeCode,
      dateOfJoin,
      locationCode: locationResult.data.station_code ?? "",
      locationName: locationResult.data.station_name ?? "",
      providerName: designationResult.data.name ?? "Employee",
      triggeredBy: authorization.userId
    }));

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
    const mobileCountryCode = cleanCountryCode(formData.get("mobile_country_code"));
    const mobile = required(formData.get("mobile"), "Mobile number").replace(/\D/g, "");
    const email = optional(formData.get("email"))?.toLowerCase() ?? null;
    const dateOfJoin = required(formData.get("date_of_join"), "Date of join");
    const locationId = required(formData.get("location_id"), "Location");
    const designationId = required(formData.get("designation_id"), "Designation");
    const statutoryApplicability = normalizeStatutory(formData.getAll("statutory_applicability"));
    const isActive = optional(formData.get("is_active")) !== "false";
    const extraPayload = {
      gender: optional(formData.get("gender")),
      date_of_birth: optional(formData.get("date_of_birth")),
      father_name: optional(formData.get("father_name")),
      blood_group: optional(formData.get("blood_group")),
      aadhaar_number: optional(formData.get("aadhaar_number"))?.replace(/\D/g, "") ?? null,
      pan_number: optional(formData.get("pan_number"))?.toUpperCase() ?? null,
      address: optional(formData.get("address")),
      state_code: optional(formData.get("state_code"))?.toUpperCase() ?? null,
      pincode: optional(formData.get("pincode"))?.replace(/\D/g, "") ?? null,
      landmark: optional(formData.get("landmark")),
      emergency_contact_name: optional(formData.get("emergency_contact_name")),
      emergency_contact_number: optional(formData.get("emergency_contact_number"))?.replace(/\D/g, "") ?? null,
      emergency_contact_relation: optional(formData.get("emergency_contact_relation")),
      bank_account_no: optional(formData.get("bank_account_no"))?.replace(/\D/g, "") ?? null,
      ifsc: optional(formData.get("ifsc"))?.toUpperCase() ?? null
    };

    if (!/^\d{6,15}$/.test(mobile)) throw new Error("Mobile number must contain 6 to 15 digits.");
    if (extraPayload.aadhaar_number && !/^\d{12}$/.test(extraPayload.aadhaar_number)) throw new Error("Aadhaar number must contain exactly 12 digits.");
    if (extraPayload.pan_number && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(extraPayload.pan_number)) throw new Error("PAN number format is invalid.");
    if (extraPayload.pincode && !/^\d{6}$/.test(extraPayload.pincode)) throw new Error("Postal PIN must contain exactly 6 digits.");
    if (extraPayload.emergency_contact_number && !/^\d{10}$/.test(extraPayload.emergency_contact_number)) throw new Error("Emergency contact number must contain exactly 10 digits.");
    if (extraPayload.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(extraPayload.ifsc)) throw new Error("IFSC format is invalid.");
    if (Number.isNaN(Date.parse(dateOfJoin))) throw new Error("Enter a valid date of join.");
    if (extraPayload.date_of_birth && Number.isNaN(Date.parse(extraPayload.date_of_birth))) throw new Error("Enter a valid date of birth.");
    if (!authorization.hasAllLocationAccess && !authorization.locationScopeIds.includes(locationId)) {
      throw new Error("You do not have access to the selected location.");
    }

    const [locationResult, designationResult] = await Promise.all([
      supabaseAdmin.from("stations").select("id, station_code, station_name").eq("id", locationId).eq("company_id", companyId).maybeSingle(),
      supabaseAdmin.from("designations").select("id, name").eq("id", designationId).eq("company_id", companyId).eq("is_active", true).maybeSingle()
    ]);
    if (locationResult.error) throw new Error(locationResult.error.message);
    if (designationResult.error) throw new Error(designationResult.error.message);
    if (!locationResult.data) throw new Error("Selected location is not available for this company.");
    if (!designationResult.data) throw new Error("Selected designation is not available.");

    const existingResult = await supabaseAdmin
      .from("employees")
      .select("biometric_id, aadhaar_front_path, aadhaar_back_path, pan_upload_path, profile_photo_path")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (existingResult.error) throw new Error(existingResult.error.message);
    const biometricId = String((existingResult.data as { biometric_id?: string | null } | null)?.biometric_id ?? "").replace(/\D/g, "") || null;

    const documentPayload: Record<string, string> = {};
    const existingPaths = existingResult.data as Record<string, string | null> | null;
    for (const field of employeeDocumentFields) {
      const uploaded = await uploadProfileDocument({
        companyId,
        documentKey: field.pathKey.replace("_path", ""),
        fileValue: formData.get(field.formKey),
        ownerId: id,
        ownerType: "employee"
      });
      if (!uploaded) continue;
      const oldPath = existingPaths?.[field.pathKey] ?? null;
      if (oldPath) {
        await moveProfileDocumentToTrash({
          companyId,
          ownerId: id,
          ownerType: "employee",
          documentLabel: field.label,
          fileName: oldPath.split("/").pop(),
          storagePath: oldPath,
          replacedBy: authorization.userId
        });
      }
      documentPayload[field.pathKey] = uploaded.storagePath;
    }

    const { error } = await supabaseAdmin.from("employees").update({
      full_name: fullName,
      mobile_country_code: mobileCountryCode,
      mobile,
      email,
      date_of_join: dateOfJoin,
      location_id: locationId,
      designation_id: designationId,
      statutory_applicability: statutoryApplicability,
      ...extraPayload,
      ...documentPayload,
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

function normalizeHeader(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function cellText(row: Record<string, unknown>, aliases: string[]) {
  const value = cellValue(row, aliases);
  return String(value ?? "").trim();
}

function cellValue(row: Record<string, unknown>, aliases: string[]) {
  const normalizedAliases = new Set(aliases.map(normalizeHeader));
  const entry = Object.entries(row).find(([key]) => normalizedAliases.has(normalizeHeader(key)));
  return entry?.[1] ?? "";
}

function parseExcelDate(value: unknown, rowNumber: number) {
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      const date = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
      return date.toISOString().slice(0, 10);
    }
  }
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!match) throw new Error(`Row ${rowNumber}: Date of join must be DD/MM/YYYY.`);
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`Row ${rowNumber}: Date of join is invalid.`);
  }
  return date.toISOString().slice(0, 10);
}

function parseStatutoryApplicability(value: unknown, rowNumber: number) {
  const text = String(value ?? "").trim();
  if (!text) return ["not_applicable"];
  const tokens = text
    .split(/[,/|+&]+|\band\b/i)
    .map((item) => item.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""))
    .filter(Boolean);
  const mapped = tokens.map((token) => {
    if (["na", "n_a", "no", "none", "not_applicable", "notapplicable"].includes(token)) return "not_applicable";
    if (token === "pf") return "pf";
    if (token === "esi" || token === "esic") return "esi";
    throw new Error(`Row ${rowNumber}: Statutory applicability must be PF, ESI, PF/ESI, or Not Applicable.`);
  });
  if (!mapped.length || mapped.includes("not_applicable")) return ["not_applicable"];
  return Array.from(new Set(mapped));
}

async function parseBulkWorkbook(fileValue: FormDataEntryValue | null) {
  if (!(fileValue instanceof File) || fileValue.size === 0) throw new Error("Choose an Excel file to upload.");
  const bytes = Buffer.from(await fileValue.arrayBuffer());
  const workbook = XLSX.read(bytes, { type: "buffer", cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("The Excel file does not contain a worksheet.");
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  if (!rawRows.length) throw new Error("The Excel file does not contain any rows.");

  return rawRows.map((row, index) => {
    const rowNumber = index + 2;
    const fullName = cellText(row, ["Full name", "Full Name"]);
    const mobile = cellText(row, ["Mob no", "Mobile", "Mobile number", "Mob number"]).replace(/\D/g, "");
    const locationCode = cellText(row, ["Location", "Location code"]).toUpperCase();
    const designationCode = cellText(row, ["Designation code", "Delisignation code", "Designation"]).toUpperCase();
    if (!fullName) throw new Error(`Row ${rowNumber}: Full name is required.`);
    if (!/^\d{6,15}$/.test(mobile)) throw new Error(`Row ${rowNumber}: Mobile number must contain 6 to 15 digits.`);
    if (!locationCode) throw new Error(`Row ${rowNumber}: Location is required.`);
    if (!designationCode) throw new Error(`Row ${rowNumber}: Designation code is required.`);

    const biometricId = cellText(row, ["Biometric ID", "Biometric enrolment ID", "Bio ID"]).replace(/\D/g, "") || null;
    if (biometricId && !/^\d{1,20}$/.test(biometricId)) throw new Error(`Row ${rowNumber}: Biometric ID must be numeric.`);

    return {
      dropxId: cellText(row, ["Dropx ID", "DropX ID", "Employee ID", "Emp ID"]).toUpperCase() || null,
      biometricId,
      fullName,
      mobileCountryCode: cleanCountryCode(cellText(row, ["Mob country code", "Mobile country code", "Country code"]) || "91"),
      mobile,
      email: cellText(row, ["Email", "Email ID"]).toLowerCase() || null,
      dateOfJoin: parseExcelDate(cellValue(row, ["Date of join", "Date of join (DD/MM/YYYY)", "Date of join (DD/MM/YYY)", "DOJ"]), rowNumber),
      locationCode,
      designationCode,
      statutoryApplicability: parseStatutoryApplicability(cellValue(row, ["Statutory applicability", "Statutory", "PF/ESI"]), rowNumber)
    } satisfies BulkImportRow;
  });
}

export async function bulkImportEmployees(formData: FormData) {
  const authorization = await requirePagePermission("employees", "add");
  const companyId = requireCompanyId(authorization);
  if (!supabaseAdmin) employeesRedirect({ error: "Supabase service role key is not configured." });

  try {
    const rows = await parseBulkWorkbook(formData.get("bulk_file"));
    const locationCodes = Array.from(new Set(rows.map((row) => row.locationCode)));
    const designationCodes = Array.from(new Set(rows.map((row) => row.designationCode)));
    const [locationsResult, designationsResult] = await Promise.all([
      supabaseAdmin.from("stations").select("id, station_code").eq("company_id", companyId).in("station_code", locationCodes),
      supabaseAdmin.from("designations").select("id, code").eq("company_id", companyId).eq("is_active", true).in("code", designationCodes)
    ]);
    if (locationsResult.error) throw new Error(locationsResult.error.message);
    if (designationsResult.error) throw new Error(designationsResult.error.message);

    const locations = new Map((locationsResult.data ?? []).map((location) => [String(location.station_code).toUpperCase(), String(location.id)]));
    const designations = new Map((designationsResult.data ?? []).map((designation) => [String(designation.code).toUpperCase(), String(designation.id)]));
    const inserted: { id: string; locationId: string; biometricId: string | null; dateOfJoin: string }[] = [];

    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 2;
      const locationId = locations.get(row.locationCode);
      const designationId = designations.get(row.designationCode);
      if (!locationId) throw new Error(`Row ${rowNumber}: Location ${row.locationCode} not found.`);
      if (!designationId) throw new Error(`Row ${rowNumber}: Designation code ${row.designationCode} not found.`);
      if (!authorization.hasAllLocationAccess && !authorization.locationScopeIds.includes(locationId)) {
        throw new Error(`Row ${rowNumber}: You do not have access to location ${row.locationCode}.`);
      }

      const employeeCode = row.dropxId || await generateConfiguredWorkerId({
        category: "employee",
        companyId,
        designationId,
        fallback: generatedEmployeeCode,
        locationId
      });
      const biometricId = row.biometricId || await generateConfiguredBiometricId({
        category: "employee",
        companyId,
        designationId,
        fallback: () => generateBiometricEnrolmentId(companyId),
        locationId
      });

      const insertResult = await supabaseAdmin.from("employees").insert(withCompany({
        employee_code: employeeCode,
        biometric_id: biometricId,
        full_name: row.fullName,
        mobile_country_code: row.mobileCountryCode,
        mobile: row.mobile,
        email: row.email,
        date_of_join: row.dateOfJoin,
        location_id: locationId,
        designation_id: designationId,
        statutory_applicability: row.statutoryApplicability,
        created_by: authorization.userId,
        profile_completion_status: "pending",
        is_active: true
      }, companyId)).select("id").single();
      if (insertResult.error) throw new Error(`Row ${rowNumber}: ${insertResult.error.message}`);
      inserted.push({ id: insertResult.data.id, locationId, biometricId, dateOfJoin: row.dateOfJoin });
    }

    for (const row of inserted) {
      await syncBiometricEnrolment({
        companyId,
        createdBy: authorization.userId,
        effectiveFrom: row.dateOfJoin,
        employeeId: row.id,
        enrolmentId: row.biometricId,
        isActive: true,
        locationId: row.locationId,
        workerType: "employee"
      });
    }

    revalidatePath("/employees");
    employeesRedirect({ notice: `${inserted.length} employees imported successfully.` });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    employeesRedirect({ error: error instanceof Error ? error.message : "Unable to import employees." });
  }
}
