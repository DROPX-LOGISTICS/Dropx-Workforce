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
  legacyPeopleProfileId: string | null;
  legacyPeopleProfileType: "contractor" | null;
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
  if (!profile) throw new Error("Workforce account is inactive or unavailable.");
  if (profileType === "workforce") {
    const stateResult = await supabaseAdmin.from("workforce")
      .select("deleted_at,migration_state,onboarding_status,lifecycle_status")
      .eq("company_id", profile.company_id)
      .eq("id", profile.id)
      .maybeSingle();
    if (stateResult.error) throw new Error(stateResult.error.message);
    const state = stateResult.data;
    const terminal = new Set(["rejected", "cancelled", "terminated", "settled", "exited", "offboarded", "deactivated"]);
    if (!state || state.deleted_at || state.migration_state === "reclassified"
      || terminal.has(String(state.onboarding_status ?? "").toLowerCase())
      || terminal.has(String(state.lifecycle_status ?? "").toLowerCase())) {
      throw new Error("Workforce account is inactive or unavailable.");
    }
  } else if (profile.is_active === false) {
    throw new Error("Workforce account is inactive or unavailable.");
  }

  const previewValue = cookies().get("dropx_connect_preview_account")?.value ?? "";
  const previewMatches = previewValue === `${profileType}:${input.accountId}:${profile.company_id}`;
  let ownerPreview = false;
  if (previewMatches) {
    const { countryCode: viewerCountry, mobile: viewerMobile, localMobile: viewerLocal } = normalizeConnectMobile(session.mobile_number, session.country_code);
    const viewerProfiles = await supabaseAdmin.from("profiles").select("id,company_id,role_id,is_master_owner,is_active,mobile,mobile_country_code").eq("company_id", profile.company_id).eq("is_active", true).or(`mobile.eq.${viewerMobile},mobile.eq.${viewerLocal}`);
    if (viewerProfiles.error) throw new Error(viewerProfiles.error.message);
    const roleIds = [...new Set((viewerProfiles.data ?? []).map((row) => row.role_id).filter(Boolean))];
    const roles = roleIds.length ? await supabaseAdmin.from("user_roles").select("id,code").in("id", roleIds) : { data: [], error: null };
    if (roles.error) throw new Error(roles.error.message);
    const ownerRoleIds = new Set((roles.data ?? []).filter((role) => String(role.code ?? "").toUpperCase() === "OWNER").map((role) => role.id));
    ownerPreview = (viewerProfiles.data ?? []).some((row) => {
      const rowCountry = String(row.mobile_country_code ?? viewerCountry).replace(/\D/g, "") || viewerCountry;
      return rowCountry === viewerCountry && (row.is_master_owner || ownerRoleIds.has(row.role_id));
    });
  }

  const { countryCode, mobile, localMobile } = normalizeConnectMobile(session.mobile_number, session.country_code);
  const profileMobile = String(profile.mobile ?? "").replace(/\D/g, "");
  const profileCountry = String(profile.mobile_country_code ?? countryCode).replace(/\D/g, "") || countryCode;
  if (!ownerPreview && (profileCountry !== countryCode || (profileMobile !== mobile && profileMobile !== localMobile))) {
    throw new Error("This account does not belong to the signed-in mobile number.");
  }

  const legacyIdentity = profileType === "workforce"
    ? await supabaseAdmin.from("workforce_identity_links")
      .select("legacy_profile_type,legacy_profile_id")
      .eq("company_id", profile.company_id)
      .eq("target_profile_type", "workforce")
      .eq("target_profile_id", profile.id)
      .eq("legacy_profile_type", "contractor")
      .eq("compatibility_active", true)
      .maybeSingle()
    : { data: null, error: null };
  if (legacyIdentity.error) throw new Error(legacyIdentity.error.message);

  return {
    companyId: String(profile.company_id),
    profileId: String(profile.id),
    profileType,
    dropxId: String(profile[idColumn as keyof typeof profile] ?? ""),
    biometricId: String(profile.biometric_id ?? ""),
    fullName: String(profile.full_name ?? ""),
    legacyPeopleProfileId: legacyIdentity.data?.legacy_profile_id ?? null,
    legacyPeopleProfileType: legacyIdentity.data ? "contractor" : null
  };
}
