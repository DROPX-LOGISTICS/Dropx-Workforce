import { hasPermission, isCompanyOwner, type AuthorizationContext } from "@/lib/authorization";
import { currentAccessSurface } from "@/lib/access-surface";
import { getPaymentApprovalEligibility } from "@/lib/payment-approval-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type PaymentNotificationItem = {
  key: string;
  label: string;
  detail: string;
  href: string;
  count: number;
};

export type PaymentNotificationSnapshot = {
  total: number;
  badges: Record<string, number>;
  items: PaymentNotificationItem[];
};

type PaymentHeadRelation = {
  code: string | null;
  name: string | null;
};

type PaymentNotificationRequest = {
  id: string;
  request_no: string | null;
  location_id: string | null;
  location_code: string | null;
  requested_by: string | null;
  category: string | null;
  amount: number | null;
  amount_requested: number | null;
  payment_mode: string | null;
  payment_portal: string | null;
  bank_account_no: string | null;
  ifsc: string | null;
  account_holder_name: string | null;
  status: string | null;
  approval_status: string | null;
  current_approver_user_id: string | null;
  current_approver_role_id: string | null;
  payment_process_role_ids: string[] | null;
  created_at: string | null;
  payment_heads?: PaymentHeadRelation | PaymentHeadRelation[] | null;
};

const EMPTY_BADGES = {
  payments: 0,
  expense_requests: 0,
  payment_requests: 0,
  payment_approvals: 0,
  payment_process: 0,
  payment_reports: 0
};

const CLOSED_STATUSES = new Set(["APPROVED", "REJECTED", "RETURNED", "CANCELLED", "PROCESSING", "PROCESSED"]);

export function emptyPaymentNotificationSnapshot(): PaymentNotificationSnapshot {
  return {
    total: 0,
    badges: { ...EMPTY_BADGES },
    items: []
  };
}

function normalizeStatus(value: string | null | undefined) {
  return String(value ?? "").trim().toUpperCase();
}

function requestStatus(request: PaymentNotificationRequest) {
  return normalizeStatus(request.approval_status || request.status);
}

function isExpenseRequest(request: PaymentNotificationRequest) {
  return normalizeStatus(request.category) === "EXPENSE";
}

function isReturnedOrRejected(request: PaymentNotificationRequest) {
  const status = requestStatus(request);
  return status === "RETURNED" || status === "REJECTED";
}

function hasCurrentApprover(request: PaymentNotificationRequest) {
  return Boolean(request.current_approver_user_id || request.current_approver_role_id);
}

function isFinalApproved(request: PaymentNotificationRequest) {
  const status = requestStatus(request);
  return (
    status === "APPROVED" ||
    status === "OWNER_APPROVED" ||
    (status.endsWith("_APPROVED") && !hasCurrentApprover(request))
  );
}

function hasPaymentDetails(request: PaymentNotificationRequest) {
  const mode = normalizeStatus(request.payment_mode || "account_transfer");
  if (request.amount === null || request.amount === undefined) return false;
  if (mode === "ONLINE") return Boolean(request.payment_portal?.trim());
  return Boolean(request.bank_account_no?.trim() && request.ifsc?.trim() && request.account_holder_name?.trim());
}

function needsPaymentDetails(request: PaymentNotificationRequest) {
  return isExpenseRequest(request) && isFinalApproved(request) && !hasPaymentDetails(request);
}

function isPendingApproval(request: PaymentNotificationRequest) {
  const status = requestStatus(request);
  if (CLOSED_STATUSES.has(status)) return false;
  return Boolean(request.current_approver_user_id || request.current_approver_role_id || status === "PENDING" || !status);
}

function isReadyForPaymentProcess(request: PaymentNotificationRequest) {
  return isFinalApproved(request) && hasPaymentDetails(request) && requestStatus(request) !== "PROCESSED";
}

function canProcessPayment(request: PaymentNotificationRequest, authorization: AuthorizationContext) {
  if (isCompanyOwner(authorization) || authorization.isMasterOwner) return true;
  if (!authorization.roleId) return false;
  return (request.payment_process_role_ids ?? []).includes(authorization.roleId);
}

function addItem(items: PaymentNotificationItem[], key: string, label: string, detail: string, href: string, count: number) {
  if (count <= 0) return;
  items.push({ key, label, detail, href, count });
}

export async function loadPaymentNotificationSnapshot(authorization: AuthorizationContext): Promise<PaymentNotificationSnapshot> {
  if (!authorization.companyId) return emptyPaymentNotificationSnapshot();

  const accessSurface = currentAccessSurface();
  const badges = { ...EMPTY_BADGES };
  const items: PaymentNotificationItem[] = [];
  const canSeePayments = hasPermission(authorization, "payments", "access");
  if (!canSeePayments) return emptyPaymentNotificationSnapshot();
  if (!supabaseAdmin) return emptyPaymentNotificationSnapshot();

  const { data, error } = await supabaseAdmin
    .from("payment_requests")
    .select(`
      id,
      request_no,
      location_id,
      location_code,
      requested_by,
      category,
      amount,
      amount_requested,
      payment_mode,
      payment_portal,
      bank_account_no,
      ifsc,
      account_holder_name,
      status,
      approval_status,
      current_approver_user_id,
      current_approver_role_id,
      payment_process_role_ids,
      created_at,
      payment_heads (
        code,
        name
      )
    `)
    .eq("company_id", authorization.companyId)
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error || !data) return emptyPaymentNotificationSnapshot();

  const requests = data as PaymentNotificationRequest[];
  const ownRequests = authorization.userId
    ? requests.filter((request) => request.requested_by === authorization.userId)
    : [];

  if (accessSurface === "ops" && hasPermission(authorization, "expense_requests", "access")) {
    badges.expense_requests = ownRequests
      .filter(isExpenseRequest)
      .filter((request) => isReturnedOrRejected(request) || needsPaymentDetails(request))
      .length;
    addItem(
      items,
      "expense_requests",
      "Expense requests",
      `${badges.expense_requests} expense request${badges.expense_requests === 1 ? "" : "s"} need attention`,
      "/payments/expense-request",
      badges.expense_requests
    );
  }

  if (accessSurface === "ops" && hasPermission(authorization, "payment_requests", "access")) {
    badges.payment_requests = ownRequests
      .filter((request) => !isExpenseRequest(request))
      .filter(isReturnedOrRejected)
      .length;
    addItem(
      items,
      "payment_requests",
      "Payment requests",
      `${badges.payment_requests} payment request${badges.payment_requests === 1 ? "" : "s"} returned or rejected`,
      "/payments/requests",
      badges.payment_requests
    );
  }

  if (accessSurface === "ops" && hasPermission(authorization, "payment_approvals", "access")) {
    const eligibleApprovalIds = await getPaymentApprovalEligibility(
      authorization.companyId,
      authorization,
      requests.map((request) => ({
        id: request.id,
        location_id: request.location_id,
        requested_by: request.requested_by,
        current_approver_user_id: request.current_approver_user_id,
        current_approver_role_id: request.current_approver_role_id
      }))
    );
    badges.payment_approvals = requests
      .filter((request) => eligibleApprovalIds.has(request.id))
      .filter(isPendingApproval)
      .length;
    addItem(
      items,
      "payment_approvals",
      "Payment approvals",
      `${badges.payment_approvals} request${badges.payment_approvals === 1 ? "" : "s"} waiting for approval`,
      "/payments/approvals",
      badges.payment_approvals
    );
  }

  if (accessSurface === "dashboard" && hasPermission(authorization, "payment_process", "access")) {
    badges.payment_process = requests
      .filter((request) => canProcessPayment(request, authorization))
      .filter(isReadyForPaymentProcess)
      .length;
    addItem(
      items,
      "payment_process",
      "Payment process",
      `${badges.payment_process} approved payment${badges.payment_process === 1 ? "" : "s"} ready to process`,
      "/payments/process",
      badges.payment_process
    );
  }

  badges.payments = badges.expense_requests + badges.payment_requests + badges.payment_approvals + badges.payment_process;

  return {
    total: badges.payments,
    badges,
    items
  };
}
