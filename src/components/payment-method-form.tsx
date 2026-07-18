"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/submit-button";

type ComponentRow = {
  id: number;
  databaseId: string;
  type: "amount" | "production" | "";
  code: string;
  label: string;
  paySchedule: "per_hour" | "per_day" | "per_month" | "";
};

type InitialPaymentMethod = {
  id: string;
  code: string;
  name: string;
  components: Array<{
    id: string;
    component_code: string;
    component_type: "amount" | "production";
    label: string;
    pay_schedule: "per_hour" | "per_day" | "per_month" | null;
  }>;
};

export function PaymentMethodForm({
  action,
  initialMethod,
  submitLabel = "Create payment method"
}: {
  action: (formData: FormData) => Promise<void>;
  initialMethod?: InitialPaymentMethod;
  submitLabel?: string;
}) {
  const initialRows: ComponentRow[] = initialMethod?.components.length ? initialMethod.components.map((component, index) => ({
      id: index + 1,
      databaseId: component.id,
      type: component.component_type,
      code: component.component_code,
      label: component.label,
      paySchedule: component.pay_schedule ?? ""
    })) : [{ id: 1, databaseId: "", type: "", code: "", label: "", paySchedule: "" }];
  const [rows, setRows] = useState<ComponentRow[]>(initialRows);

  function updateRow(id: number, patch: Partial<ComponentRow>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function addRow() {
    setRows((current) => [
      ...current,
      { id: Math.max(...current.map((row) => row.id)) + 1, databaseId: "", type: "", code: "", label: "", paySchedule: "" }
    ]);
  }

  function removeRow(id: number) {
    setRows((current) => current.length > 1 ? current.filter((row) => row.id !== id) : current);
  }

  return (
    <form action={action} className="payment-method-form">
      {initialMethod ? <input type="hidden" name="id" value={initialMethod.id} /> : null}
      <input type="hidden" name="component_count" value={rows.length} />
      <div className="payment-method-layout">
        <div className="payment-method-fields">
          <label>Method ID
            <input className="field" defaultValue={initialMethod?.code} name="code" required />
          </label>
          <label>Method name
            <input className="field" defaultValue={initialMethod?.name} name="name" required />
          </label>
        </div>

        <div className="payment-component-list">
          <div className="payment-component-head">
            <strong>Payment fields</strong>
            <button className="button secondary compact" onClick={addRow} type="button">Add field</button>
          </div>

          {rows.map((row, index) => (
            <div className="payment-component-row" key={row.id}>
              <input type="hidden" name={`components[${index}][id]`} value={row.databaseId} />
              <label>Type
                <select
                  className="select"
                  name={`components[${index}][type]`}
                  onChange={(event) => {
                    const type = event.target.value as ComponentRow["type"];
                    updateRow(row.id, { type, paySchedule: type === "amount" ? row.paySchedule : "" });
                  }}
                  required
                  value={row.type}
                >
                  <option value="">Select type</option>
                  <option value="amount">Amount</option>
                  <option value="production">Production</option>
                </select>
              </label>
              <label>Field ID
                <input
                  className="field mono"
                  name={`components[${index}][code]`}
                  onChange={(event) => updateRow(row.id, { code: event.target.value })}
                  required
                  value={row.code}
                />
              </label>
              <label>Field label
                <input
                  className="field"
                  name={`components[${index}][label]`}
                  onChange={(event) => updateRow(row.id, { label: event.target.value })}
                  required
                  value={row.label}
                />
              </label>
              {row.type === "amount" ? (
                <label>Pay Schedule
                  <select
                    className="select"
                    name={`components[${index}][pay_schedule]`}
                    onChange={(event) => updateRow(row.id, { paySchedule: event.target.value as ComponentRow["paySchedule"] })}
                    required
                    value={row.paySchedule}
                  >
                    <option value="">Select schedule</option>
                    <option value="per_hour">Per Hour</option>
                    <option value="per_day">Per Day</option>
                    <option value="per_month">Per Month</option>
                  </select>
                </label>
              ) : <span className="payment-schedule-placeholder" aria-hidden="true" />}
              <button
                className="icon-button"
                disabled={rows.length <= 1}
                onClick={() => removeRow(row.id)}
                title="Remove field"
                type="button"
              >
                x
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="form-actions">
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
