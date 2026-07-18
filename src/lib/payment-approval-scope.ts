import type { AuthorizationContext } from "@/lib/authorization";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type PaymentApprovalScopeRequest = {
  id: string;
  location_id: string | null;
  requested_by: string | null;
  current_approver_user_id: string | null;
  current_approver_role_id?: string | null;
};

type ProfileScopeRow = {
  id: string;
  email: string | null;
  reports_to_user_id: string | null;
};

type LocationScopeRow = {
  id: string;
  station_manager_email: string | null;
};

function normalizeEmail(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function chainHasUser(profilesById: Map<string, ProfileScopeRow>, startUserId: string | null | undefined, targetUserId: string) {
  let currentId = startUserId ?? null;
  const seen = new Set<string>();

  while (currentId && !seen.has(currentId)) {
    if (currentId === targetUserId) return true;
    seen.add(currentId);
    currentId = profilesById.get(currentId)?.reports_to_user_id ?? null;
  }

  return false;
}

export async function getPaymentApprovalEligibility(companyId: string, authorization: AuthorizationContext, requests: PaymentApprovalScopeRequest[]) {
  if (!supabaseAdmin || authorization.roleCode === "OWNER" || authorization.isMasterOwner) {
    return new Set(requests.map((request) => request.id));
  }

  const [profilesResult, locationsResult] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("id, email, reports_to_user_id")
      .eq("company_id", companyId)
      .eq("is_active", true),
    supabaseAdmin
      .from("stations")
      .select("id, station_manager_email")
      .eq("company_id", companyId)
  ]);

  if (profilesResult.error || locationsResult.error) return new Set<string>();

  const profiles = (profilesResult.data ?? []) as ProfileScopeRow[];
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const profileByEmail = new Map(
    profiles
      .map((profile) => [normalizeEmail(profile.email), profile] as const)
      .filter(([email]) => Boolean(email))
  );
  const locationsById = new Map(((locationsResult.data ?? []) as LocationScopeRow[]).map((location) => [location.id, location]));
  const eligibleIds = new Set<string>();

  for (const request of requests) {
    if (request.current_approver_user_id === authorization.userId) {
      eligibleIds.add(request.id);
      continue;
    }

    if (request.current_approver_role_id && request.current_approver_role_id === authorization.roleId) {
      eligibleIds.add(request.id);
      continue;
    }

    const locationManagerEmail = request.location_id ? locationsById.get(request.location_id)?.station_manager_email : null;
    const locationManager = profileByEmail.get(normalizeEmail(locationManagerEmail));
    if (chainHasUser(profilesById, locationManager?.id, authorization.userId)) {
      eligibleIds.add(request.id);
      continue;
    }

    if (chainHasUser(profilesById, request.requested_by, authorization.userId)) {
      eligibleIds.add(request.id);
    }
  }

  return eligibleIds;
}

export async function canActOnPaymentRequest(companyId: string, authorization: AuthorizationContext, request: PaymentApprovalScopeRequest) {
  const eligibleIds = await getPaymentApprovalEligibility(companyId, authorization, [request]);
  return eligibleIds.has(request.id);
}
