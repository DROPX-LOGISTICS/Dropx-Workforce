import { AppShell } from "@/components/app-shell";
import { PaymentProcessPanel } from "@/components/payment-process-panel";
import { finalizePaymentProcess, updatePaymentProcessStatus } from "@/app/payments/process/actions";
import { isCompanyOwner, requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

type PaymentBankRow = {
  id: string;
  bank_code: string;
  display_name: string;
  account_no: string;
  ifsc: string;
  is_active: boolean;
};

type PaymentRequestRow = {
  id: string;
  request_no: string;
  location_code: string;
  payment_head_id: string;
  amount: number | null;
  amount_requested: number | null;
  payment_mode: string | null;
  payment_portal: string | null;
  bank_account_no: string | null;
  ifsc: string | null;
  account_holder_name: string | null;
  status: string;
  approval_status: string | null;
  current_approver_user_id: string | null;
  current_approver_role_id: string | null;
  created_at: string;
  payment_heads?: { name: string; code: string } | null;
};

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function isReadyForPaymentProcess(request: PaymentRequestRow) {
  const status = String(request.status ?? "").toUpperCase();
  const approvalStatus = String(request.approval_status ?? "").toUpperCase();
  const hasCurrentApprover = Boolean(request.current_approver_user_id || request.current_approver_role_id);
  const isOnlinePayment = (request.payment_mode ?? "account_transfer") === "online_payment";
  const hasPaymentDetails = isOnlinePayment
    ? Boolean(request.amount != null && request.payment_portal?.trim())
    : Boolean(
      request.amount != null &&
      request.bank_account_no?.trim() &&
      request.ifsc?.trim() &&
      request.account_holder_name?.trim()
    );
  return hasPaymentDetails && (status === "APPROVED" ||
    status === "PROCESSING" ||
    status === "PROCESSED" ||
    status === "OWNER_APPROVED" ||
    approvalStatus === "PROCESSING" ||
    approvalStatus === "PROCESSED" ||
    approvalStatus === "OWNER_APPROVED" ||
    (approvalStatus.endsWith("_APPROVED") && !hasCurrentApprover));
}

async function loadPaymentProcess(companyId: string, roleId: string | null, canSeeAllFinalApproved: boolean) {
  if (!supabaseAdmin) {
    return {
      banks: [] as PaymentBankRow[],
      requests: [] as PaymentRequestRow[],
      error: "Supabase service role key is not configured."
    };
  }
  if (!roleId && !canSeeAllFinalApproved) {
    return { banks: [] as PaymentBankRow[], requests: [] as PaymentRequestRow[], error: "Payment process role is not available." };
  }

  let requestsQuery = supabaseAdmin
    .from("payment_requests")
    .select("id, request_no, location_code, payment_head_id, amount, amount_requested, payment_mode, payment_portal, bank_account_no, ifsc, account_holder_name, status, approval_status, current_approver_user_id, current_approver_role_id, created_at, payment_heads ( name, code )")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });

  if (!canSeeAllFinalApproved && roleId) {
    requestsQuery = requestsQuery.contains("payment_process_role_ids", [roleId]);
  }

  const [banksResult, requestsResult] = await Promise.all([
    supabaseAdmin
      .from("payment_banks")
      .select("id, bank_code, display_name, account_no, ifsc, is_active")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("display_name"),
    requestsQuery
  ]);

  const error = banksResult.error?.message || requestsResult.error?.message || null;
  if (error) return { banks: [] as PaymentBankRow[], requests: [] as PaymentRequestRow[], error };
  return {
    banks: (banksResult.data ?? []) as PaymentBankRow[],
    requests: ((requestsResult.data ?? []) as unknown as PaymentRequestRow[])
      .filter(isReadyForPaymentProcess)
      .map((request) => ({
        ...request,
        payment_heads: firstRelation(request.payment_heads)
      })),
    error: null
  };
}

export const dynamic = "force-dynamic";

export default async function PaymentProcessPage({
  searchParams
}: {
  searchParams?: { processError?: string; processNotice?: string };
}) {
  const authorization = await requirePagePermission("payment_process", "access");
  const companyId = requireCompanyId(authorization);
  const pagePermission = authorization.permissions.payment_process;
  const canSeeAllFinalApproved = isCompanyOwner(authorization);
  const { banks, requests, error } = await loadPaymentProcess(companyId, authorization.roleId, canSeeAllFinalApproved);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <AppShell active="Payment Process" pageCode="payment_process">
      {error ? (
        <section className="panel message-panel error">
          <div className="panel-body">
            <strong>Payment process setup needed</strong>
            <p className="subtle" style={{ marginTop: 6 }}>{error} Run `scripts/payment_banks_v1.sql` and `scripts/payment_requests_v1.sql` in Supabase SQL Editor, then refresh.</p>
          </div>
        </section>
      ) : null}

      {searchParams?.processError || searchParams?.processNotice ? (
        <section className={`panel message-panel ${searchParams.processError ? "error" : "success"}`}>
          <div className="panel-body">
            <strong>{searchParams.processError ? "Payment process not finalized" : "Payment process finalized"}</strong>
            <p className="subtle" style={{ marginTop: 6 }}>{searchParams.processError || searchParams.processNotice}</p>
          </div>
        </section>
      ) : null}

      {!error && pagePermission.canView ? (
        <PaymentProcessPanel
          banks={banks.map((bank) => ({
            id: bank.id,
            bank_code: bank.bank_code,
            display_name: bank.display_name,
            account_no: bank.account_no
          }))}
          requests={requests.map((request) => ({
            id: request.id,
            request_no: request.request_no,
            location_code: request.location_code,
            amount: request.amount,
            amount_requested: request.amount_requested,
            payment_mode: request.payment_mode,
            status: request.status,
            approval_status: request.approval_status,
            created_at: request.created_at,
            payment_head_name: request.payment_heads?.name ?? null
          }))}
          finalizeAction={finalizePaymentProcess}
          finalizeResultKey={searchParams?.processError || searchParams?.processNotice || ""}
          processAction={updatePaymentProcessStatus}
          today={today}
        />
      ) : null}
    </AppShell>
  );
}
