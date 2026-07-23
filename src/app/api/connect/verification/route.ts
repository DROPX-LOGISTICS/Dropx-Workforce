import { createHash } from "crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { connectSessionCookieName, normalizeConnectMobile } from "@/lib/connect-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

const IDSPAY_BASE_URL = "https://javabackend.idspay.in/api/v1/prod";

type VerificationKind = "pan" | "pan_aadhaar" | "dl" | "vehicle" | "bank";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function compact(value: unknown) {
  return text(value).replace(/\s+/g, " ");
}

function onlyDigits(value: unknown) {
  return text(value).replace(/\D/g, "");
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
  const table = profileType === "field_executive" ? "field_executives" : "profiles";
  const idColumn = profileType === "field_executive" ? "id" : "id";
  const result = await supabaseAdmin
    .from(table)
    .select("id, company_id, full_name, mobile, mobile_country_code")
    .eq(idColumn, accountId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  const row = result.data;
  if (!row) throw new Error("Account not found.");
  const rowMobile = onlyDigits(row.mobile);
  const rowCountryCode = onlyDigits(row.mobile_country_code || countryCode) || countryCode;
  if (rowCountryCode !== countryCode || (rowMobile !== mobile && rowMobile !== localMobile)) {
    throw new Error("This verification is not available for the signed-in account.");
  }
  return { companyId: row.company_id as string, fullName: compact(row.full_name) };
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
      const { body } = await callIdspay("/pan/verification", { ...credentials, pan_number: panNumber });
      const apiName = compact(body?.data?.data?.full_name);
      const apiSuccess = body?.data?.success === true || body?.status?.type === "success";
      const score = nameScore(registeredName, apiName);
      const verified = Boolean(apiSuccess && score >= 0.5);
      return ok({
        verified,
        manualReview: !verified,
        name: apiName,
        nameMatchPercent: Math.round(score * 100),
        message: verified ? "PAN verified." : (apiSuccess ? "PAN name needs manual review." : text(body?.message) || "PAN verification failed."),
        rawStatus: body?.status ?? null
      });
    }

    if (kind === "pan_aadhaar") {
      const pan = text(payload.panNumber).toUpperCase();
      const aadhar = onlyDigits(payload.aadhaarNumber);
      if (!pan || !aadhar) throw new Error("PAN and Aadhaar number are required.");
      const { body } = await callIdspay("/srv2/validation/pan-aadhaar-link", { ...credentials, pan, aadhar });
      const code = Number(body?.result_code);
      const verified = code === 101 || text(body?.result?.code) === "LINK-001";
      return ok({
        verified,
        manualReview: !verified,
        message: text(body?.result?.message) || (verified ? "PAN Aadhaar link verified." : "PAN Aadhaar link verification failed.")
      });
    }

    if (kind === "dl") {
      const dlNumber = text(payload.drivingLicenseNo).toUpperCase();
      const dob = text(payload.dateOfBirth);
      if (!dlNumber || !dob) throw new Error("DL number and date of birth are required.");
      const { body } = await callIdspay("/srv2/validation/dl", { ...credentials, dlNumber, dob });
      const details = body?.data?.details_of_driving_licence ?? {};
      const apiName = compact(details?.name);
      const score = nameScore(registeredName, apiName);
      const transportExpiry = normalizeDate(body?.data?.dl_validity?.transport?.to);
      const nonTransportExpiry = normalizeDate(body?.data?.dl_validity?.non_transport?.to);
      const expiryDate = transportExpiry && transportExpiry.toUpperCase() !== "NA" ? transportExpiry : nonTransportExpiry;
      const parsedExpiry = parseDate(expiryDate);
      const expired = parsedExpiry ? parsedExpiry.getTime() < Date.now() : false;
      const apiSuccess = body?.status?.type === "success" || text(body?.message).toLowerCase().includes("validated");
      const nameMatched = Boolean(apiSuccess && score >= 0.5);
      return ok({
        verified: nameMatched && !expired,
        manualReview: apiSuccess && !nameMatched,
        blockSubmit: expired,
        name: apiName,
        nameMatchPercent: Math.round(score * 100),
        expiryDate,
        message: expired ? "DL is expired." : nameMatched ? "DL verified." : (apiSuccess ? "DL name needs manual review." : text(body?.message) || "DL verification failed.")
      });
    }

    if (kind === "vehicle") {
      const regNo = text(payload.vehicleRegNo).toUpperCase();
      if (!regNo) throw new Error("Vehicle registration number is required.");
      const { body } = await callIdspay("/srv2/validation/rc", { ...credentials, reg_no: regNo });
      const data = body?.data ?? {};
      const verified = body?.status?.type === "success" || body?.success === true;
      return ok({
        verified,
        warning: verified ? "" : text(body?.message) || "Vehicle details could not be verified.",
        registrationExpiryDate: normalizeDate(data?.rc_expiry_date),
        insuranceExpiryDate: normalizeDate(data?.vehicle_insurance_upto ?? data?.insurance_upto),
        pollutionExpiryDate: normalizeDate(data?.pucc_upto)
      });
    }

    if (kind === "bank") {
      const creditorAccountId = text(payload.bankAccountNo);
      const ifscCode = text(payload.ifsc).toUpperCase();
      if (!creditorAccountId || !ifscCode) throw new Error("Bank account number and IFSC are required.");
      const { body } = await callIdspay("/idfc/beneficiary", { ...credentials, creditorAccountId, ifscCode });
      const resource = body?.data?.beneValidationResp?.resourceData ?? {};
      const verified = text(body?.data?.beneValidationResp?.metaData?.status).toUpperCase() === "SUCCESS";
      return ok({
        verified,
        accountName: compact(resource?.creditorName),
        message: text(body?.message) || (verified ? "Bank account checked." : "Bank verification failed.")
      });
    }

    throw new Error("Unsupported verification type.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to verify.";
    return NextResponse.json({ error: message }, { status: message.includes("Login") ? 401 : 400 });
  }
}
