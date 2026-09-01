"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import * as XLSX from "xlsx";
import { isCompanyOwner, requirePagePermission } from "@/lib/authorization";
import { currentAccessSurface } from "@/lib/access-surface";
import { syncBiometricEnrolment } from "@/lib/biometric/enrolments";
import { generateBiometricEnrolmentId } from "@/lib/biometric/ids";
import { requireCompanyId, withCompany } from "@/lib/company-scope";
import { cleanCountryCode } from "@/lib/country-codes";
import {
  firstDesignationBusinessCategory,
  type DesignationPeopleModule
} from "@/lib/designation-business-categories";
import { assertWorkerDesignationMappedToIdSeries, generateConfiguredBiometricId, generateConfiguredWorkerId } from "@/lib/dropx-id-generation";
import { requireDesignationOnboardingAccess } from "@/lib/designation-onboarding-access";
import { requireDesignationPortalAccess } from "@/lib/designation-portal-access";
import { moveProfileDocumentToTrash, uploadProfileDocument } from "@/lib/profile-document-storage";
import { isMissingVerificationTable, saveProfileVerifications } from "@/lib/profile-verifications";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createAppNotification } from "@/lib/app-notifications";
import { loadWorkforceCategoryDirectActivate, loadWorkforceCategoryRules } from "@/lib/workforce-category-rules";
import { sendFieldExecutiveOnboardingWhatsApp } from "@/lib/whatsapp";
import {
  nonEmployeeConfigForRoute,
  type NonEmployeeRoute
} from "@/lib/workforce-profiles";

function required(value: FormDataEntryValue | null, field: string) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${field} is required.`);
  return text;
}

function optional(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

type FieldExecutiveReturnPath = NonEmployeeRoute;

function safeReturnPath(formData?: FormData): FieldExecutiveReturnPath {
  return nonEmployeeConfigForRoute(formData?.get("return_path")).route;
}

function pageCodeForReturnPath(returnPath: FieldExecutiveReturnPath) {
  return nonEmployeeConfigForRoute(returnPath).pageCode;
}

function entityLabelForReturnPath(returnPath: FieldExecutiveReturnPath) {
  return nonEmployeeConfigForRoute(returnPath).label;
}

function tableForReturnPath(returnPath: FieldExecutiveReturnPath) {
  return nonEmployeeConfigForRoute(returnPath).table;
}

function registrationCategoryForDesignation(
  designation: { onboarding_categories?: unknown; registration_category_code?: unknown },
  compatibilityFallback: string
) {
  const categories = Array.isArray(designation.onboarding_categories)
    ? designation.onboarding_categories.map((value) => String(value).trim().toLowerCase()).filter(Boolean)
    : [];
  const configured = String(designation.registration_category_code ?? "").trim().toLowerCase();
  if (configured && categories.includes(configured)) return configured;
  if (categories.length === 1) return categories[0];
  return compatibilityFallback;
}

function requiredPeopleModule(returnPath: FieldExecutiveReturnPath): DesignationPeopleModule | null {
  const profileType = nonEmployeeConfigForRoute(returnPath).profileType;
  if (profileType === "field_executive") return "delivery_network";
  if (currentAccessSurface() === "workforce" && ["workforce", "contractor", "vendor", "worker"].includes(profileType)) {
    return "delivery_network";
  }
  if (["contractor", "vendor", "worker"].includes(profileType)) return "people_hr";
  return null;
}

function requireDesignationPeopleModule(
  designation: { designation_category?: unknown },
  returnPath: FieldExecutiveReturnPath
) {
  const expected = requiredPeopleModule(returnPath);
  if (!expected) return;
  const actual = firstDesignationBusinessCategory(designation.designation_category)?.people_module;
  if (actual === expected) return;
  throw new Error(expected === "delivery_network"
    ? "Selected designation is not assigned to the Delivery Network category."
    : "Selected designation is not assigned to the People / HR category.");
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

function generatedDropxId(category: "workforce" | "field_executive" | "contractor" | "vendor" | "worker") {
  const prefix = category === "field_executive"
    ? "FE"
    : category === "workforce"
      ? "WF"
    : category === "contractor"
      ? "IC"
      : category === "vendor"
        ? "VEN"
        : "WRK";
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

const fieldExecutiveDocumentFields = [
  { ruleKey: "aadhaar_front", formKey: "aadhaar_front_file", pathKey: "aadhaar_front_path", label: "Aadhaar front" },
  { ruleKey: "aadhaar_back", formKey: "aadhaar_back_file", pathKey: "aadhaar_back_path", label: "Aadhaar back" },
  { ruleKey: "pan_upload", formKey: "pan_upload_file", pathKey: "pan_upload_path", label: "PAN upload" },
  { ruleKey: "dl_front", formKey: "dl_front_file", pathKey: "dl_front_path", label: "DL front" },
  { ruleKey: "dl_back", formKey: "dl_back_file", pathKey: "dl_back_path", label: "DL back" },
  { ruleKey: "profile_photo", formKey: "profile_photo_file", pathKey: "profile_photo_path", label: "Profile photo" }
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
  const pfUan = optional(formData.get("pf_uan"))?.replace(/\D/g, "") ?? null;
  const pfAccountNo = optional(formData.get("pf_account_no"))?.toUpperCase() ?? null;
  const esiNo = optional(formData.get("esi_no"))?.toUpperCase() ?? null;
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
  const statutoryApplicability = formData.getAll("statutory_applicability").map(String).filter(Boolean);

  if (!/^\d{6,15}$/.test(mobile)) throw new Error("Mobile number must contain 6 to 15 digits.");
  if (biometricId && !/^\d{1,20}$/.test(biometricId)) throw new Error("Biometric enrolment ID must be numeric.");
  if (emergencyContactNumber && !/^\d{10}$/.test(emergencyContactNumber)) throw new Error("Emergency contact number must contain exactly 10 digits.");
  if (aadhaarNumber && !/^\d{12}$/.test(aadhaarNumber)) throw new Error("Aadhaar number must contain exactly 12 digits.");
  if (postalPin && !/^\d{6}$/.test(postalPin)) throw new Error("Postal PIN must contain exactly 6 digits.");
  if (eshramUan && !/^\d{12}$/.test(eshramUan)) throw new Error("eShram UAN must contain exactly 12 digits.");
  if (panNumber && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panNumber)) throw new Error("PAN number format is invalid.");
  if (ifscCode && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode)) throw new Error("IFSC format is invalid.");
  if (bankAccountNo && !/^[A-Z0-9]+$/.test(bankAccountNo)) throw new Error("Bank account number can contain only letters and numbers.");
  if (pfUan && !/^\d{12}$/.test(pfUan)) throw new Error("PF UAN must contain exactly 12 digits.");
  if (pfAccountNo && !/^[A-Z0-9]+$/.test(pfAccountNo)) throw new Error("PF Account No can contain only letters and numbers.");
  if (esiNo && !/^[A-Z0-9]+$/.test(esiNo)) throw new Error("ESI No can contain only letters and numbers.");

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
      pf_uan: pfUan,
      pf_account_no: pfAccountNo,
      esi_no: esiNo,
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
      statutory_applicability: statutoryApplicability.length ? statutoryApplicability : ["not_applicable"],
      is_active: isActive
    }
  };
}

export async function createFieldExecutive(formData: FormData) {
  const returnPath = safeReturnPath(formData);
  const config = nonEmployeeConfigForRoute(returnPath);
  const table = config.table;
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
    const designationRuleResult = await supabaseAdmin.from("designations")
      .select("id, code, designation_category:designation_categories!designations_designation_category_id_fkey(id, code, name, people_module, is_active), onboarding_categories, registration_category_code, profile_field_rules, onboarding_role_ids, portal_permissions")
      .eq("company_id", companyId)
      .eq("name", designation)
      .eq("is_active", true)
      .maybeSingle();
    if (designationRuleResult.error) throw new Error(designationRuleResult.error.message);
    if (!designationRuleResult.data) throw new Error("Selected designation is not available.");
    requireDesignationPeopleModule(designationRuleResult.data, returnPath);
    requireDesignationOnboardingAccess(designationRuleResult.data, authorization);
    requireDesignationPortalAccess(designationRuleResult.data, currentAccessSurface(), "add", { isOwner: isCompanyOwner(authorization) });
    const registrationCategory = registrationCategoryForDesignation(
      designationRuleResult.data,
      config.designationCategory
    );
    const configuredDirectActivate = await loadWorkforceCategoryDirectActivate(companyId, registrationCategory);
    // Delivery-associate / field-executive profiles always pass through the HO
    // Workforce Lifecycle queue. Direct activation remains available only for
    // the other independently configured engagement types.
    const canonicalOnboarding = config.profileType === "workforce" || config.profileType === "field_executive";
    const directActivate = !canonicalOnboarding && configuredDirectActivate;
    const directPayload = directActivate ? normalizeFieldExecutivePayload(formData).payload : null;
    const dashboardRules = directActivate
      ? (await loadWorkforceCategoryRules(
        companyId,
        registrationCategory,
        designationRuleResult.data.profile_field_rules,
        registrationCategory
      )).dashboard
      : { enabled: [] as string[], required: [] as string[] };

    if (directPayload) {
      const payloadKeys: Record<string, keyof typeof directPayload> = {
        gender: "gender", date_of_birth: "date_of_birth", aadhaar_number: "aadhaar_number", pan_number: "pan_number",
        eshram_uan: "eshram_uan", father_name: "father_name", blood_group: "blood_group", is_handicapped: "is_handicapped",
        address: "address", state_code: "state_code", pincode: "postal_pin", landmark: "landmark",
        bank_account_no: "bank_account_no", ifsc: "ifsc_code", pf_uan: "pf_uan", pf_account_no: "pf_account_no",
        esi_no: "esi_no", driving_license_no: "driving_license_no", driving_license_exp_date: "driving_license_exp_date",
        vehicle_reg_no: "vehicle_reg_no", vehicle_reg_exp_date: "vehicle_reg_exp_date",
        vehicle_insurance_exp_date: "vehicle_insurance_exp_date", vehicle_pollution_exp_date: "vehicle_pollution_exp_date",
        emergency_contact_name: "emergency_contact_name", emergency_contact_number: "emergency_contact_number",
        emergency_contact_relation: "emergency_contact_relation"
      };
      for (const key of dashboardRules.required) {
        const documentField = fieldExecutiveDocumentFields.find((field) => field.ruleKey === key);
        if (documentField) {
          const file = formData.get(documentField.formKey);
          if (!(file instanceof File) || file.size === 0) throw new Error(`${documentField.label} is required.`);
          continue;
        }
        const payloadKey = payloadKeys[key];
        if (payloadKey && !String(directPayload[payloadKey] ?? "").trim()) throw new Error(`${key.replaceAll("_", " ")} is required.`);
      }
    }

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
    const workerCategory = config.category;
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
      fallback: () => generatedDropxId(workerCategory),
      locationId
    });
    const registrationToken = randomBytes(32).toString("base64url");
    const registrationTokenHash = createHash("sha256").update(registrationToken).digest("hex");
    const requestHost = headers().get("host")?.split(":")[0].toLowerCase() ?? "";
    const applicationSource = requestHost === "ops.dropxlogistics.com" || requestHost.startsWith("ops-")
      ? "ops"
      : requestHost === "workforce.dropxlogistics.com" || requestHost.startsWith("workforce-") || (requestHost.endsWith(".vercel.app") && requestHost.includes("workforce"))
        ? "workforce"
        : "dashboard";
    const lifecyclePayload = canonicalOnboarding ? {
      approval_required: true,
      onboarding_application_source: applicationSource,
      onboarding_submitted_at: null,
      provider_id_status: "pending",
      lifecycle_status: "onboarding"
    } : {};
    const canonicalProfileId = config.profileType === "workforce" ? randomUUID() : null;
    const basePayload: Record<string, unknown> = withCompany({
      ...(directPayload ?? {}),
      ...lifecyclePayload,
      full_name: fullName,
      mobile_country_code: mobileCountryCode,
      mobile,
      email,
      date_of_join: dateOfJoin,
      location_id: locationId,
      designation,
      ...(config.profileType === "workforce" ? {
        id: canonicalProfileId,
        designation_id: designationRuleResult.data.id,
        source_profile_type: "canonical",
        source_profile_id: canonicalProfileId,
        compatibility_mode: false,
        migration_state: "canonical",
        synced_at: new Date().toISOString()
      } : {}),
      biometric_id: biometricId,
      dropx_id: dropxId,
      created_by: authorization.userId,
      statutory_applicability: formData.getAll("statutory_applicability").map(String).filter(Boolean).length
        ? formData.getAll("statutory_applicability").map(String).filter(Boolean)
        : ["not_applicable"],
      is_active: config.profileType === "field_executive" ? false : true
    }, companyId);
    const executiveSelect = "id, stations (station_code, station_name, providers (name))";
    let insertResult = await supabaseAdmin.from(table).insert({
      ...basePayload,
      onboarding_token_hash: registrationTokenHash,
      onboarding_token_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      onboarding_status: directActivate ? "active" : "pending"
    }).select(executiveSelect).single();

    const whatsappMigrationMissing = Boolean(insertResult.error?.message.toLowerCase().includes("onboarding_token"));
    if (whatsappMigrationMissing) {
      insertResult = await supabaseAdmin.from(table).insert(basePayload).select(executiveSelect).single();
    }
    const { data: executive, error } = insertResult;

    if (error) {
      const message = error.message.toLowerCase();
      if (message.includes("unique") || message.includes("duplicate")) {
        throw new Error("Field Executive ID is already registered.");
      }
      throw new Error(friendlyFieldExecutiveError(error.message));
    }


    if (directActivate) {
      const documentPayload: Record<string, string> = {};
      const enabled = new Set(dashboardRules.enabled);
      for (const field of fieldExecutiveDocumentFields) {
        if (!enabled.has(field.ruleKey)) continue;
        const uploaded = await uploadProfileDocument({
          companyId,
          documentKey: field.pathKey.replace("_path", ""),
          fileValue: formData.get(field.formKey),
          ownerId: executive.id,
          ownerType: config.profileType
        });
        if (uploaded) documentPayload[field.pathKey] = uploaded.storagePath;
      }
      if (Object.keys(documentPayload).length) {
        const documentUpdate = await supabaseAdmin.from(table).update(documentPayload).eq("id", executive.id).eq("company_id", companyId);
        if (documentUpdate.error) throw new Error(documentUpdate.error.message);
      }
    }

    if (config.profileType !== "field_executive") {
      await syncBiometricEnrolment({
        companyId,
        createdBy: authorization.userId,
        effectiveFrom: dateOfJoin,
        enrolmentId: biometricId,
        accountId: executive.id,
        isActive: true,
        locationId,
        profileType: config.profileType,
        workerType: "individual_contract"
      });
    }

    if (canonicalOnboarding) {
      await supabaseAdmin.from("workforce_onboarding_events").insert({
        company_id: companyId,
        field_executive_id: config.profileType === "field_executive" ? executive.id : null,
        workforce_id: config.profileType === "workforce" ? executive.id : null,
        event_code: "onboarding_requested",
        from_status: null,
        to_status: "pending",
        actor_user_id: authorization.userId,
        source_portal: applicationSource,
        metadata: { designation, location_id: locationId }
      });
    }

    const stationRelation = executive.stations as unknown as { station_code?: string; station_name?: string | null; providers?: { name?: string } | Array<{ name?: string }> | null } | null;
    const providerRelation = Array.isArray(stationRelation?.providers) ? stationRelation?.providers[0] : stationRelation?.providers;
    if (!whatsappMigrationMissing && !directActivate) {
      waitUntil(sendFieldExecutiveOnboardingWhatsApp({
        companyId,
        fieldExecutiveId: executive.id,
        profileType: config.profileType,
        fullName,
        mobile: `${mobileCountryCode}${mobile}`,
        dropxId,
        biometricId: biometricId ?? "",
        workforceCategoryCode: registrationCategory,
        dateOfJoin,
        locationCode: stationRelation?.station_code ?? "",
        locationName: stationRelation?.station_name ?? "",
        providerName: providerRelation?.name ?? "",
        registrationToken,
        triggeredBy: authorization.userId
      }));
    }

    revalidatePath(returnPath);
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    fieldExecutiveRedirect({
      ...addFormParams(formData),
      error: error instanceof Error ? friendlyFieldExecutiveError(error.message) : "Unable to add field executive."
    }, returnPath);
  }

  fieldExecutiveRedirect({
    notice: ["workforce", "field_executive"].includes(config.profileType)
      ? `${entityLabel} onboarding request created. The applicant must submit the profile and agreement before HO activation.`
      : `${entityLabel} added successfully.`
  }, returnPath);
}

function canApproveWorkforceProfileChanges(authorization: Awaited<ReturnType<typeof requirePagePermission>>) {
  const roleCode = String(authorization.roleCode ?? "").trim().toUpperCase();
  return isCompanyOwner(authorization) || ["BH", "BUSINESS_HEAD", "ZONAL_HEAD", "ZONE_HEAD", "ZH"].includes(roleCode);
}

export async function requestFieldExecutiveProfileChange(formData: FormData) {
  const returnPath = safeReturnPath(formData);
  const authorization = await requirePagePermission("delivery_associates", "view");
  const companyId = requireCompanyId(authorization);
  if (returnPath !== "/field-executive" || currentAccessSurface() !== "ops") {
    fieldExecutiveRedirect({ error: "Profile corrections are available from Ops Pulse Workforce Onboarding." }, returnPath);
  }
  if (!supabaseAdmin) fieldExecutiveRedirect({ error: "Supabase service role key is not configured." }, returnPath);

  try {
    const id = required(formData.get("id"), "Field executive");
    const fullName = required(formData.get("full_name"), "Full name").slice(0, 120);
    const mobileCountryCode = cleanCountryCode(formData.get("mobile_country_code"));
    const mobile = required(formData.get("mobile"), "Mobile number").replace(/\D/g, "");
    const email = required(formData.get("email"), "Email").toLowerCase().slice(0, 180);
    const dateOfJoin = required(formData.get("date_of_join"), "Date of join");
    const locationId = required(formData.get("location_id"), "Location");
    const designation = required(formData.get("designation"), "Designation").slice(0, 100);
    if (!/^\d{10}$/.test(mobile)) throw new Error("Mobile number must contain exactly 10 digits.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
    const parsedDateOfJoin = new Date(`${dateOfJoin}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfJoin) || Number.isNaN(parsedDateOfJoin.getTime()) || parsedDateOfJoin.toISOString().slice(0, 10) !== dateOfJoin) {
      throw new Error("Enter a valid joining date.");
    }

    const target = await supabaseAdmin
      .from("field_executives")
      .select("id,full_name,mobile_country_code,mobile,email,date_of_join,location_id,designation,created_by,onboarding_status,stations(station_code)")
      .eq("company_id", companyId)
      .eq("id", id)
      .maybeSingle();
    if (target.error) throw new Error(target.error.message);
    if (!target.data) throw new Error("Workforce profile was not found.");
    if (String(target.data.created_by ?? "") !== authorization.userId) {
      throw new Error("You can only correct profiles that you initiated.");
    }
    if (!authorization.hasAllLocationAccess && !authorization.locationScopeIds.includes(locationId)) {
      throw new Error("You do not have access to the selected location.");
    }

    const [locationResult, designationResult] = await Promise.all([
      supabaseAdmin.from("stations")
        .select("id,station_code")
        .eq("company_id", companyId)
        .eq("id", locationId)
        .eq("is_active", true)
        .maybeSingle(),
      supabaseAdmin.from("designations")
        .select("code,designation_category:designation_categories!designations_designation_category_id_fkey(id, code, name, people_module, is_active),portal_permissions")
        .eq("company_id", companyId)
        .eq("name", designation)
        .eq("is_active", true)
        .maybeSingle()
    ]);
    if (locationResult.error || designationResult.error) {
      throw new Error(locationResult.error?.message || designationResult.error?.message);
    }
    if (!locationResult.data) throw new Error("Selected location is not available.");
    if (!designationResult.data) throw new Error("Selected designation is not available.");
    if (designation !== String(target.data.designation ?? "")) {
      requireDesignationPeopleModule(designationResult.data, returnPath);
    }
    requireDesignationPortalAccess(designationResult.data, "ops", "view", { isOwner: isCompanyOwner(authorization) });

    const [mobileDuplicate, emailDuplicate, pendingRequest] = await Promise.all([
      supabaseAdmin.from("field_executives").select("id").eq("company_id", companyId).eq("mobile", mobile).neq("id", id).limit(1),
      supabaseAdmin.from("field_executives").select("id").eq("company_id", companyId).ilike("email", email).neq("id", id).limit(1),
      supabaseAdmin.from("workforce_profile_change_requests").select("id").eq("company_id", companyId).eq("field_executive_id", id).eq("status", "pending").maybeSingle()
    ]);
    const lookupError = mobileDuplicate.error || emailDuplicate.error || pendingRequest.error;
    if (lookupError) throw new Error(lookupError.message);
    if ((mobileDuplicate.data ?? []).length || (emailDuplicate.data ?? []).length) {
      throw new Error("The requested mobile number or email is already linked to another Workforce profile.");
    }
    if (pendingRequest.data) throw new Error("A profile correction is already waiting for approval.");

    const currentStation = Array.isArray(target.data.stations) ? target.data.stations[0] : target.data.stations;
    const currentValues = {
      full_name: target.data.full_name,
      mobile_country_code: target.data.mobile_country_code,
      mobile: target.data.mobile,
      email: target.data.email,
      date_of_join: target.data.date_of_join,
      location_id: target.data.location_id,
      location_code: currentStation?.station_code ?? null,
      designation: target.data.designation
    };
    const proposedValues = {
      full_name: fullName,
      mobile_country_code: mobileCountryCode,
      mobile,
      email,
      date_of_join: dateOfJoin,
      location_id: locationId,
      location_code: locationResult.data.station_code,
      designation
    };
    if (JSON.stringify(currentValues) === JSON.stringify(proposedValues)) {
      throw new Error("Change at least one invitation detail before submitting.");
    }

    const inserted = await supabaseAdmin.from("workforce_profile_change_requests").insert({
      company_id: companyId,
      field_executive_id: id,
      requested_by: authorization.userId,
      status: "pending",
      current_values: currentValues,
      proposed_values: proposedValues
    }).select("id").single();
    if (inserted.error) throw new Error(inserted.error.message);
    const event = await supabaseAdmin.from("workforce_onboarding_events").insert({
      company_id: companyId,
      field_executive_id: id,
      event_code: "profile_change_requested",
      from_status: target.data.onboarding_status ?? null,
      to_status: "pending_change_approval",
      remarks: `Invitation-detail correction requested by ${authorization.fullName || authorization.email || "Ops Pulse user"}.`,
      actor_user_id: authorization.userId,
      source_portal: "ops",
      metadata: { change_request_id: inserted.data.id, approval_roles: ["BH", "BUSINESS_HEAD", "OWNER"] }
    });
    if (event.error) console.warn("Unable to write profile correction event:", event.error.message);
    revalidatePath(returnPath);
    fieldExecutiveRedirect({ notice: "Profile correction sent to the Business Head and Owner for approval." }, returnPath);
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    fieldExecutiveRedirect({ error: error instanceof Error ? error.message : "Unable to request the profile correction." }, returnPath);
  }
}

export async function reviewFieldExecutiveProfileChange(formData: FormData) {
  const returnPath = safeReturnPath(formData);
  const authorization = await requirePagePermission("delivery_associates", "view");
  const companyId = requireCompanyId(authorization);
  if (returnPath !== "/field-executive" || currentAccessSurface() !== "ops") {
    fieldExecutiveRedirect({ error: "Profile correction approvals are available from Ops Pulse." }, returnPath);
  }
  if (!canApproveWorkforceProfileChanges(authorization)) {
    fieldExecutiveRedirect({ error: "Only a Business Head or Owner can approve profile corrections." }, returnPath);
  }
  if (!supabaseAdmin) fieldExecutiveRedirect({ error: "Supabase service role key is not configured." }, returnPath);

  try {
    const requestId = required(formData.get("request_id"), "Profile change request");
    const decision = required(formData.get("decision"), "Decision").toLowerCase();
    const reviewNote = String(formData.get("review_note") ?? "").trim().slice(0, 1000);
    if (!["approved", "rejected"].includes(decision)) throw new Error("Choose Approve or Reject.");
    if (decision === "rejected" && !reviewNote) throw new Error("Enter a rejection reason.");
    const pending = await supabaseAdmin.from("workforce_profile_change_requests")
      .select("id,field_executive_id,proposed_values")
      .eq("company_id", companyId)
      .eq("id", requestId)
      .eq("status", "pending")
      .maybeSingle();
    if (pending.error) throw new Error(pending.error.message);
    if (!pending.data) throw new Error("Pending profile change request was not found.");
    const target = await supabaseAdmin.from("field_executives")
      .select("location_id")
      .eq("company_id", companyId)
      .eq("id", pending.data.field_executive_id)
      .maybeSingle();
    if (target.error) throw new Error(target.error.message);
    if (!target.data) throw new Error("Workforce profile was not found.");
    const proposedLocationId = String((pending.data.proposed_values as Record<string, unknown> | null)?.location_id ?? "");
    if (!authorization.hasAllLocationAccess && (
      !authorization.locationScopeIds.includes(String(target.data.location_id ?? "")) ||
      !authorization.locationScopeIds.includes(proposedLocationId)
    )) {
      throw new Error("You can only review profile corrections within your location scope.");
    }

    const reviewed = await supabaseAdmin.rpc("review_workforce_profile_change_request", {
      p_company_id: companyId,
      p_request_id: requestId,
      p_approver_id: authorization.userId,
      p_decision: decision,
      p_review_note: reviewNote || null
    });
    if (reviewed.error) throw new Error(reviewed.error.message);
    const event = await supabaseAdmin.from("workforce_onboarding_events").insert({
      company_id: companyId,
      field_executive_id: pending.data.field_executive_id,
      event_code: decision === "approved" ? "profile_change_approved" : "profile_change_rejected",
      from_status: "pending_change_approval",
      to_status: decision,
      remarks: reviewNote || `Profile correction ${decision} by ${authorization.fullName || authorization.email || "approver"}.`,
      actor_user_id: authorization.userId,
      source_portal: "ops",
      metadata: { change_request_id: requestId, approver_role: authorization.roleCode }
    });
    if (event.error) console.warn("Unable to write profile correction review event:", event.error.message);
    revalidatePath(returnPath);
    fieldExecutiveRedirect({ notice: decision === "approved" ? "Profile correction approved and applied." : "Profile correction rejected." }, returnPath);
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    fieldExecutiveRedirect({ error: error instanceof Error ? error.message : "Unable to review the profile correction." }, returnPath);
  }
}

export async function updateFieldExecutive(formData: FormData) {
  const returnPath = safeReturnPath(formData);
  const config = nonEmployeeConfigForRoute(returnPath);
  const table = config.table;
  const entityLabel = entityLabelForReturnPath(returnPath);
  const authorization = await requirePagePermission(pageCodeForReturnPath(returnPath), "edit");
  const companyId = requireCompanyId(authorization);
  if (!supabaseAdmin) fieldExecutiveRedirect({ error: "Supabase service role key is not configured." }, returnPath);

  try {
    const { id, payload } = normalizeFieldExecutivePayload(formData, true);
    if (!id) throw new Error("Field executive is required.");
    const executiveId = id;
    const existingResult = await supabaseAdmin
      .from(table)
      .select("biometric_id, designation, aadhaar_front_path, aadhaar_back_path, pan_upload_path, dl_front_path, dl_back_path, profile_photo_path")
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
      .select("id, code, designation_category:designation_categories!designations_designation_category_id_fkey(id, code, name, people_module, is_active), onboarding_categories, registration_category_code, profile_field_rules, portal_permissions")
      .eq("company_id", companyId)
      .eq("name", payload.designation)
      .eq("is_active", true)
      .maybeSingle();
    if (designationResult.error) throw new Error(designationResult.error.message);
    if (!designationResult.data) throw new Error("Selected designation is not available.");
    if (payload.designation !== String((existingResult.data as { designation?: string | null } | null)?.designation ?? "")) {
      requireDesignationPeopleModule(designationResult.data, returnPath);
    }
    requireDesignationPortalAccess(designationResult.data, currentAccessSurface(), "edit", { isOwner: isCompanyOwner(authorization) });
    const registrationCategory = registrationCategoryForDesignation(
      designationResult.data,
      config.designationCategory
    );
    const dashboardRules = (await loadWorkforceCategoryRules(
      companyId,
      registrationCategory,
      designationResult.data?.profile_field_rules,
      registrationCategory
    )).dashboard;
    const dashboardEnabled = new Set(dashboardRules.enabled);
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
      pf_uan: "pf_uan",
      pf_account_no: "pf_account_no",
      esi_no: "esi_no",
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
    if (config.profileType !== "field_executive" && config.profileType !== "contractor") {
      for (const key of dashboardRules.required) {
        const payloadKey = profilePayloadKeys[key];
        if (payloadKey && !String(payload[payloadKey] ?? "").trim()) {
          throw new Error(`${key.replaceAll("_", " ")} is required.`);
        }
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
      ...(config.profileType === "workforce" ? { designation_id: designationResult.data.id } : {}),
      biometric_id: payload.biometric_id,
      is_active: payload.is_active,
      statutory_applicability: payload.statutory_applicability
    };

    const documentPayload: Record<string, string> = {};
    const existingPaths = existingResult.data as Record<string, string | null> | null;
    for (const field of fieldExecutiveDocumentFields) {
      if (!dashboardEnabled.has(field.ruleKey)) continue;
      const uploaded = await uploadProfileDocument({
        companyId,
        documentKey: field.pathKey.replace("_path", ""),
        fileValue: formData.get(field.formKey),
        ownerId: executiveId,
        ownerType: config.profileType
      });
      if (!uploaded) continue;
      const oldPath = existingPaths?.[field.pathKey] ?? null;
      if (oldPath) {
        await moveProfileDocumentToTrash({
          companyId,
          ownerId: executiveId,
          ownerType: config.profileType,
          documentLabel: field.label,
          fileName: oldPath.split("/").pop(),
          storagePath: oldPath,
          replacedBy: authorization.userId
        });
      }
      documentPayload[field.pathKey] = uploaded.storagePath;
    }

    const { error } = await supabaseAdmin
      .from(table)
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
      profileType: config.profileType,
      values: formData.getAll("profile_verification_results")
    });

    await syncBiometricEnrolment({
      companyId,
      createdBy: authorization.userId,
      effectiveFrom: payload.date_of_join,
      enrolmentId: payload.biometric_id,
      accountId: executiveId,
      isActive: Boolean(payload.is_active),
      locationId: payload.location_id,
      profileType: config.profileType,
      workerType: "individual_contract"
    });

    revalidatePath(returnPath);
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    fieldExecutiveRedirect({ edit: String(formData.get("id") ?? ""), error: error instanceof Error ? friendlyFieldExecutiveError(error.message) : "Unable to update field executive." }, returnPath);
  }

  fieldExecutiveRedirect({ notice: `${entityLabel} updated successfully.` }, returnPath);
}

export async function reviewFieldExecutiveProfile(formData: FormData) {
  const returnPath = safeReturnPath(formData);
  const table = tableForReturnPath(returnPath);
  const entityLabel = entityLabelForReturnPath(returnPath);
  const authorization = await requirePagePermission(pageCodeForReturnPath(returnPath), "edit");
  const companyId = requireCompanyId(authorization);
  if (!supabaseAdmin) fieldExecutiveRedirect({ error: "Supabase service role key is not configured." }, returnPath);

  if (nonEmployeeConfigForRoute(returnPath).profileType === "field_executive") {
    fieldExecutiveRedirect({
      error: "Delivery Associate activation is controlled in People → Workforce Lifecycle so the agreement, provider ID and HO checklist cannot be bypassed."
    }, returnPath);
  }

  const id = String(formData.get("id") ?? "").trim();
  const action = String(formData.get("review_action") ?? "").trim().toLowerCase();
  const remarks = String(formData.get("return_remarks") ?? "").trim();

  try {
    if (!id) throw new Error(`${entityLabel} is required.`);
    if (!["approve", "return"].includes(action)) throw new Error("Choose a valid review action.");
    if (action === "return" && !remarks) throw new Error("Return remarks are required.");

    const current = await supabaseAdmin
      .from(table)
      .select("onboarding_status, designation")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (current.error) throw new Error(current.error.message);
    if (!current.data) throw new Error(`${entityLabel} was not found.`);
    const reviewDesignation = await supabaseAdmin
      .from("designations")
      .select("designation_category:designation_categories!designations_designation_category_id_fkey(id, code, name, people_module, is_active),portal_permissions")
      .eq("company_id", companyId)
      .eq("name", String(current.data.designation ?? ""))
      .eq("is_active", true)
      .maybeSingle();
    if (reviewDesignation.error) throw new Error(reviewDesignation.error.message);
    if (!reviewDesignation.data) throw new Error("Selected designation is not available.");
    requireDesignationPortalAccess(reviewDesignation.data, currentAccessSurface(), "edit", { isOwner: isCompanyOwner(authorization) });
    if (String(current.data.onboarding_status ?? "").toLowerCase() !== "under_review") {
      throw new Error("Only profiles under review can be approved or returned.");
    }

    const profileType = nonEmployeeConfigForRoute(returnPath).profileType;
    if (action === "approve") {
      const unresolved = await supabaseAdmin
        .from("connect_profile_verifications")
        .select("kind, message")
        .eq("company_id", companyId)
        .eq("profile_type", profileType)
        .eq("account_id", id)
        .or("manual_review.eq.true,block_submit.eq.true")
        .limit(10);
      if (unresolved.error && !isMissingVerificationTable(unresolved.error)) throw new Error(unresolved.error.message);
      if (unresolved.data?.length) {
        const fields = unresolved.data.map((row) => String(row.kind).replaceAll("_", " ").toUpperCase());
        throw new Error(`Resolve and re-verify ${fields.join(", ")} before approving this profile.`);
      }
    }

    const reviewedAt = new Date().toISOString();
    const update = action === "approve"
      ? {
          onboarding_status: "active",
          profile_return_remarks: null,
          profile_returned_at: null,
          updated_at: reviewedAt
        }
      : {
          onboarding_status: "returned",
          profile_return_remarks: remarks,
          profile_returned_at: reviewedAt,
          updated_at: reviewedAt
        };
    const result = await supabaseAdmin
      .from(table)
      .update(update)
      .eq("id", id)
      .eq("company_id", companyId);
    if (result.error) throw new Error(result.error.message);
    await createAppNotification({
      accountId: id,
      companyId,
      data: action === "return" ? { remarks } : {},
      eventCode: action === "approve" ? "profile_approved" : "profile_returned",
      profileType,
      sourceKey: `${id}:${action}:${reviewedAt}`,
      variables: { remarks }
    });

    revalidatePath(returnPath);
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
  const config = nonEmployeeConfigForRoute(returnPath);
  const table = config.table;
  const entityLabel = entityLabelForReturnPath(returnPath);
  const authorization = await requirePagePermission(pageCodeForReturnPath(returnPath), "add");
  const companyId = requireCompanyId(authorization);
  if (!supabaseAdmin) fieldExecutiveRedirect({ error: "Supabase service role key is not configured." }, returnPath);
  const inserted: { id: string; locationId: string; biometricId: string | null; dateOfJoin: string }[] = [];
  const requestHost = headers().get("host")?.split(":")[0].toLowerCase() ?? "";
  const applicationSource = requestHost === "ops.dropxlogistics.com" || requestHost.startsWith("ops-")
    ? "ops"
    : requestHost === "workforce.dropxlogistics.com" || requestHost.startsWith("workforce-") || (requestHost.endsWith(".vercel.app") && requestHost.includes("workforce"))
      ? "workforce"
      : "dashboard";

  try {
    if (currentAccessSurface() === "ops") {
      throw new Error("Bulk workforce onboarding is not available in OpsPulse. Submit one onboarding request at a time.");
    }
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
        .from(table)
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
      supabaseAdmin.from("designations").select("id, code, name, designation_category:designation_categories!designations_designation_category_id_fkey(id, code, name, people_module, is_active), onboarding_categories, onboarding_role_ids, portal_permissions").eq("company_id", companyId).eq("is_active", true).in("code", designationCodes)
    ]);
    if (locationsResult.error) throw new Error(locationsResult.error.message);
    if (designationsResult.error) throw new Error(designationsResult.error.message);

    const locations = new Map((locationsResult.data ?? []).map((location) => [String(location.station_code).toUpperCase(), String(location.id)]));
    const designations = new Map((designationsResult.data ?? []).map((designation) => [String(designation.code).toUpperCase(), {
      id: String(designation.id),
      name: String(designation.name),
      designation_category: designation.designation_category,
      onboarding_role_ids: designation.onboarding_role_ids,
      portal_permissions: designation.portal_permissions,
      workerCategory: config.category
    }]));

    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 2;
      const locationId = locations.get(row.locationCode);
      const designation = designations.get(row.designationCode);
      if (!locationId) throw new Error(`Row ${rowNumber}: Location ${row.locationCode} not found.`);
      if (!designation) throw new Error(`Row ${rowNumber}: Designation code ${row.designationCode} not found.`);
      requireDesignationPeopleModule(designation, returnPath);
      requireDesignationOnboardingAccess(designation, authorization);
      requireDesignationPortalAccess(designation, currentAccessSurface(), "add", { isOwner: isCompanyOwner(authorization) });
      await assertWorkerDesignationMappedToIdSeries({ companyId, designationId: designation.id });
      if (!authorization.hasAllLocationAccess && !authorization.locationScopeIds.includes(locationId)) {
        throw new Error(`Row ${rowNumber}: You do not have access to location ${row.locationCode}.`);
      }

      const dropxId = row.dropxId || await generateConfiguredWorkerId({
        category: designation.workerCategory,
        companyId,
        designationId: designation.id,
        fallback: () => generatedDropxId(config.category),
        locationId
      });
      const biometricId = row.biometricId || await generateConfiguredBiometricId({
        category: designation.workerCategory,
        companyId,
        designationId: designation.id,
        fallback: () => generateBiometricEnrolmentId(companyId),
        locationId
      });

      const canonicalProfileId = config.profileType === "workforce" ? randomUUID() : null;
      const insertResult = await supabaseAdmin.from(table).insert(withCompany({
        ...(config.profileType === "workforce" ? {
          id: canonicalProfileId,
          designation_id: designation.id,
          source_profile_type: "canonical",
          source_profile_id: canonicalProfileId,
          compatibility_mode: false,
          migration_state: "canonical",
          synced_at: new Date().toISOString()
        } : {}),
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
        ...(["workforce", "field_executive"].includes(config.profileType) ? {
          approval_required: true,
          onboarding_application_source: applicationSource,
          provider_id_status: "pending",
          lifecycle_status: "onboarding"
        } : {}),
        is_active: config.profileType === "field_executive" ? false : true
      }, companyId)).select("id").single();
      if (insertResult.error) throw new Error(`Row ${rowNumber}: ${friendlyFieldExecutiveError(insertResult.error.message)}`);
      inserted.push({ id: insertResult.data.id, locationId, biometricId, dateOfJoin: row.dateOfJoin });
    }

    for (const row of inserted) {
      if (["workforce", "field_executive"].includes(config.profileType)) {
        await supabaseAdmin.from("workforce_onboarding_events").insert({
          company_id: companyId,
          field_executive_id: config.profileType === "field_executive" ? row.id : null,
          workforce_id: config.profileType === "workforce" ? row.id : null,
          event_code: "onboarding_requested",
          to_status: "pending",
          actor_user_id: authorization.userId,
          source_portal: applicationSource,
          metadata: { bulk_import: true, location_id: row.locationId }
        });
        continue;
      }
      await syncBiometricEnrolment({
        companyId,
        createdBy: authorization.userId,
        effectiveFrom: row.dateOfJoin,
        enrolmentId: row.biometricId,
        accountId: row.id,
        isActive: true,
        locationId: row.locationId,
        profileType: config.profileType,
        workerType: "individual_contract"
      });
    }

    revalidatePath(returnPath);
    fieldExecutiveRedirect({
      notice: ["workforce", "field_executive"].includes(config.profileType)
        ? `${inserted.length} workforce onboarding requests imported. Activation remains pending candidate submission and HO approval.`
        : `${inserted.length} ${entityLabel.toLowerCase()} records imported successfully.`
    }, returnPath);
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    if (inserted.length) {
      const insertedIds = inserted.map((row) => row.id);
      await supabaseAdmin.from("biometric_enrolments").delete().in("field_executive_id", insertedIds);
      await supabaseAdmin.from(table).delete().eq("company_id", companyId).in("id", insertedIds);
    }
    fieldExecutiveRedirect({ error: error instanceof Error ? friendlyFieldExecutiveError(error.message) : "Unable to import field executives." }, returnPath);
  }
}
