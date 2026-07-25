"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import * as XLSX from "xlsx";
import { requirePagePermission } from "@/lib/authorization";
import { syncBiometricEnrolment } from "@/lib/biometric/enrolments";
import { generateBiometricEnrolmentId } from "@/lib/biometric/ids";
import { requireCompanyId, withCompany } from "@/lib/company-scope";
import { cleanCountryCode } from "@/lib/country-codes";
import { generateConfiguredBiometricId, generateConfiguredWorkerId } from "@/lib/dropx-id-generation";
import { moveProfileDocumentToTrash, uploadProfileDocument } from "@/lib/profile-document-storage";
import { normalizeDesignationCategories } from "@/lib/designation-categories";
import { normalizeProfileFieldRules } from "@/lib/profile-field-rules";
import { saveProfileVerifications } from "@/lib/profile-verifications";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendFieldExecutiveOnboardingWhatsApp } from "@/lib/whatsapp";

function required(value: FormDataEntryValue | null, field: string) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${field} is required.`);
  return text;
}

function optional(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

type FieldExecutiveReturnPath = "/field-executive" | "/contractors";
type FieldExecutivePageCode = "delivery_associates" | "contractors";

function safeReturnPath(formData?: FormData): FieldExecutiveReturnPath {
  return String(formData?.get("return_path") ?? "") === "/contractors" ? "/contractors" : "/field-executive";
}

function pageCodeForReturnPath(returnPath: FieldExecutiveReturnPath): FieldExecutivePageCode {
  return returnPath === "/contractors" ? "contractors" : "delivery_associates";
}

function entityLabelForReturnPath(returnPath: FieldExecutiveReturnPath) {
  return returnPath === "/contractors" ? "Independent contractor" : "Field executive";
}

function fieldExecutiveRedirect(params?: Record<string, string>, returnPath: FieldExecutiveReturnPath = "/field-executive"): never {
  const query = params ? `?${new URLSearchParams(params).toString()}` : "";
  redirect(`${returnPath}${query}`);
}

function addFormParams(formData: FormData) {
  return {
    full_name: String(formData.get("full_name") ?? ""),
    mobile_country_code: cleanCountryCode(formData.get("mobile_country_code")),
    mobile: String(formData.get("mobile") ?? "").replace(/\D/g, ""),
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    date_of_join: String(formData.get("date_of_join") ?? ""),
    location_id: String(formData.get("location_id") ?? ""),
    designation: String(formData.get("designation") ?? "")
  };
}

function friendlyFieldExecutiveError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("operation_mode_id")) {
    return "Database migration pending: remove operation_mode_id from field_executives in Supabase.";
  }
  return message;
}

function isNextRedirectError(error: unknown) {
  return typeof (error as { digest?: unknown })?.digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT");
}

function generatedDropxId() {
  return `FE-${Date.now().toString(36).toUpperCase()}`;
}

type FieldExecutiveWorkerCategory = "field_executive" | "contractor";

function workerCategoryFromDesignationCategories(value: unknown): FieldExecutiveWorkerCategory {
  const categories = normalizeDesignationCategories(value);
  const isContractorOnly = categories.includes("contractors") &&
    !categories.includes("field_executives") &&
    !categories.includes("delivery_executives");
  return isContractorOnly ? "contractor" : "field_executive";
}

async function loadWorkerCategoryForDesignation(companyId: string, designationName: string): Promise<FieldExecutiveWorkerCategory> {
  if (!supabaseAdmin) return "field_executive";
  const result = await supabaseAdmin
    .from("designations")
    .select("onboarding_categories")
    .eq("company_id", companyId)
    .eq("name", designationName)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (result.error || !result.data) return "field_executive";
  return workerCategoryFromDesignationCategories((result.data as { onboarding_categories?: unknown }).onboarding_categories);
}

const fieldExecutiveDocumentFields = [
  { formKey: "aadhaar_front_file", pathKey: "aadhaar_front_path", label: "Aadhaar front" },
  { formKey: "aadhaar_back_file", pathKey: "aadhaar_back_path", label: "Aadhaar back" },
  { formKey: "pan_upload_file", pathKey: "pan_upload_path", label: "PAN upload" },
  { formKey: "dl_front_file", pathKey: "dl_front_path", label: "DL front" },
  { formKey: "dl_back_file", pathKey: "dl_back_path", label: "DL back" },
  { formKey: "profile_photo_file", pathKey: "profile_photo_path", label: "Profile photo" }
] as const;

function normalizeFieldExecutivePayload(formData: FormData, requireId = false) {
  const id = requireId ? required(formData.get("id"), "Field executive") : null;
  const fullName = required(formData.get("full_name"), "Full name");
  const mobileCountryCode = cleanCountryCode(formData.get("mobile_country_code"));
  const mobile = required(formData.get("mobile"), "Mobile number").replace(/\D/g, "");
  const email = required(formData.get("email"), "Email").toLowerCase();
  const dateOfJoin = required(formData.get("date_of_join"), "Date of join");
  const locationId = required(formData.get("location_id"), "Location");
  const designation = required(formData.get("designation"), "Designation");
  const gender = optional(formData.get("gender"));
  const dateOfBirth = optional(formData.get("date_of_birth"));
  const aadhaarNumber = optional(formData.get("aadhaar_number"))?.replace(/\D/g, "") ?? null;
  const panNumber = optional(formData.get("pan_number"))?.toUpperCase() ?? null;
  const eshramUan = optional(formData.get("eshram_uan"))?.replace(/\D/g, "") ?? null;
  const address = optional(formData.get("address"));
  const postalPin = optional(formData.get("postal_pin"))?.replace(/\D/g, "") ?? null;
  const landmark = optional(formData.get("landmark"));
  const stateCode = optional(formData.get("state_code"));
  const fatherName = optional(formData.get("father_name"));
  const bloodGroup = optional(formData.get("blood_group"));
  const isHandicappedValue = optional(formData.get("is_handicapped"));
  const isHandicapped = isHandicappedValue === null ? null : isHandicappedValue === "true";
  const bankAccountNo = optional(formData.get("bank_account_no"))?.toUpperCase() ?? null;
  const ifscCode = optional(formData.get("ifsc_code"))?.toUpperCase() ?? null;
  const drivingLicenseNo = optional(formData.get("driving_license_no"))?.toUpperCase() ?? null;
  const drivingLicenseExpDate = optional(formData.get("driving_license_exp_date"));
  const vehicleRegNo = optional(formData.get("vehicle_reg_no"))?.toUpperCase() ?? null;
  const vehicleRegExpDate = optional(formData.get("vehicle_reg_exp_date"));
  const vehicleInsuranceExpDate = optional(formData.get("vehicle_insurance_exp_date"));
  const vehiclePollutionExpDate = optional(formData.get("vehicle_pollution_exp_date"));
  const biometricId = optional(formData.get("biometric_id"));
  const emergencyContactName = optional(formData.get("emergency_contact_name"));
  const emergencyContactNumber = optional(formData.get("emergency_contact_number"))?.replace(/\D/g, "") ?? null;
  const emergencyContactRelation = optional(formData.get("emergency_contact_relation"));
  const isActive = optional(formData.get("is_active")) !== "false";

  if (!/^\d{6,15}$/.test(mobile)) throw new Error("Mobile number must contain 6 to 15 digits.");
  if (biometricId && !/^\d{1,20}$/.test(biometricId)) throw new Error("Biometric enrolment ID must be numeric.");
  if (emergencyContactNumber && !/^\d{10}$/.test(emergencyContactNumber)) throw new Error("Emergency contact number must contain exactly 10 digits.");
  if (aadhaarNumber && !/^\d{12}$/.test(aadhaarNumber)) throw new Error("Aadhaar number must contain exactly 12 digits.");
  if (postalPin && !/^\d{6}$/.test(postalPin)) throw new Error("Postal PIN must contain exactly 6 digits.");
  if (eshramUan && !/^\d{12}$/.test(eshramUan)) throw new Error("eShram UAN must contain exactly 12 digits.");
  if (panNumber && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panNumber)) throw new Error("PAN number format is invalid.");
  if (ifscCode && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode)) throw new Error("IFSC format is invalid.");
  if (bankAccountNo && !/^[A-Z0-9]+$/.test(bankAccountNo)) throw new Error("Bank account number can contain only letters and numbers.");

  [
    ["Date of join", dateOfJoin],
    ["Date of birth", dateOfBirth],
    ["Driving license expiry date", drivingLicenseExpDate],
    ["Vehicle registration expiry date", vehicleRegExpDate],
    ["Vehicle Insurance expiry", vehicleInsuranceExpDate],
    ["Vehicle pollution expiry date", vehiclePollutionExpDate]
  ].forEach(([label, value]) => {
    if (value && Number.isNaN(Date.parse(value))) throw new Error(`Enter a valid ${String(label).toLowerCase()}.`);
  });

  return {
    id,
    payload: {
      full_name: fullName,
      mobile_country_code: mobileCountryCode,
      mobile,
      email,
      date_of_join: dateOfJoin,
      location_id: locationId,
      designation,
      gender,
      date_of_birth: dateOfBirth,
      aadhaar_number: aadhaarNumber,
      pan_number: panNumber,
      eshram_uan: eshramUan,
      address,
      postal_pin: postalPin,
      landmark,
      state_code: stateCode,
      father_name: fatherName,
      blood_group: bloodGroup,
      is_handicapped: isHandicapped,
      bank_account_no: bankAccountNo,
      ifsc_code: ifscCode,
      driving_license_no: drivingLicenseNo,
      driving_license_exp_date: drivingLicenseExpDate,
      vehicle_reg_no: vehicleRegNo,
      vehicle_reg_exp_date: vehicleRegExpDate,
      vehicle_insurance_exp_date: vehicleInsuranceExpDate,
      vehicle_pollution_exp_date: vehiclePollutionExpDate,
      biometric_id: biometricId,
      emergency_contact_name: emergencyContactName,
      emergency_contact_number: emergencyContactNumber,
      emergency_contact_relation: emergencyContactRelation,
      is_active: isActive
    }
  };
}

export async function createFieldExecutive(formData: FormData) {
  const returnPath = safeReturnPath(formData);
  const entityLabel = entityLabelForReturnPath(returnPath);
  const authorization = await requirePagePermission(pageCodeForReturnPath(returnPath), "add");
  const companyId = requireCompanyId(authorization);
  if (!supabaseAdmin) fieldExecutiveRedirect({ error: "Supabase service role key is not configured." }, returnPath);

  try {
    const fullName = required(formData.get("full_name"), "Full name");
    const mobileCountryCode = cleanCountryCode(formData.get("mobile_country_code"));
    const mobile = required(formData.get("mobile"), "Mobile number").replace(/\D/g, "");
    const email = required(formData.get("email"), "Email").toLowerCase();
    const dateOfJoin = required(formData.get("date_of_join"), "Date of join");
    const locationId = required(formData.get("location_id"), "Location");
    const designation = required(formData.get("designation"), "Designation");

    if (!/^\d{6,15}$/.test(mobile)) throw new Error("Mobile number must contain 6 to 15 digits.");
    if (Number.isNaN(Date.parse(dateOfJoin))) throw new Error("Enter a valid date of join.");
    if (!authorization.hasAllLocationAccess && !authorization.locationScopeIds.includes(locationId)) {
      throw new Error("You do not have access to the selected location.");
    }
    const { data: location, error: locationError } = await supabaseAdmin
      .from("stations")
      .select("id")
      .eq("id", locationId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (locationError) throw new Error(locationError.message);
    if (!location) throw new Error("Selected location is not available for this company.");
    const workerCategory = await loadWorkerCategoryForDesignation(companyId, designation);
    const biometricId = await generateConfiguredBiometricId({
      category: workerCategory,
      companyId,
      designationName: designation,
      fallback: () => generateBiometricEnrolmentId(companyId),
      locationId
    });
    if (biometricId && !/^\d{1,20}$/.test(biometricId)) throw new Error("Biometric enrolment ID must be numeric.");

    const dropxId = await generateConfiguredWorkerId({
      category: workerCategory,
      companyId,
      designationName: designation,
      fallback: generatedDropxId,
      locationId
    });
    const registrationToken = randomBytes(32).toString("base64url");
    const registrationTokenHash = createHash("sha256").update(registrationToken).digest("hex");
    const basePayload = withCompany({
      full_name: fullName,
      mobile_country_code: mobileCountryCode,
      mobile,
      email,
      date_of_join: dateOfJoin,
      location_id: locationId,
      designation,
      biometric_id: biometricId,
      dropx_id: dropxId,
      created_by: authorization.userId,
      is_active: true
    }, companyId);
    const executiveSelect = "id, stations (station_code, station_name, providers (name))";
    let insertResult = await supabaseAdmin.from("field_executives").insert({
      ...basePayload,
      onboarding_token_hash: registrationTokenHash,
      onboarding_token_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      onboarding_status: "pending"
    }).select(executiveSelect).single();

    const whatsappMigrationMissing = Boolean(insertResult.error?.message.toLowerCase().includes("onboarding_token"));
    if (whatsappMigrationMissing) {
      insertResult = await supabaseAdmin.from("field_executives").insert(basePayload).select(executiveSelect).single();
    }
    const { data: executive, error } = insertResult;

    if (error) {
      const message = error.message.toLowerCase();
      if (message.includes("unique") || message.includes("duplicate")) {
        throw new Error("Field Executive ID is already registered.");
      }
      throw new Error(friendlyFieldExecutiveError(error.message));
    }

    await syncBiometricEnrolment({
      companyId,
      createdBy: authorization.userId,
      effectiveFrom: dateOfJoin,
      enrolmentId: biometricId,
      fieldExecutiveId: executive.id,
      isActive: true,
      locationId,
      workerType: "individual_contract"
    });

    const stationRelation = executive.stations as unknown as { station_code?: string; station_name?: string | null; providers?: { name?: string } | Array<{ name?: string }> | null } | null;
    const providerRelation = Array.isArray(stationRelation?.providers) ? stationRelation?.providers[0] : stationRelation?.providers;
    if (!whatsappMigrationMissing) {
      waitUntil(sendFieldExecutiveOnboardingWhatsApp({
        companyId,
        fieldExecutiveId: executive.id,
        fullName,
        mobile: `${mobileCountryCode}${mobile}`,
        dropxId,
        dateOfJoin,
        locationCode: stationRelation?.station_code ?? "",
        locationName: stationRelation?.station_name ?? "",
        providerName: providerRelation?.name ?? "",
        registrationToken,
        triggeredBy: authorization.userId
      }));
    }

    revalidatePath("/field-executive");
    revalidatePath("/contractors");
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    fieldExecutiveRedirect({
      ...addFormParams(formData),
      error: error instanceof Error ? friendlyFieldExecutiveError(error.message) : "Unable to add field executive."
    }, returnPath);
  }

  fieldExecutiveRedirect({ notice: `${entityLabel} added successfully.` }, returnPath);
}

export async function updateFieldExecutive(formData: FormData) {
  const returnPath = safeReturnPath(formData);
  const entityLabel = entityLabelForReturnPath(returnPath);
  const authorization = await requirePagePermission(pageCodeForReturnPath(returnPath), "edit");
  const companyId = requireCompanyId(authorization);
  if (!supabaseAdmin) fieldExecutiveRedirect({ error: "Supabase service role key is not configured." }, returnPath);

  try {
    const { id, payload } = normalizeFieldExecutivePayload(formData, true);
    if (!id) throw new Error("Field executive is required.");
    const executiveId = id;
    const existingResult = await supabaseAdmin
      .from("field_executives")
      .select("biometric_id, aadhaar_front_path, aadhaar_back_path, pan_upload_path, dl_front_path, dl_back_path, profile_photo_path")
      .eq("id", executiveId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (existingResult.error) throw new Error(existingResult.error.message);
    payload.biometric_id = String((existingResult.data as { biometric_id?: string | null } | null)?.biometric_id ?? "").replace(/\D/g, "") || null;

    if (!authorization.hasAllLocationAccess && !authorization.locationScopeIds.includes(payload.location_id)) {
      throw new Error("You do not have access to the selected location.");
    }
    const { data: location, error: locationError } = await supabaseAdmin
      .from("stations")
      .select("id")
      .eq("id", payload.location_id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (locationError) throw new Error(locationError.message);
    if (!location) throw new Error("Selected location is not available for this company.");

    const designationResult = await supabaseAdmin
      .from("designations")
      .select("profile_field_rules")
      .eq("company_id", companyId)
      .eq("name", payload.designation)
      .eq("is_active", true)
      .maybeSingle();
    if (designationResult.error) throw new Error(designationResult.error.message);
    const dashboardRules = normalizeProfileFieldRules(designationResult.data?.profile_field_rules).field_executives.dashboard;
    const profilePayloadKeys: Record<string, keyof typeof payload> = {
      gender: "gender",
      date_of_birth: "date_of_birth",
      aadhaar_number: "aadhaar_number",
      pan_number: "pan_number",
      eshram_uan: "eshram_uan",
      father_name: "father_name",
      blood_group: "blood_group",
      is_handicapped: "is_handicapped",
      address: "address",
      state_code: "state_code",
      pincode: "postal_pin",
      landmark: "landmark",
      bank_account_no: "bank_account_no",
      ifsc: "ifsc_code",
      driving_license_no: "driving_license_no",
      driving_license_exp_date: "driving_license_exp_date",
      vehicle_reg_no: "vehicle_reg_no",
      vehicle_reg_exp_date: "vehicle_reg_exp_date",
      vehicle_insurance_exp_date: "vehicle_insurance_exp_date",
      vehicle_pollution_exp_date: "vehicle_pollution_exp_date",
      emergency_contact_name: "emergency_contact_name",
      emergency_contact_number: "emergency_contact_number",
      emergency_contact_relation: "emergency_contact_relation"
    };
    for (const key of dashboardRules.required) {
      const payloadKey = profilePayloadKeys[key];
      if (payloadKey && !String(payload[payloadKey] ?? "").trim()) {
        throw new Error(`${key.replaceAll("_", " ")} is required.`);
      }
    }
    const profilePayload = Object.fromEntries(
      dashboardRules.enabled
        .map((key) => profilePayloadKeys[key])
        .filter((key): key is keyof typeof payload => Boolean(key))
        .map((key) => [key, payload[key]])
    );
    const corePayload = {
      full_name: payload.full_name,
      mobile_country_code: payload.mobile_country_code,
      mobile: payload.mobile,
      email: payload.email,
      date_of_join: payload.date_of_join,
      location_id: payload.location_id,
      designation: payload.designation,
      biometric_id: payload.biometric_id,
      is_active: payload.is_active
    };

    const documentPayload: Record<string, string> = {};
    const existingPaths = existingResult.data as Record<string, string | null> | null;
    for (const field of fieldExecutiveDocumentFields) {
      const uploaded = await uploadProfileDocument({
        companyId,
        documentKey: field.pathKey.replace("_path", ""),
        fileValue: formData.get(field.formKey),
        ownerId: executiveId,
        ownerType: "field_executive"
      });
      if (!uploaded) continue;
      const oldPath = existingPaths?.[field.pathKey] ?? null;
      if (oldPath) {
        await moveProfileDocumentToTrash({
          companyId,
          ownerId: executiveId,
          ownerType: "field_executive",
          documentLabel: field.label,
          fileName: oldPath.split("/").pop(),
          storagePath: oldPath,
          replacedBy: authorization.userId
        });
      }
      documentPayload[field.pathKey] = uploaded.storagePath;
    }

    const { error } = await supabaseAdmin
      .from("field_executives")
      .update({
        ...corePayload,
        ...profilePayload,
        ...documentPayload,
        updated_at: new Date().toISOString()
      })
      .eq("id", executiveId)
      .eq("company_id", companyId);

    if (error) {
      const message = error.message.toLowerCase();
      if (message.includes("unique") || message.includes("duplicate")) {
        throw new Error("Field Executive ID is already registered.");
      }
      throw new Error(friendlyFieldExecutiveError(error.message));
    }

    await saveProfileVerifications({
      accountId: executiveId,
      companyId,
      profileType: "field_executive",
      values: formData.getAll("profile_verification_results")
    });

    await syncBiometricEnrolment({
      companyId,
      createdBy: authorization.userId,
      effectiveFrom: payload.date_of_join,
      enrolmentId: payload.biometric_id,
      fieldExecutiveId: executiveId,
      isActive: Boolean(payload.is_active),
      locationId: payload.location_id,
      workerType: "individual_contract"
    });

    revalidatePath("/field-executive");
    revalidatePath("/contractors");
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    fieldExecutiveRedirect({ edit: String(formData.get("id") ?? ""), error: error instanceof Error ? friendlyFieldExecutiveError(error.message) : "Unable to update field executive." }, returnPath);
  }

  fieldExecutiveRedirect({ notice: `${entityLabel} updated successfully.` }, returnPath);
}

export async function reviewFieldExecutiveProfile(formData: FormData) {
  const returnPath = safeReturnPath(formData);
  const entityLabel = entityLabelForReturnPath(returnPath);
  const authorization = await requirePagePermission(pageCodeForReturnPath(returnPath), "edit");
  const companyId = requireCompanyId(authorization);
  if (!supabaseAdmin) fieldExecutiveRedirect({ error: "Supabase service role key is not configured." }, returnPath);

  const id = String(formData.get("id") ?? "").trim();
  const action = String(formData.get("review_action") ?? "").trim().toLowerCase();
  const remarks = String(formData.get("return_remarks") ?? "").trim();

  try {
    if (!id) throw new Error(`${entityLabel} is required.`);
    if (!["approve", "return"].includes(action)) throw new Error("Choose a valid review action.");
    if (action === "return" && !remarks) throw new Error("Return remarks are required.");

    const current = await supabaseAdmin
      .from("field_executives")
      .select("onboarding_status")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (current.error) throw new Error(current.error.message);
    if (!current.data) throw new Error(`${entityLabel} was not found.`);
    if (String(current.data.onboarding_status ?? "").toLowerCase() !== "under_review") {
      throw new Error("Only profiles under review can be approved or returned.");
    }

    const update = action === "approve"
      ? {
          onboarding_status: "active",
          profile_return_remarks: null,
          profile_returned_at: null,
          updated_at: new Date().toISOString()
        }
      : {
          onboarding_status: "returned",
          profile_return_remarks: remarks,
          profile_returned_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
    const result = await supabaseAdmin
      .from("field_executives")
      .update(update)
      .eq("id", id)
      .eq("company_id", companyId);
    if (result.error) throw new Error(result.error.message);

    revalidatePath("/field-executive");
    revalidatePath("/contractors");
    fieldExecutiveRedirect({
      notice: action === "approve"
        ? `${entityLabel} profile approved.`
        : `${entityLabel} profile returned for correction.`
    }, returnPath);
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    fieldExecutiveRedirect({
      edit: id,
      error: error instanceof Error ? error.message : `Unable to review ${entityLabel.toLowerCase()} profile.`
    }, returnPath);
  }
}

type BulkImportRow = {
  dropxId: string | null;
  biometricId: string | null;
  fullName: string;
  mobileCountryCode: string;
  mobile: string;
  email: string;
  dateOfJoin: string;
  locationCode: string;
  designationCode: string;
};

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
      dropxId: cellText(row, ["Dropx ID", "DropX ID", "Field executive ID", "ID"]).toUpperCase() || null,
      biometricId,
      fullName,
      mobileCountryCode: cleanCountryCode(cellText(row, ["Mob country code", "Mobile country code", "Country code"]) || "91"),
      mobile,
      email: required(cellText(row, ["Email", "Email ID"]), `Row ${rowNumber}: Email`).toLowerCase(),
      dateOfJoin: parseExcelDate(cellValue(row, ["Date of join", "Date of join (DD/MM/YYYY)", "Date of join (DD/MM/YYY)", "DOJ"]), rowNumber),
      locationCode,
      designationCode
    } satisfies BulkImportRow;
  });
}

export async function bulkImportFieldExecutives(formData: FormData) {
  const returnPath = safeReturnPath(formData);
  const entityLabel = entityLabelForReturnPath(returnPath);
  const authorization = await requirePagePermission(pageCodeForReturnPath(returnPath), "add");
  const companyId = requireCompanyId(authorization);
  if (!supabaseAdmin) fieldExecutiveRedirect({ error: "Supabase service role key is not configured." }, returnPath);
  const inserted: { id: string; locationId: string; biometricId: string | null; dateOfJoin: string }[] = [];

  try {
    const rows = await parseBulkWorkbook(formData.get("bulk_file"));
    const explicitDropxIds = new Map<string, number>();
    for (const [index, row] of rows.entries()) {
      if (!row.dropxId) continue;
      const previousRow = explicitDropxIds.get(row.dropxId);
      if (previousRow) {
        throw new Error(`Rows ${previousRow} and ${index + 2}: DropX ID ${row.dropxId} is duplicated in the Excel file.`);
      }
      explicitDropxIds.set(row.dropxId, index + 2);
    }
    if (explicitDropxIds.size) {
      const existingIds = await supabaseAdmin
        .from("field_executives")
        .select("dropx_id")
        .eq("company_id", companyId)
        .in("dropx_id", Array.from(explicitDropxIds.keys()));
      if (existingIds.error) throw new Error(existingIds.error.message);
      const existingId = String(existingIds.data?.[0]?.dropx_id ?? "");
      if (existingId) {
        throw new Error(`Row ${explicitDropxIds.get(existingId)}: DropX ID ${existingId} is already registered.`);
      }
    }

    const locationCodes = Array.from(new Set(rows.map((row) => row.locationCode)));
    const designationCodes = Array.from(new Set(rows.map((row) => row.designationCode)));
    const [locationsResult, designationsResult] = await Promise.all([
      supabaseAdmin.from("stations").select("id, station_code").eq("company_id", companyId).in("station_code", locationCodes),
      supabaseAdmin.from("designations").select("id, code, name, onboarding_categories").eq("company_id", companyId).eq("is_active", true).in("code", designationCodes)
    ]);
    if (locationsResult.error) throw new Error(locationsResult.error.message);
    if (designationsResult.error) throw new Error(designationsResult.error.message);

    const locations = new Map((locationsResult.data ?? []).map((location) => [String(location.station_code).toUpperCase(), String(location.id)]));
    const designations = new Map((designationsResult.data ?? []).map((designation) => [String(designation.code).toUpperCase(), {
      id: String(designation.id),
      name: String(designation.name),
      workerCategory: workerCategoryFromDesignationCategories((designation as { onboarding_categories?: unknown }).onboarding_categories)
    }]));

    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 2;
      const locationId = locations.get(row.locationCode);
      const designation = designations.get(row.designationCode);
      if (!locationId) throw new Error(`Row ${rowNumber}: Location ${row.locationCode} not found.`);
      if (!designation) throw new Error(`Row ${rowNumber}: Designation code ${row.designationCode} not found.`);
      if (!authorization.hasAllLocationAccess && !authorization.locationScopeIds.includes(locationId)) {
        throw new Error(`Row ${rowNumber}: You do not have access to location ${row.locationCode}.`);
      }

      const dropxId = row.dropxId || await generateConfiguredWorkerId({
        category: designation.workerCategory,
        companyId,
        designationId: designation.id,
        fallback: generatedDropxId,
        locationId
      });
      const biometricId = row.biometricId || await generateConfiguredBiometricId({
        category: designation.workerCategory,
        companyId,
        designationId: designation.id,
        fallback: () => generateBiometricEnrolmentId(companyId),
        locationId
      });

      const insertResult = await supabaseAdmin.from("field_executives").insert(withCompany({
        dropx_id: dropxId,
        biometric_id: biometricId,
        full_name: row.fullName,
        mobile_country_code: row.mobileCountryCode,
        mobile: row.mobile,
        email: row.email,
        date_of_join: row.dateOfJoin,
        location_id: locationId,
        designation: designation.name,
        created_by: authorization.userId,
        onboarding_status: "pending",
        is_active: true
      }, companyId)).select("id").single();
      if (insertResult.error) throw new Error(`Row ${rowNumber}: ${friendlyFieldExecutiveError(insertResult.error.message)}`);
      inserted.push({ id: insertResult.data.id, locationId, biometricId, dateOfJoin: row.dateOfJoin });
    }

    for (const row of inserted) {
      await syncBiometricEnrolment({
        companyId,
        createdBy: authorization.userId,
        effectiveFrom: row.dateOfJoin,
        enrolmentId: row.biometricId,
        fieldExecutiveId: row.id,
        isActive: true,
        locationId: row.locationId,
        workerType: "individual_contract"
      });
    }

    revalidatePath("/field-executive");
    revalidatePath("/contractors");
    fieldExecutiveRedirect({ notice: `${inserted.length} ${entityLabel.toLowerCase()} records imported successfully.` }, returnPath);
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    if (inserted.length) {
      const insertedIds = inserted.map((row) => row.id);
      await supabaseAdmin.from("biometric_enrolments").delete().in("field_executive_id", insertedIds);
      await supabaseAdmin.from("field_executives").delete().eq("company_id", companyId).in("id", insertedIds);
    }
    fieldExecutiveRedirect({ error: error instanceof Error ? friendlyFieldExecutiveError(error.message) : "Unable to import field executives." }, returnPath);
  }
}
