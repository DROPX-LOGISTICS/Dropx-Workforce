import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { PaymentMethodForm, type PaymentFieldOption } from "@/components/payment-method-form";
import { StatusPill } from "@/components/status-pill";
import { SubmitButton } from "@/components/submit-button";
import { PendingLink } from "@/components/pending-link";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createPaymentMethod, deletePaymentMethod, updatePaymentMethod } from "./actions";
import { cookies } from "next/headers";

type PaymentComponentRow = {
  id: string;
  payment_field_id: string;
  component_code: string;
  component_type: "amount" | "production";
  label: string;
  pay_schedule: "per_hour" | "per_day" | "per_month" | null;
  sort_order: number;
  is_active: boolean;
};

type PaymentMethodRow = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  payment_method_components?: PaymentComponentRow[] | null;
  usage_count: number;
  source_of_truth: string;
};

async function loadPaymentMethods(companyId: string) {
  if (!supabaseAdmin) {
    return {
      methods: [] as PaymentMethodRow[],
      error: "Supabase service role key is not configured."
    };
  }

  const { data, error } = await supabaseAdmin
    .from("payment_methods")
    .select(`
      id,
      code,
      name,
      is_active,
      payment_method_components (
        id,
        payment_field_id,
        component_code,
        component_type,
        label,
        pay_schedule,
        sort_order,
        is_active
      )
    `)
    .eq("company_id", companyId)
    .order("code");

  if (error) return { methods: [] as PaymentMethodRow[], error: error.message };

  const sourceResult = await supabaseAdmin.from("workforce_payment_method_sources")
    .select("payment_method_id,source_of_truth").eq("company_id",companyId);
  if (sourceResult.error) return { methods: [] as PaymentMethodRow[], error: sourceResult.error.message };
  const sourceByMethod = new Map((sourceResult.data ?? []).map((row) => [row.payment_method_id,row.source_of_truth]));
  const usage = await Promise.all((data ?? []).map(async (method) => {
    const result = await supabaseAdmin!.from("field_executive_provider_mappings")
      .select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("payment_method_id", method.id);
    return { id: method.id, count: result.count ?? 0, error: result.error };
  }));
  const usageError = usage.find((item) => item.error)?.error;
  if (usageError) return { methods: [] as PaymentMethodRow[], error: usageError.message };
  const usageByMethod = new Map(usage.map((item) => [item.id, item.count]));

  return {
    methods: ((data ?? []) as Omit<PaymentMethodRow, "usage_count">[]).map((method) => ({
      ...method,
      usage_count: usageByMethod.get(method.id) ?? 0,
      source_of_truth: sourceByMethod.get(method.id) ?? "",
      payment_method_components: (method.payment_method_components ?? [])
        .slice()
        .sort((first, second) => first.sort_order - second.sort_order)
    })),
    error: null
  };
}

function loadPaymentMethodFlash() {
  const raw = cookies().get("dropx_payment_method_flash")?.value;
  if (!raw) return { error: null as string | null, notice: null as string | null };
  try {
    const parsed = JSON.parse(raw) as { error?: unknown; notice?: unknown };
    return {
      error: typeof parsed.error === "string" ? parsed.error : null,
      notice: typeof parsed.notice === "string" ? parsed.notice : null
    };
  } catch {
    return { error: null, notice: null };
  }
}

export const dynamic = "force-dynamic";

export default async function PaymentMethodsPage({ searchParams }: { searchParams?: { edit?: string; fields?: string } }) {
  const authorization = await requirePagePermission("payment_methods", "access");
  const companyId = requireCompanyId(authorization);
  const pagePermission = authorization.permissions.payment_methods;
  const [{ methods, error: methodsError }, fieldResult] = await Promise.all([
    loadPaymentMethods(companyId),
    supabaseAdmin?.from("payment_fields").select("id,code,label,field_type,pay_schedule,is_active").eq("company_id", companyId).order("label")
  ]);
  const error = methodsError ?? fieldResult?.error?.message;
  const fields = (fieldResult?.data ?? []) as PaymentFieldOption[];
  const flash = loadPaymentMethodFlash();
  const editMethod = methods.find((method) => method.id === searchParams?.edit) ?? null;

  return (
    <AppShell active="Payment Methods" pageCode="payment_methods">
      <PageHead
        eyebrow="Master"
        title="Payment methods"
        subtitle="Shared with Dashboard. Choose the fields here; set each associate’s rates in ID & Rate Mapping."
        action={<div className="component-chip-list">
          <PendingLink className="button secondary compact" href="/master/payment-methods?fields=1">Payment fields</PendingLink>
          {authorization.permissions.provider_mapping?.canView ? <PendingLink className="button compact" href="/delivery-network/rate-mapping">ID & Rate Mapping</PendingLink> : null}
        </div>}
      />

      {error ? (
        <section className="panel message-panel error">
          <div className="panel-body">
            <strong>Unable to load payment methods</strong>
            <p className="subtle" style={{ marginTop: 6 }}>
              Please retry shortly. No payment configuration has been changed.
            </p>
          </div>
        </section>
      ) : null}

      {!error && (flash.error || flash.notice) ? (
        <section className={`panel message-panel ${flash.error ? "error" : "success"}`}>
          <div className="panel-body">
            <strong>{flash.error ? "Payment method not saved" : "Completed"}</strong>
            <p className="subtle" style={{ marginTop: 6 }}>{flash.error ?? flash.notice}</p>
          </div>
        </section>
      ) : null}

      {!error && pagePermission.canAdd ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Add payment method</h2>
              <p className="subtle">Use the existing field catalog. Creating a method does not change anyone’s rates.</p>
            </div>
          </div>
          <PaymentMethodForm action={createPaymentMethod} availableFields={fields} />
        </section>
      ) : null}

      {!error && pagePermission.canView ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Payment method list</h2>
              <p className="subtle">{methods.length} records. Components decide which fields appear in mapping later.</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Method ID</th>
                  <th>Name</th>
                  <th>Configured fields</th>
                  <th>Source of truth</th>
                  <th>Status</th>
                  {pagePermission.canEdit ? <th>Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {methods.length ? methods.map((method) => (
                  <tr key={method.id}>
                    <td><strong>{method.code}</strong></td>
                    <td>{method.name}</td>
                    <td>
                      <div className="component-chip-list">
                        {(method.payment_method_components ?? []).length ? method.payment_method_components?.map((component) => (
                          <span className={`component-chip ${component.component_type}`} key={component.id}>
                            {component.label}
                            <small>
                              {component.component_code} | {component.component_type === "amount" ? "Amount" : "Production"}
                              {component.pay_schedule ? ` | ${component.pay_schedule === "per_hour" ? "Per Hour" : component.pay_schedule === "per_day" ? "Per Day" : "Per Month"}` : ""}
                            </small>
                          </span>
                        )) : <span className="subtle">No fields configured</span>}
                      </div>
                    </td>
                    <td>{method.source_of_truth ? method.source_of_truth.replaceAll("_"," ") : <span className="status-badge warning">Configure</span>}</td>
                    <td><StatusPill status={method.is_active ? "Active" : "Inactive"} /></td>
                    {pagePermission.canEdit ? <td><PendingLink className="button secondary compact" href={`/master/payment-methods?edit=${method.id}`} scroll={false}>Edit</PendingLink></td> : null}
                  </tr>
                )) : (
                  <tr><td className="empty-cell" colSpan={pagePermission.canEdit ? 6 : 5}>No payment methods added yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {!error && editMethod && pagePermission.canEdit ? (
        <div className="modal-backdrop">
          <section className="modal-panel wide" aria-label="Edit payment method">
            <div className="panel-head">
              <div><h2>Edit payment method</h2><p className="subtle">Update the method and its configured payment fields.</p></div>
              <PendingLink className="icon-button" href="/master/payment-methods" scroll={false} aria-label="Close">x</PendingLink>
            </div>
            <PaymentMethodForm
              key={editMethod.id}
              action={updatePaymentMethod}
              availableFields={fields}
              initialMethod={{
                id: editMethod.id,
                code: editMethod.code,
                name: editMethod.name,
                usage_count: editMethod.usage_count,
                source_of_truth: editMethod.source_of_truth,
                field_ids: (editMethod.payment_method_components ?? []).map((component) => component.payment_field_id)
              }}
              submitLabel="Save changes"
            />
            <form action={deletePaymentMethod} className="danger-form">
              <input type="hidden" name="id" value={editMethod.id} />
              <SubmitButton
                className="button warning"
                confirmationBlocked={editMethod.usage_count > 0}
                confirmMessage={editMethod.usage_count > 0
                  ? `This payment method is used in ${editMethod.usage_count} mapping${editMethod.usage_count === 1 ? "" : "s"} and cannot be deleted.`
                  : "Delete this payment method? This action cannot be undone."}
                pendingText="Deleting"
              >Delete payment method</SubmitButton>
            </form>
          </section>
        </div>
      ) : null}
      {!error && searchParams?.fields === "1" ? (
        <div className="modal-backdrop">
          <section className="modal-panel wide" role="dialog" aria-modal="true" aria-label="Payment fields">
            <div className="panel-head">
              <div><h2>Payment fields</h2><p className="subtle">The same reusable catalog used by Dashboard and provider-ID mapping.</p></div>
              <PendingLink className="icon-button" href="/master/payment-methods" aria-label="Close payment fields">×</PendingLink>
            </div>
            <div className="table-wrap"><table>
              <thead><tr><th>Field</th><th>Field ID</th><th>Type / schedule</th><th>Status</th></tr></thead>
              <tbody>{fields.map((field) => <tr key={field.id}><td>{field.label}</td><td>{field.code}</td><td>{field.field_type === "production" ? "Production" : field.pay_schedule?.replaceAll("_", " ")}</td><td><StatusPill status={field.is_active ? "Active" : "Inactive"} /></td></tr>)}</tbody>
            </table></div>
            <div className="panel-body"><a className="button secondary compact" href="https://dashboard.dropxlogistics.com/master/payment-methods?fields=1" target="_blank" rel="noreferrer">Manage shared field definitions in Dashboard ↗</a></div>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
