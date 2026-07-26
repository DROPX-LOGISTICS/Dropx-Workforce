import { createHash } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { connectSessionCookieName, findConnectAccounts } from "../../../../src/lib/connect-auth";
import { saveProfileVerifications } from "../../../../src/lib/profile-verifications";
import { supabaseAdmin } from "../../../../src/lib/supabase-admin";
import { loadWorkforceCategoryRules } from "../../../../src/lib/workforce-category-rules";
import {
  isNonEmployeeProfileType,
  profileFieldRuleCategory,
  type NonEmployeeProfileType,
  workforceLabel,
  workforceTable
} from "../../../../src/lib/workforce-profiles";

type FieldExecutiveRow = {
  id: string;
  company_id: string;
  dropx_id: string | null;
  full_name: string;
  email: string | null;
  mobile_country_code?: string | null;
  mobile: string;
  date_of_join: string | null;
  location_id: string | null;
  designation: string | null;
  gender: string | null;
  date_of_birth: string | null;
  aadhaar_number: string | null;
  pan_number: string | null;
  eshram_uan?: string | null;
  address: string | null;
  postal_pin: string | null;
  landmark: string | null;
  state_code: string | null;
  father_name: string | null;
  blood_group: string | null;
  is_handicapped: boolean | null;
  bank_account_no: string | null;
  ifsc_code: string | null;
  pf_uan?: string | null;
  pf_account_no?: string | null;
  esi_no?: string | null;
  driving_license_no: string | null;
  driving_license_exp_date: string | null;
  vehicle_reg_no: string | null;
  vehicle_reg_exp_date: string | null;
  vehicle_insurance_exp_date: string | null;
  vehicle_pollution_exp_date: string | null;
  biometric_id: string | null;
  emergency_contact_name: string | null;
  emergency_contact_number: string | null;
  emergency_contact_relation: string | null;
  aadhaar_front_path: string | null;
  aadhaar_back_path: string | null;
  pan_upload_path: string | null;
  dl_front_path: string | null;
  dl_back_path: string | null;
  profile_photo_path: string | null;
  onboarding_status: string | null;
  profile_return_remarks?: string | null;
  stations?: { station_code: string | null; station_name: string | null } | { station_code: string | null; station_name: string | null }[] | null;
};

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function cleanText(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function cleanDigits(value: FormDataEntryValue | null) {
  const text = String(value ?? "").replace(/\D/g, "");
  return text || null;
}

function requiredText(value: FormDataEntryValue | null, label: string) {
  const text = cleanText(value);
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function requiredDigits(value: FormDataEntryValue | null, label: string) {
  const text = cleanDigits(value);
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function requiredPan(value: FormDataEntryValue | null) {
  const text = requiredText(value, "PAN number").toUpperCase();
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(text)) {
    throw new Error("PAN number format is invalid.");
  }
  return text;
}

function alphaNumValue(value: FormDataEntryValue | null, label: string, required = false) {
  const text = cleanText(value)?.toUpperCase() ?? null;
  if (!text) {
    if (required) throw new Error(`${label} is required.`);
    return null;
  }
  if (!/^[A-Z0-9]+$/.test(text)) throw new Error(`${label} can contain only letters and numbers.`);
  return text;
}

function requiredTwelveDigits(value: FormDataEntryValue | null, label: string) {
  const text = requiredDigits(value, label);
  if (!/^\d{12}$/.test(text)) throw new Error(`${label} must contain exactly 12 digits.`);
  return text;
}

function formatDisplayDate(value: string | null) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value ?? "-";
}

function fileExt(name: string) {
  const ext = name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
  return ext ? `.${ext}` : "";
}

function normalizeDate(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const displayMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const isoValue = isoMatch ? text : displayMatch ? `${displayMatch[3]}-${displayMatch[2]}-${displayMatch[1]}` : null;
  if (!isoValue) throw new Error("Enter date as dd/mm/yyyy.");
  const [year, month, day] = isoValue.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error("Enter a valid date.");
  }
  return isoValue;
}

async function loadSessionAccounts() {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const token = cookies().get(connectSessionCookieName)?.value;
  if (!token) throw new Error("Connect session expired. Please log in again.");
  const sessionHash = createHash("sha256").update(token).digest("hex");
  const sessionResult = await supabaseAdmin
    .from("connect_login_sessions")
    .select("id, country_code, mobile_number, expires_at, revoked_at")
    .eq("session_hash", sessionHash)
    .maybeSingle();
  if (sessionResult.error) throw new Error(sessionResult.error.message);
  const session = sessionResult.data;
  if (!session || session.revoked_at || new Date(session.expires_at).getTime() < Date.now()) {
    cookies().delete(connectSessionCookieName);
    throw new Error("Connect session expired. Please log in again.");
  }
  return findConnectAccounts(session.country_code, session.mobile_number);
}

async function requireExecutiveAccess(executiveId: string, profileType: string) {
  if (!isNonEmployeeProfileType(profileType)) throw new Error("Invalid workforce profile type.");
  const accounts = await loadSessionAccounts();
  const account = accounts.find((item) => item.profileType === profileType && item.id === executiveId);
  if (!account) throw new Error("Workforce profile is not available for this login.");
  return { ...account, profileType };
}

async function loadExecutive(executiveId: string, companyId: string, profileType: NonEmployeeProfileType) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const table = workforceTable(profileType);
  const result = await supabaseAdmin
    .from(table)
    .select("id, company_id, dropx_id, full_name, email, mobile_country_code, mobile, date_of_join, location_id, designation, gender, date_of_birth, aadhaar_number, pan_number, eshram_uan, address, postal_pin, landmark, state_code, father_name, blood_group, is_handicapped, bank_account_no, ifsc_code, pf_uan, pf_account_no, esi_no, driving_license_no, driving_license_exp_date, vehicle_reg_no, vehicle_reg_exp_date, vehicle_insurance_exp_date, vehicle_pollution_exp_date, biometric_id, emergency_contact_name, emergency_contact_number, emergency_contact_relation, aadhaar_front_path, aadhaar_back_path, pan_upload_path, dl_front_path, dl_back_path, profile_photo_path, onboarding_status, profile_return_remarks, stations (station_code, station_name)")
    .eq("id", executiveId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (result.error && /eshram_uan|column/i.test(result.error.message)) {
    const fallbackResult = await supabaseAdmin
      .from(table)
      .select("id, company_id, dropx_id, full_name, email, mobile_country_code, mobile, date_of_join, location_id, designation, gender, date_of_birth, aadhaar_number, pan_number, address, postal_pin, landmark, state_code, father_name, blood_group, is_handicapped, bank_account_no, ifsc_code, driving_license_no, driving_license_exp_date, vehicle_reg_no, vehicle_reg_exp_date, vehicle_insurance_exp_date, vehicle_pollution_exp_date, biometric_id, emergency_contact_name, emergency_contact_number, emergency_contact_relation, aadhaar_front_path, aadhaar_back_path, pan_upload_path, dl_front_path, dl_back_path, profile_photo_path, onboarding_status, profile_return_remarks, stations (station_code, station_name)")
      .eq("id", executiveId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (fallbackResult.error) throw new Error(fallbackResult.error.message);
    if (!fallbackResult.data) throw new Error(`${workforceLabel(profileType)} profile was not found.`);
    return { ...fallbackResult.data, eshram_uan: null } as FieldExecutiveRow;
  }
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error(`${workforceLabel(profileType)} profile was not found.`);
  return result.data as FieldExecutiveRow;
}

async function signedProfileUrl(path: string | null) {
  if (!supabaseAdmin || !path) return "";
  const result = await supabaseAdmin.storage
    .from("employee-profile-documents")
    .createSignedUrl(path, 60 * 60);
  return result.data?.signedUrl ?? "";
}

async function serializeExecutive(row: FieldExecutiveRow, profileType: NonEmployeeProfileType) {
  const station = firstRelation(row.stations);
  const designationResult = row.designation && supabaseAdmin
    ? await supabaseAdmin
      .from("designations")
      .select("profile_field_rules")
      .eq("company_id", row.company_id)
      .eq("name", row.designation)
      .maybeSingle()
    : null;
  const categoryCode = profileFieldRuleCategory(profileType);
  const fieldRules = (await loadWorkforceCategoryRules(
    row.company_id,
    categoryCode,
    designationResult?.data?.profile_field_rules,
    categoryCode
  )).dropx_one;
  return {
    id: row.id,
    readOnly: {
      reference: row.dropx_id ?? "-",
      biometricId: row.biometric_id ?? "-",
      fullName: row.full_name,
      email: row.email ?? "-",
      location: station?.station_code ?? "-",
      designation: row.designation ?? workforceLabel(profileType),
      dateOfJoin: formatDisplayDate(row.date_of_join),
      mobile: `+${row.mobile_country_code ?? "91"} ${row.mobile}`
    },
    editable: {
      gender: row.gender ?? "",
      dateOfBirth: formatDisplayDate(row.date_of_birth) === "-" ? "" : formatDisplayDate(row.date_of_birth),
      aadhaarNumber: row.aadhaar_number ?? "",
      panNumber: row.pan_number ?? "",
      eshramUan: row.eshram_uan ?? "",
      fatherName: row.father_name ?? "",
      bloodGroup: row.blood_group ?? "",
      isHandicapped: typeof row.is_handicapped === "boolean" ? String(row.is_handicapped) : "",
      address: row.address ?? "",
      stateCode: row.state_code ?? "",
      pincode: row.postal_pin ?? "",
      landmark: row.landmark ?? "",
      bankAccountNo: row.bank_account_no ?? "",
      ifsc: row.ifsc_code ?? "",
      pfUan: row.pf_uan ?? "",
      pfAccountNo: row.pf_account_no ?? "",
      esiNo: row.esi_no ?? "",
      emergencyContactName: row.emergency_contact_name ?? "",
      emergencyContactNumber: row.emergency_contact_number ?? "",
      emergencyContactRelation: row.emergency_contact_relation ?? "",
      drivingLicenseNo: row.driving_license_no ?? "",
      drivingLicenseExpiry: formatDisplayDate(row.driving_license_exp_date) === "-" ? "" : formatDisplayDate(row.driving_license_exp_date),
      vehicleRegistrationNo: row.vehicle_reg_no ?? "",
      registrationExpiry: formatDisplayDate(row.vehicle_reg_exp_date) === "-" ? "" : formatDisplayDate(row.vehicle_reg_exp_date),
      insuranceExpiry: formatDisplayDate(row.vehicle_insurance_exp_date) === "-" ? "" : formatDisplayDate(row.vehicle_insurance_exp_date),
      pollutionExpiry: formatDisplayDate(row.vehicle_pollution_exp_date) === "-" ? "" : formatDisplayDate(row.vehicle_pollution_exp_date)
    },
    statutoryApplicability: ["pf", "esi"],
    fieldRules,
    uploads: {
      aadhaarFront: Boolean(row.aadhaar_front_path),
      aadhaarBack: Boolean(row.aadhaar_back_path),
      pan: Boolean(row.pan_upload_path),
      dlFront: Boolean(row.dl_front_path),
      dlBack: Boolean(row.dl_back_path),
      photo: Boolean(row.profile_photo_path)
    },
    uploadUrls: {
      aadhaarFront: await signedProfileUrl(row.aadhaar_front_path),
      aadhaarBack: await signedProfileUrl(row.aadhaar_back_path),
      pan: await signedProfileUrl(row.pan_upload_path),
      dlFront: await signedProfileUrl(row.dl_front_path),
      dlBack: await signedProfileUrl(row.dl_back_path),
      photo: await signedProfileUrl(row.profile_photo_path),
      profilePhoto: await signedProfileUrl(row.profile_photo_path)
    },
    profilePhotoUrl: await signedProfileUrl(row.profile_photo_path),
    status: row.onboarding_status ?? "pending",
    returnRemarks: row.profile_return_remarks ?? ""
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const executiveId = url.searchParams.get("executiveId") ?? "";
    const profileType = url.searchParams.get("profileType") ?? "field_executive";
    const account = await requireExecutiveAccess(executiveId, profileType);
    const executive = await loadExecutive(account.id, account.companyId, account.profileType);
    return NextResponse.json({ ok: true, profile: await serializeExecutive(executive, account.profileType) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load profile." }, { status: 400 });
  }
}

async function uploadExecutiveFile(file: FormDataEntryValue | null, companyId: string, executiveId: string, slot: string) {
  if (!supabaseAdmin || !(file instanceof File) || file.size === 0) return null;
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${companyId}/field-executives/${executiveId}/${slot}-${Date.now()}${fileExt(safeName)}`;
  const uploadResult = await supabaseAdmin.storage
    .from("employee-profile-documents")
    .upload(path, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type || "application/octet-stream",
      upsert: true
    });
  if (uploadResult.error) throw new Error(uploadResult.error.message);
  return path;
}

export async function POST(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const formData = await request.formData();
    const executiveId = String(formData.get("executive_id") ?? "");
    const profileType = String(formData.get("profile_type") ?? "field_executive");
    const account = await requireExecutiveAccess(executiveId, profileType);
    const table = workforceTable(account.profileType);
    const manualReviewRequired = String(formData.get("manual_review_required") ?? "") === "true";
    const currentExecutive = await loadExecutive(account.id, account.companyId, account.profileType);
    const currentStatus = String(currentExecutive.onboarding_status ?? "pending").trim().toLowerCase();
    if (!["pending", "returned"].includes(currentStatus)) {
      throw new Error("Profile cannot be edited after submission.");
    }
    const designationResult = currentExecutive.designation
      ? await supabaseAdmin
        .from("designations")
        .select("profile_field_rules")
        .eq("company_id", account.companyId)
        .eq("name", currentExecutive.designation)
        .maybeSingle()
      : null;
    const categoryCode = profileFieldRuleCategory(account.profileType);
    const rules = (await loadWorkforceCategoryRules(
      account.companyId,
      categoryCode,
      designationResult?.data?.profile_field_rules,
      categoryCode
    )).dropx_one;
    const requiredFields = new Set(rules.required);
    const isRequired = (key: string) => requiredFields.has(key);
    const textValue = (key: string, label: string) => isRequired(key) ? requiredText(formData.get(key), label) : cleanText(formData.get(key));
    const digitsValue = (key: string, label: string) => isRequired(key) ? requiredDigits(formData.get(key), label) : cleanDigits(formData.get(key));
    const bankAccountValue = alphaNumValue(formData.get("bank_account_no"), "Bank account no", isRequired("bank_account_no"));
    const dateValue = (key: string, label: string) => normalizeDate(isRequired(key) ? requiredText(formData.get(key), label) : formData.get(key));
    const panValue = isRequired("pan_number") || cleanText(formData.get("pan_number")) ? requiredPan(formData.get("pan_number")) : null;
    const eshramValue = isRequired("eshram_uan") || cleanText(formData.get("eshram_uan")) ? requiredTwelveDigits(formData.get("eshram_uan"), "eShram UAN") : null;
    const pfUanValue = isRequired("pf_uan") || cleanText(formData.get("pf_uan")) ? requiredTwelveDigits(formData.get("pf_uan"), "PF UAN") : null;
    const pfAccountValue = alphaNumValue(formData.get("pf_account_no"), "PF Account No", isRequired("pf_account_no"));
    const esiValue = alphaNumValue(formData.get("esi_no"), "ESI No", isRequired("esi_no"));

    const updatePayload: Record<string, unknown> = {
      gender: textValue("gender", "Gender"),
      date_of_birth: dateValue("date_of_birth", "Date of birth"),
      aadhaar_number: digitsValue("aadhaar_number", "Aadhaar number"),
      pan_number: panValue,
      eshram_uan: eshramValue,
      father_name: textValue("father_name", "Father name"),
      blood_group: textValue("blood_group", "Blood group"),
      is_handicapped: textValue("is_handicapped", "Handicapped") === "true",
      address: textValue("address", "Address"),
      state_code: textValue("state_code", "State code")?.toUpperCase() ?? null,
      postal_pin: digitsValue("pincode", "Pincode"),
      landmark: textValue("landmark", "Landmark"),
      bank_account_no: bankAccountValue,
      ifsc_code: textValue("ifsc", "IFSC")?.toUpperCase() ?? null,
      pf_uan: pfUanValue,
      pf_account_no: pfAccountValue,
      esi_no: esiValue,
      emergency_contact_name: textValue("emergency_contact_name", "Emergency contact name"),
      emergency_contact_number: digitsValue("emergency_contact_number", "Emergency contact number"),
      emergency_contact_relation: textValue("emergency_contact_relation", "Emergency relation"),
      driving_license_no: textValue("driving_license_no", "Driving license no")?.toUpperCase() ?? null,
      driving_license_exp_date: dateValue("driving_license_exp_date", "DL expiry date"),
      vehicle_reg_no: textValue("vehicle_reg_no", "Vehicle reg no")?.toUpperCase() ?? null,
      vehicle_reg_exp_date: dateValue("vehicle_reg_exp_date", "Reg expiry date"),
      vehicle_insurance_exp_date: dateValue("vehicle_insurance_exp_date", "Vehicle Insurance expiry"),
      vehicle_pollution_exp_date: dateValue("vehicle_pollution_exp_date", "Pollution expiry date"),
      onboarding_status: manualReviewRequired ? "under_review" : "active",
      profile_return_remarks: null,
      profile_returned_at: null,
      is_active: true,
      updated_at: new Date().toISOString()
    };

    const profileUpdateResult = await supabaseAdmin
      .from(table)
      .update(updatePayload)
      .eq("id", account.id)
      .eq("company_id", account.companyId);
    if (profileUpdateResult.error) throw new Error(profileUpdateResult.error.message);

    await saveProfileVerifications({
      accountId: account.id,
      companyId: account.companyId,
      profileType: account.profileType,
      values: formData.getAll("profile_verification_results")
    });

    const uploads = await Promise.all([
      uploadExecutiveFile(formData.get("aadhaar_front"), account.companyId, account.id, "aadhaar-front"),
      uploadExecutiveFile(formData.get("aadhaar_back"), account.companyId, account.id, "aadhaar-back"),
      uploadExecutiveFile(formData.get("pan_upload"), account.companyId, account.id, "pan"),
      uploadExecutiveFile(formData.get("dl_front"), account.companyId, account.id, "dl-front"),
      uploadExecutiveFile(formData.get("dl_back"), account.companyId, account.id, "dl-back"),
      uploadExecutiveFile(formData.get("profile_photo"), account.companyId, account.id, "photo")
    ]);
    const [aadhaarFrontPath, aadhaarBackPath, panUploadPath, dlFrontPath, dlBackPath, profilePhotoPath] = uploads;
    const uploadPayload: Record<string, unknown> = {};
    if (aadhaarFrontPath) uploadPayload.aadhaar_front_path = aadhaarFrontPath;
    if (aadhaarBackPath) uploadPayload.aadhaar_back_path = aadhaarBackPath;
    if (panUploadPath) uploadPayload.pan_upload_path = panUploadPath;
    if (dlFrontPath) uploadPayload.dl_front_path = dlFrontPath;
    if (dlBackPath) uploadPayload.dl_back_path = dlBackPath;
    if (profilePhotoPath) uploadPayload.profile_photo_path = profilePhotoPath;
    if (Object.keys(uploadPayload).length > 0) {
      const uploadUpdateResult = await supabaseAdmin
        .from(table)
        .update(uploadPayload)
        .eq("id", account.id)
        .eq("company_id", account.companyId);
      if (uploadUpdateResult.error) {
        throw new Error(`Profile details were saved, but upload paths were not saved. Run scripts/field_executives_v1.sql in Supabase and try again. ${uploadUpdateResult.error.message}`);
      }
    }
    const executive = await loadExecutive(account.id, account.companyId, account.profileType);
    return NextResponse.json({ ok: true, profile: await serializeExecutive(executive, account.profileType), notice: "Profile saved successfully." });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save profile." }, { status: 400 });
  }
}
