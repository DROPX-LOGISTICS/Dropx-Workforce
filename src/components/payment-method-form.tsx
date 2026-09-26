"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/submit-button";

export type PaymentFieldOption = {
  id: string; code: string; label: string;
  field_type: "amount" | "production";
  pay_schedule: "per_hour" | "per_day" | "per_month" | null;
  is_active: boolean;
};

export function PaymentMethodForm({ action, availableFields, initialMethod, submitLabel = "Create payment method" }: {
  action: (formData: FormData) => Promise<void>;
  availableFields: PaymentFieldOption[];
  initialMethod?: { id: string; code: string; name: string; usage_count: number; field_ids: string[]; source_of_truth: string };
  submitLabel?: string;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>(initialMethod?.field_ids ?? []);
  const [search, setSearch] = useState("");
  const locked = Boolean(initialMethod?.usage_count);
  const fields = availableFields.filter((field) => (field.is_active || selectedIds.includes(field.id)) &&
    `${field.code} ${field.label}`.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <form action={action} className="payment-method-form">
      {initialMethod ? <input type="hidden" name="id" value={initialMethod.id} /> : null}
      {selectedIds.map((id) => <input key={id} name="field_ids" type="hidden" value={id} />)}
      <div className="payment-method-layout">
        <div className="payment-method-fields">
          <label>Method ID<input className="field" name="code" required maxLength={80} pattern="[A-Za-z0-9_]+" readOnly={locked} defaultValue={initialMethod?.code} /></label>
          <label>Method name<input className="field" name="name" required maxLength={160} defaultValue={initialMethod?.name} /></label>
          <label>Source of truth<select className="field" name="source_of_truth" required defaultValue={initialMethod?.source_of_truth ?? ""}>
            <option value="" disabled>Select source</option>
            <option value="biometric_attendance">Biometric attendance</option>
            <option value="amazon_daily_shipment">Amazon Daily Shipment Count</option>
            <option value="manual_approved">Approved manual evidence</option>
          </select><small>This controls which operational record can earn this payment.</small></label>
          {locked ? <p className="subtle">In use in {initialMethod?.usage_count} mappings. You can rename it; create a new method to change fields.</p> : null}
        </div>
        <fieldset className="workforce-method-picker">
          <legend>Payment fields · {selectedIds.length} selected</legend>
          <input className="field" type="search" aria-label="Search payment fields" placeholder="Search fields" value={search} onChange={(event) => setSearch(event.target.value)} />
          <div className="workforce-method-options">
            {fields.map((field) => (
              <label key={field.id} className="workforce-method-option">
                <input type="checkbox" disabled={locked || !field.is_active} checked={selectedIds.includes(field.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, field.id] : current.filter((id) => id !== field.id))} />
                <span><strong>{field.label}</strong><small>{field.code} · {field.field_type === "production" ? "Production" : field.pay_schedule?.replaceAll("_", " ")}{!field.is_active ? " · Inactive" : ""}</small></span>
              </label>
            ))}
            {!fields.length ? <p className="subtle">No matching payment fields.</p> : null}
          </div>
        </fieldset>
      </div>
      <div className="form-actions"><SubmitButton disabled={!selectedIds.length}>{submitLabel}</SubmitButton></div>
    </form>
  );
}
