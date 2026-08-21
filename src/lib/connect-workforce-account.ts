import "server-only";

import { createHash } from "crypto";
import { cookies } from "next/headers";
import { connectSessionCookieName, normalizeConnectMobile } from "@/lib/connect-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isWorkforceProfileType, type WorkforceProfileType, workforceTable } from "@/lib/workforce-profiles";

export type ConnectWorkforceAccount = {
  companyId: string;
  profileId: string;
  profileType: WorkforceProfileType;
  dropxId: string;
  biometricId: string;
  fullName: string;
};

export async function resolveConnectWorkforceAccount(input: {
  accountId: string;
  profileType: string;
}): Promise<ConnectWorkforceAccount> {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  if (!input.accountId || !isWorkforceProfileType(input.profileType)) {
    throw new Error("Select a valid workforce account.");
  }

  const token = cookies().get(connectSessionCookieName)?.value;
  if (!token) throw new Error("Login required.");
  const sessionResult = await supabaseAdmin.from("connect_login_sessions")
    .select("country_code,mobile_number,expires_at,revoked_at")
    .eq("session_hash", createHash("sha256").update(token).digest("hex"))
    .maybeSingle();
  if (sessionResult.error) throw new Error(sessionResult.error.message);
  const session = sessionResult.data;
  if (!session || session.revoked_at || new Date(session.expires_at).getTime() < Date.now()) {
    throw new Error("Login expired.");
  }

  const profileType = input.profileType as WorkforceProfileType;
  const table = workforceTable(profileType);
  const idColumn = profileType === "employee" ? "employee_code" : "dropx_id";
  const profileResult = await supabaseAdmin.from(table)
    .select(`id,company_id,mobile,mobile_country_code,biometric_id,full_name,${idColumn},is_active`)
    .eq("id", input.accountId)
    .maybeSingle();
  if (profileResult.error) throw new Error(profileResult.error.message);
  const profile = profileResult.data;
  if (!profile || profile.is_active === false) throw new Error("Workforce account is inactive or unavailable.");

  const { countryCode, mobile, localMobile } = normalizeConnectMobile(session.mobile_number, session.country_code);
  const profileMobile = String(profile.mobile ?? "").replace(/\D/g, "");
  const profileCountry = String(profile.mobile_country_code ?? countryCode).replace(/\D/g, "") || countryCode;
  if (profileCountry !== countryCode || (profileMobile !== mobile && profileMobile !== localMobile)) {
    throw new Error("This account does not belong to the signed-in mobile number.");
  }

  return {
    companyId: String(profile.company_id),
    profileId: String(profile.id),
    profileType,
    dropxId: String(profile[idColumn as keyof typeof profile] ?? ""),
    biometricId: String(profile.biometric_id ?? ""),
    fullName: String(profile.full_name ?? "")
  };
}
