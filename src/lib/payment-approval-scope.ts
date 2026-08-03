import type { AuthorizationContext } from "@/lib/authorization";

export type PaymentApprovalScopeRequest = {
  id: string;
  location_id: string | null;
  requested_by: string | null;
  current_approver_user_id: string | null;
  current_approver_role_id?: string | null;
};

export async function getPaymentApprovalEligibility(companyId: string, authorization: AuthorizationContext, requests: PaymentApprovalScopeRequest[]) {
  void companyId;
  if (authorization.roleCode === "OWNER" || authorization.isMasterOwner) {
    return new Set(requests.map((request) => request.id));
  }
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

  }

  return eligibleIds;
}

export async function canActOnPaymentRequest(companyId: string, authorization: AuthorizationContext, request: PaymentApprovalScopeRequest) {
  const eligibleIds = await getPaymentApprovalEligibility(companyId, authorization, [request]);
  return eligibleIds.has(request.id);
}
