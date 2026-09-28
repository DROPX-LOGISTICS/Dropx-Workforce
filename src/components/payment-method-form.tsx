"use client";

import { useMemo, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import {
  defaultComponentRule,
  earningRuleOptions,
  shipmentMetrics,
  type PaymentComponentRule
} from "@/lib/payment-component-rules";

export type PaymentFieldOption = {
  id: string; code: string; label: string;
  field_type: "amount" | "production";
  pay_schedule: "per_hour" | "per_day" | "per_month" | null;
  is_active: boolean;
};

export type PaymentDesignationOption = { id: string; code: string; name: string };

const metricLabels: Record<typeof shipmentMetrics[number], string> = {
  total_delivery: "Total delivery",
  total_activity: "Total activity",
  amazon_delivery: "Amazon delivery",
  swa_delivery: "SWA delivery",
  customer_return: "Customer return",
  seller_pickup: "Seller pickup",
  seller_return: "Seller return"
};

export function PaymentMethodForm({ action, availableFields, availableDesignations, initialMethod, submitLabel = "Create payment method" }: {
  action: (formData: FormData) => Promise<void>;
  availableFields: PaymentFieldOption[];
  availableDesignations: PaymentDesignationOption[];
  initialMethod?: { id: string; code: string; name: string; usage_count: number; field_ids: string[]; designation_ids: string[]; component_rules: PaymentComponentRule[] };
  submitLabel?: string;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>(initialMethod?.field_ids ?? []);
  const [selectedDesignationIds, setSelectedDesignationIds] = useState<string[]>(initialMethod?.designation_ids ?? []);
  const [rules, setRules] = useState<Record<string, PaymentComponentRule>>(() => Object.fromEntries((initialMethod?.component_rules ?? []).map((rule) => [rule.fieldId, rule])));
  const [search, setSearch] = useState("");
  const [designationSearch, setDesignationSearch] = useState("");
  const locked = Boolean(initialMethod?.usage_count);
  const fields = availableFields.filter((field) => (field.is_active || selectedIds.includes(field.id)) &&
    `${field.code} ${field.label}`.toLowerCase().includes(search.trim().toLowerCase()));
  const selectedRules = useMemo(() => selectedIds.map((fieldId) => {
    const field = availableFields.find((item) => item.id === fieldId)!;
    return rules[fieldId] ?? defaultComponentRule(field);
  }), [availableFields, rules, selectedIds]);
  const rulesComplete = selectedRules.every((rule) => rule.sourceOfTruth !== "amazon_daily_shipment" || Boolean(rule.sourceMetric))
    && selectedRules.every((rule) => rule.calculationBasis !== "shipment_active_day" || rule.minimumUnits !== null);

  const selectField = (field: PaymentFieldOption, checked: boolean) => {
    setSelectedIds((current) => checked ? [...current, field.id] : current.filter((id) => id !== field.id));
    if (checked) setRules((current) => current[field.id] ? current : { ...current, [field.id]: defaultComponentRule(field) });
  };
  const updateRule = (field: PaymentFieldOption, patch: Partial<PaymentComponentRule>) => setRules((current) => ({
    ...current,
    [field.id]: { ...(current[field.id] ?? defaultComponentRule(field)), ...patch, fieldId: field.id, componentCode: field.code }
  }));

  return (
    <form action={action} className="payment-method-form">
      {initialMethod ? <input type="hidden" name="id" value={initialMethod.id} /> : null}
      {selectedIds.map((id) => <input key={id} name="field_ids" type="hidden" value={id} />)}
      {selectedDesignationIds.map((id) => <input key={id} name="designation_ids" type="hidden" value={id} />)}
      <input type="hidden" name="component_rules_json" value={JSON.stringify(selectedRules)} />
      <div className="payment-method-layout">
        <div className="payment-method-fields">
          <label>Method ID<input className="field" name="code" required maxLength={80} pattern="[A-Za-z0-9_]+" readOnly={locked} defaultValue={initialMethod?.code} /></label>
          <label>Method name<input className="field" name="name" required maxLength={160} defaultValue={initialMethod?.name} /></label>
          <fieldset className="payment-designation-picker">
            <legend>Eligible designations · {selectedDesignationIds.length} selected</legend>
            <input className="field" type="search" aria-label="Search designations" placeholder="Search designations" value={designationSearch} onChange={(event) => setDesignationSearch(event.target.value)} />
            <div className="payment-designation-options">
              {availableDesignations.filter((designation) => `${designation.code} ${designation.name}`.toLowerCase().includes(designationSearch.trim().toLowerCase())).map((designation) => (
                <label key={designation.id} className="workforce-method-option">
                  <input type="checkbox" checked={selectedDesignationIds.includes(designation.id)} onChange={(event) => setSelectedDesignationIds((current) => event.target.checked ? [...current, designation.id] : current.filter((id) => id !== designation.id))} />
                  <span><strong>{designation.name}</strong><small>{designation.code}</small></span>
                </label>
              ))}
            </div>
          </fieldset>
          {locked ? <p className="subtle">In use in {initialMethod?.usage_count} mappings. The fields stay fixed; designation eligibility and each field’s earning rule can change for future payment stages.</p> : null}
        </div>
        <fieldset className="workforce-method-picker payment-component-picker">
          <legend>Payment components · {selectedIds.length} selected</legend>
          <p className="subtle">Each component decides what evidence earns it. Hybrid methods can combine attendance-day and shipment rules.</p>
          <input className="field" type="search" aria-label="Search payment fields" placeholder="Search fields" value={search} onChange={(event) => setSearch(event.target.value)} />
          <div className="workforce-method-options">
            {fields.map((field) => {
              const selected = selectedIds.includes(field.id);
              const rule = rules[field.id] ?? defaultComponentRule(field);
              const ruleValue = `${rule.sourceOfTruth}:${rule.calculationBasis}`;
              return <div key={field.id} className={`payment-component-option${selected ? " selected" : ""}`}>
                <label className="workforce-method-option">
                  <input type="checkbox" disabled={locked || !field.is_active} checked={selected} onChange={(event) => selectField(field, event.target.checked)} />
                  <span><strong>{field.label}</strong><small>{field.code} · {field.field_type === "production" ? "Production" : field.pay_schedule?.replaceAll("_", " ")}{!field.is_active ? " · Inactive" : ""}</small></span>
                </label>
                {selected ? <div className="payment-component-rule">
                  <label>Earning rule<select className="field" aria-label={`${field.label} earning rule`} value={ruleValue} onChange={(event) => {
                    const [sourceOfTruth, calculationBasis] = event.target.value.split(":") as [PaymentComponentRule["sourceOfTruth"], PaymentComponentRule["calculationBasis"]];
                    updateRule(field, {
                      sourceOfTruth, calculationBasis,
                      sourceMetric: sourceOfTruth === "amazon_daily_shipment" ? rule.sourceMetric : null,
                      minimumUnits: calculationBasis === "shipment_active_day" ? (rule.minimumUnits ?? 1) : null
                    });
                  }}>{earningRuleOptions(field).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                  {rule.sourceOfTruth === "amazon_daily_shipment" ? <label>Amazon metric<select className="field" required aria-label={`${field.label} Amazon metric`} value={rule.sourceMetric ?? ""} onChange={(event) => updateRule(field, { sourceMetric: event.target.value as PaymentComponentRule["sourceMetric"] })}>
                    <option value="" disabled>Select metric</option>
                    {shipmentMetrics.map((metric) => <option key={metric} value={metric}>{metricLabels[metric]}</option>)}
                  </select></label> : null}
                  {rule.calculationBasis === "shipment_active_day" ? <label>Minimum units<input className="field" aria-label={`${field.label} minimum units`} type="number" min="0" max="1000000" step="1" required value={rule.minimumUnits ?? 1} onChange={(event) => updateRule(field, { minimumUnits: Number(event.target.value) })} /></label> : null}
                </div> : null}
              </div>;
            })}
            {!fields.length ? <p className="subtle">No matching payment fields.</p> : null}
          </div>
        </fieldset>
      </div>
      <div className="form-actions"><SubmitButton disabled={!selectedIds.length || !selectedDesignationIds.length || selectedRules.length !== selectedIds.length || !rulesComplete}>{submitLabel}</SubmitButton></div>
    </form>
  );
}
