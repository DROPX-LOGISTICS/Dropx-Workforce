import { createHash } from "crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { connectSessionCookieName, normalizeConnectMobile } from "@/lib/connect-auth";
import { isMissingVerificationTable } from "@/lib/profile-verifications";
import { supabaseAdmin } from "@/lib/supabase-admin";

const IDSPAY_BASE_URL = "https://javabackend.idspay.in/api/v1/prod";

type VerificationKind = "pan" | "pan_aadhaar" | "dl" | "vehicle" | "bank" | "pf_uan";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function compact(value: unknown) {
  return text(value).replace(/\s+/g, " ");
}

function onlyDigits(value: unknown) {
  return text(value).replace(/\D/g, "");
}

function inputKey(parts: unknown[]) {
  return parts.map((part) => text(part).toUpperCase()).join("|");
}

function deepText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(deepText).join(" ");
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).map(deepText).join(" ");
  }
  return "";
}

function findFirstString(value: unknown, keys: string[]): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstString(item, keys);
      if (found) return found;
    }
    return "";
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      const direct = record[key];
      if (typeof direct === "string" || typeof direct === "number") {
        const found = text(direct);
        if (found) return found;
      }
    }
    for (const item of Object.values(record)) {
      const found = findFirstString(item, keys);
      if (found) return found;
    }
  }
  return "";
}

function uanName(body: unknown) {
  const data = (body as { data?: unknown })?.data as Record<string, unknown> | undefined;
  const details = data?.uan_details;
  if (details && typeof details === "object") {
    for (const row of Object.values(details as Record<string, unknown>)) {
      const basic = (row as { basic_details?: unknown })?.basic_details as Record<string, unknown> | undefined;
      const found = compact(basic?.name);
      if (found) return found;
    }
  }
  return compact(findFirstString(body, ["employee_name", "employeeName", "name", "full_name", "fullName"]));
}

function normalizeDate(value: unknown) {
  const raw = text(value);
  const match = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!match) return raw;
  return `${match[1].padStart(2, "0")}/${match[2].padStart(2, "0")}/${match[3]}`;
}

function parseDate(value: string) {
  const match = value.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
}

function idspayDob(value: unknown) {
  const raw = text(value);
  const localMatch = raw.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (localMatch) return `${localMatch[1]}-${localMatch[2]}-${localMatch[3]}`;
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return `${isoMatch[3]}-${isoMatch[2]}-${isoMatch[1]}`;
  return raw.replace(/\//g, "-");
}

function isElectricFuel(value: unknown) {
  const fuel = text(value).toLowerCase();
  return fuel.includes("electric") || fuel === "ev";
}

function nameScore(left: string, right: string) {
  const a = compact(left).toUpperCase().replace(/[^A-Z0-9 ]/g, "").split(" ").filter(Boolean);
  const b = compact(right).toUpperCase().replace(/[^A-Z0-9 ]/g, "").split(" ").filter(Boolean);
  if (!a.length || !b.length) return 0;
  const common = a.filter((part) => b.includes(part)).length;
  return common / Math.max(a.length, b.length);
}

function ok(data: Record<string, unknown>) {
  return NextResponse.json(data);
}

async function activeSession() {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const token = cookies().get(connectSessionCookieName)?.value;
  if (!token) throw new Error("Login required.");
  const sessionHash = createHash("sha256").update(token).digest("hex");
  const sessionResult = await supabaseAdmin
    .from("connect_login_sessions")
    .select("id, country_code, mobile_number, expires_at, revoked_at")
    .eq("session_hash", sessionHash)
    .maybeSingle();
  if (sessionResult.error) throw new Error(sessionResult.error.message);
  const session = sessionResult.data;
  if (!session || session.revoked_at || new Date(session.expires_at).getTime() < Date.now()) {
    throw new Error("Login expired.");
  }
  return session;
}

async function resolveAccount(accountId: string, profileType: string) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const session = await activeSession();
  const { countryCode, mobile, localMobile } = normalizeConnectMobile(session.mobile_number, session.country_code);
  const table = profileType === "field_executive" ? "field_executives" : "employees";
  const result = await supabaseAdmin
    .from(table)
    .select(profileType === "field_executive" ? "id, company_id, dropx_id, full_name, mobile, mobile_country_code" : "id, company_id, employee_code, full_name, mobile, mobile_country_code")
    .eq("id", accountId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  const row = result.data;
  if (!row) throw new Error("Account not found.");
  const rowMobile = onlyDigits(row.mobile);
  const rowCountryCode = onlyDigits(row.mobile_country_code || countryCode) || countryCode;
  if (rowCountryCode !== countryCode || (rowMobile !== mobile && rowMobile !== localMobile)) {
    throw new Error("This verification is not available for the signed-in account.");
  }
  const accountCode = profileType === "field_executive"
    ? compact((row as { dropx_id?: unknown }).dropx_id)
    : compact((row as { employee_code?: unknown }).employee_code);
  return { companyId: row.company_id as string, fullName: compact(row.full_name), accountCode };
}

async function idspayCredentials(companyId: string) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const settings = await supabaseAdmin
    .from("verification_api_settings")
    .select("api_id, is_enabled")
    .eq("company_id", companyId)
    .eq("provider_code", "idspay")
    .maybeSingle();
  if (settings.error) throw new Error(settings.error.message);
  if (!settings.data?.is_enabled) throw new Error("IDSPAY verification API is not enabled.");
  const [apiKey, tokenId] = await Promise.all([
    supabaseAdmin.rpc("get_verification_api_secret", {
      company_uuid: companyId,
      provider: "idspay",
      secret_kind: "api_key"
    }),
    supabaseAdmin.rpc("get_verification_api_secret", {
      company_uuid: companyId,
      provider: "idspay",
      secret_kind: "token_id"
    })
  ]);
  if (apiKey.error) throw new Error(apiKey.error.message);
  if (tokenId.error) throw new Error(tokenId.error.message);
  return {
    api_id: text(settings.data.api_id),
    api_key: text(apiKey.data),
    token_id: text(tokenId.data)
  };
}

async function callIdspay(path: string, payload: Record<string, unknown>) {
  const response = await fetch(`${IDSPAY_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function verifiedResponse(result: Record<string, unknown>) {
  return ok(result);
}

export async function GET(request: NextRequest) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const accountId = text(request.nextUrl.searchParams.get("accountId"));
    const profileType = text(request.nextUrl.searchParams.get("profileType"));
    if (!accountId) throw new Error("Account is required.");
    const account = await resolveAccount(accountId, profileType);
    const result = await supabaseAdmin
      .from("connect_profile_verifications")
      .select("kind, input_key, verified, manual_review, block_submit, display_name, message, details, verified_at")
      .eq("company_id", account.companyId)
      .eq("profile_type", profileType === "field_executive" ? "field_executive" : "employee")
      .eq("account_id", accountId);
    if (result.error) {
      if (isMissingVerificationTable(result.error)) return ok({ verifications: [] });
      throw new Error(result.error.message);
    }
    return ok({
      verifications: (result.data ?? []).map((row) => ({
        kind: row.kind,
        inputKey: row.input_key,
        verified: row.verified,
        manualReview: row.manual_review,
        blockSubmit: row.block_submit,
        name: row.display_name,
        message: row.message,
        details: row.details,
        verifiedAt: row.verified_at
      }))
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load verification status.";
    return NextResponse.json({ error: message }, { status: message.includes("Login") ? 401 : 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const kind = text(payload.kind) as VerificationKind;
    const accountId = text(payload.accountId);
    const profileType = text(payload.profileType);
    if (!accountId) throw new Error("Account is required.");
    const account = await resolveAccount(accountId, profileType);
    const credentials = await idspayCredentials(account.companyId);
    const registeredName = compact(payload.fullName) || account.fullName;

    if (kind === "pan") {
      const panNumber = text(payload.panNumber).toUpperCase();
      if (!panNumber) throw new Error("PAN number is required.");
      const { body } = await callIdspay("/pan/verification", { ...credentials, pan_number: panNumber, remarks: account.accountCode });
      const apiName = compact(findFirstString(body, ["full_name", "fullName", "name", "pan_name", "panName"]));
      const apiSuccess = body?.data?.success === true || body?.status?.type === "success";
      const score = nameScore(registeredName, apiName);
      const verified = Boolean(apiSuccess && score >= 0.5);
      const mismatch = Boolean(apiSuccess && !verified);
      const result = {
        verified,
        manualReview: !verified,
        inputKey: inputKey([panNumber]),
        name: apiName,
        nameMatchPercent: Math.round(score * 100),
        message: verified ? `PAN verified. PAN name: ${apiName || "-"}` : (mismatch ? `PAN name mismatch. PAN name: ${apiName || "-"}` : text(body?.message) || "PAN verification failed."),
        rawStatus: body?.status ?? null
      };
      return verifiedResponse(result);
    }

    if (kind === "pan_aadhaar") {
      const pan = text(payload.panNumber).toUpperCase();
      const aadhar = onlyDigits(payload.aadhaarNumber);
      if (!pan || !aadhar) throw new Error("PAN and Aadhaar number are required.");
      const { body } = await callIdspay("/srv2/validation/pan-aadhaar-link", { ...credentials, pan, aadhar, aadhaar: aadhar, remarks: account.accountCode });
      const code = Number(body?.result_code);
      const resultCode = text(body?.result?.code).toUpperCase();
      const resultMessage = text(body?.result?.message).toLowerCase();
      const responseText = deepText(body).toLowerCase();
      const verified = code === 101 ||
        resultCode === "LINK-001" ||
        resultMessage.includes("already linked") ||
        responseText.includes("already linked to given aadhaar") ||
        responseText.includes("is already linked");
      const result = {
        verified,
        manualReview: !verified,
        inputKey: inputKey([pan, aadhar]),
        message: text(body?.data?.message) ||
          text(body?.result?.message) ||
          (verified ? "PAN Aadhaar link verified." : "PAN Aadhaar link verification failed.")
      };
      return verifiedResponse(result);
    }

    if (kind === "dl") {
      const dlNumber = text(payload.drivingLicenseNo).toUpperCase();
      const dob = idspayDob(payload.dateOfBirth);
      if (!dlNumber || !dob) throw new Error("DL number and date of birth are required.");
      const { body } = await callIdspay("/srv2/validation/dl", { ...credentials, dlNumber, dob, remarks: account.accountCode });
      const details = body?.data?.details_of_driving_licence ?? {};
      const apiName = compact(details?.name || findFirstString(body, ["name", "full_name", "fullName"]));
      const score = nameScore(registeredName, apiName);
      const transportExpiry = normalizeDate(body?.data?.dl_validity?.transport?.to);
      const nonTransportExpiry = normalizeDate(body?.data?.dl_validity?.non_transport?.to);
      const expiryDate = transportExpiry && transportExpiry.toUpperCase() !== "NA" ? transportExpiry : nonTransportExpiry;
      const parsedExpiry = parseDate(expiryDate);
      const expired = parsedExpiry ? parsedExpiry.getTime() < Date.now() : false;
      const apiSuccess = body?.status?.type === "success" || text(body?.message).toLowerCase().includes("validated");
      const nameMatched = Boolean(apiSuccess && score >= 0.5);
      const result = {
        verified: nameMatched && !expired,
        manualReview: apiSuccess && !nameMatched,
        blockSubmit: expired,
        inputKey: inputKey([dlNumber, dob]),
        name: apiName,
        nameMatchPercent: Math.round(score * 100),
        expiryDate,
        message: expired ? "DL is expired." : nameMatched ? "DL verified." : (apiSuccess ? "DL name needs manual review." : text(body?.message) || "DL verification failed.")
      };
      return verifiedResponse(result);
    }

    if (kind === "vehicle") {
      const regNo = text(payload.vehicleRegNo).toUpperCase();
      if (!regNo) throw new Error("Vehicle registration number is required.");
      const { body } = await callIdspay("/srv2/validation/rc", { ...credentials, reg_no: regNo, remarks: account.accountCode });
      const data = body?.data ?? {};
      const verified = body?.status?.type === "success" || body?.success === true;
      const fuelType = compact(data?.type ?? data?.fuel_type ?? data?.fuelType);
      const result = {
        verified,
        inputKey: inputKey([regNo]),
        ownerName: compact(data?.owner_name),
        fuelType,
        warning: verified ? "" : text(body?.message) || "Vehicle details could not be verified.",
        registrationExpiryDate: normalizeDate(data?.rc_expiry_date),
        insuranceExpiryDate: normalizeDate(data?.vehicle_insurance_upto ?? data?.insurance_upto),
        pollutionExpiryDate: isElectricFuel(fuelType) ? "" : normalizeDate(data?.pucc_upto)
      };
      return verifiedResponse(result);
    }

    if (kind === "bank") {
      const creditorAccountId = text(payload.bankAccountNo);
      const ifscCode = text(payload.ifsc).toUpperCase();
      if (!creditorAccountId || !ifscCode) throw new Error("Bank account number and IFSC are required.");
      const { body } = await callIdspay("/idfc/beneficiary", { ...credentials, creditorAccountId, ifscCode, remarks: account.accountCode });
      const resource = body?.data?.beneValidationResp?.resourceData ?? {};
      const verified = text(body?.data?.beneValidationResp?.metaData?.status).toUpperCase() === "SUCCESS";
      const result = {
        verified,
        inputKey: inputKey([creditorAccountId, ifscCode]),
        accountName: compact(resource?.creditorName),
        message: verified ? text(body?.message) || "Bank account checked." : "Bank verification failed."
      };
      return verifiedResponse(result);
    }

    if (kind === "pf_uan") {
      const uan = onlyDigits(payload.pfUan ?? payload.uan);
      if (!uan) throw new Error("PF UAN is required.");
      const { body } = await callIdspay("/srv3/uan-direct", { ...credentials, uan, remarks: account.accountCode });
      const apiName = uanName(body);
      const apiSuccess = body?.status?.type === "success" || text(body?.message).toLowerCase() === "success";
      const score = nameScore(registeredName, apiName);
      const verified = Boolean(apiSuccess && score >= 0.5);
      const mismatch = Boolean(apiSuccess && !verified);
      const result = {
        verified,
        manualReview: !verified,
        inputKey: inputKey([uan]),
        name: apiName,
        nameMatchPercent: Math.round(score * 100),
        message: verified ? "PF UAN verified." : (mismatch ? `PF UAN name mismatch. PF UAN name: ${apiName || "-"}` : text(body?.message) || "PF UAN verification failed."),
        rawStatus: body?.status ?? null
      };
      return verifiedResponse(result);
    }

    throw new Error("Unsupported verification type.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to verify.";
    return NextResponse.json({ error: message }, { status: message.includes("Login") ? 401 : 400 });
  }
}
