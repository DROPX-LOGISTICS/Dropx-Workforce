"use client";

import { FormEvent, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { saveProviderMappingWorksheet } from "@/app/provider-mapping/actions";
import { SubmitButton } from "@/components/submit-button";

export type LocationOption = {
  id: string;
  label: string;
  providerId?: string;
};

export type MappingWorksheetRow = {
  id: string;
  mappingId: string;
  dropxId: string;
  dropxName: string;
  providerMemberId: string;
  providerId: string;
  stationId: string;
  effectiveFrom: string;
  effectiveTo: string;
  paymentMethodId: string;
  paymentValues: Record<string, string>;
  deliveryRate: string;
  pickupRate: string;
  mfnRate: string;
  mfnReturnRate: string;
  guaranteeAmount: string;
  guaranteeSchedule: string;
  fuelRate: string;
  reason: string;
};

export type PaymentMethodComponentOption = {
  code: string;
  label: string;
  type: "amount" | "production";
};

export type PaymentMethodOption = {
  id: string;
  code: string;
  name: string;
  components: PaymentMethodComponentOption[];
};

function rowSignature(row: MappingWorksheetRow) {
  return [
    row.id,
    row.mappingId,
    row.dropxId,
    row.dropxName,
    row.providerId,
    row.providerMemberId,
    row.stationId,
    row.effectiveFrom,
    row.effectiveTo,
    row.paymentMethodId,
    JSON.stringify(row.paymentValues),
    row.deliveryRate,
    row.pickupRate,
    row.mfnRate,
    row.mfnReturnRate,
    row.guaranteeAmount,
    row.guaranteeSchedule,
    row.fuelRate,
  ].join("|");
}

function RowSaveButton({ canEdit, dirty, index }: { canEdit: boolean; dirty: boolean; index: number }) {
  const { pending } = useFormStatus();

  return (
    <button
      className={`button compact mapping-row-save${dirty ? "" : " secondary"}`}
      disabled={pending || !canEdit || !dirty}
      name="save_row"
      type="submit"
      value={index}
    >
      {pending ? <span className="button-spinner" aria-hidden="true" /> : null}
      <span>{pending ? "Saving" : "Save"}</span>
    </button>
  );
}

export function ProviderMappingWorksheet({
  canEdit,
  locations,
  mappings,
  paymentMethods
}: {
  canEdit: boolean;
  locations: LocationOption[];
  mappings: MappingWorksheetRow[];
  paymentMethods: PaymentMethodOption[];
}) {
  const initialRows = useMemo(() => mappings, [mappings]);
  const initialSignatures = useMemo(() => initialRows.map(rowSignature), [initialRows]);
  const [rows, setRows] = useState(initialRows);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});

  function dismissSuccessMessage() {
    document.getElementById("provider-mapping-success")?.remove();
  }

  function updateRow(index: number, field: keyof MappingWorksheetRow, value: string) {
    dismissSuccessMessage();
    setRowErrors((current) => {
      if (!current[index]) return current;
      const next = { ...current };
      delete next[index];
      return next;
    });
    setRows((current) => current.map((row, rowIndex) => {
      if (rowIndex !== index) {
        return row;
      }

      if (field === "stationId") {
        const locationProviderId = locations.find((location) => location.id === value)?.providerId ?? "";
        return {
          ...row,
          stationId: value,
          providerId: locationProviderId || row.providerId
        };
      }

      if (field === "paymentMethodId") {
        return { ...row, paymentMethodId: value, paymentValues: {} };
      }

      return { ...row, [field]: value };
    }));
  }

  function updatePaymentValue(index: number, componentCode: string, value: string) {
    dismissSuccessMessage();
    setRowErrors((current) => {
      if (!current[index]) return current;
      const next = { ...current };
      delete next[index];
      return next;
    });
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? {
      ...row,
      paymentValues: {
        ...row.paymentValues,
        [componentCode]: value
      }
    } : row));
  }

  function validateRow(row: MappingWorksheetRow, index: number) {
    const method = paymentMethodById.get(row.paymentMethodId);

    if (!row.providerMemberId.trim()) return `Row ${index + 1}: Provider Member ID is required.`;
    if (!row.providerId) return `Row ${index + 1}: Provider is missing from the selected location.`;
    if (!row.paymentMethodId) return `Row ${index + 1}: Payment method is required.`;
    if (!method) return `Row ${index + 1}: Selected payment method was not found.`;
    if (!row.effectiveFrom) return `Row ${index + 1}: Effective from is required.`;
    if (row.effectiveTo && row.effectiveTo < row.effectiveFrom) return `Row ${index + 1}: Effective to cannot be before effective from.`;

    for (const component of method.components) {
      const rawValue = row.paymentValues[component.code]?.trim() ?? "";
      const value = Number(rawValue);
      if (!rawValue) return `Row ${index + 1}: ${component.label} is required.`;
      if (!Number.isFinite(value) || value < 0) return `Row ${index + 1}: ${component.label} must be a valid amount.`;
    }

    return null;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const rowIndexValue = submitter?.name === "save_row" ? submitter.value : null;
    const indexes = rowIndexValue !== null
      ? [Number(rowIndexValue)]
      : rows.map((_, index) => index).filter((index) => dirtyRows[index]);
    const nextErrors: Record<number, string> = {};

    indexes.forEach((index) => {
      const message = validateRow(rows[index], index);
      if (message) nextErrors[index] = message;
    });

    setRowErrors(nextErrors);

    if (Object.keys(nextErrors).length) {
      event.preventDefault();
    }
  }

  const dirtyRows = rows.map((row, index) => rowSignature(row) !== (initialSignatures[index] ?? ""));
  const hasDirtyRows = dirtyRows.some(Boolean);
  const locationLabelById = new Map(locations.map((location) => [location.id, location.label]));
  const paymentMethodById = new Map(paymentMethods.map((method) => [method.id, method]));

  if (!rows.length) {
    return (
      <section className="panel">
        <div className="empty-state">
          <strong>No DropX IDs available for mapping.</strong>
          <p className="subtle">Add field executives or import mapping rows first, then maintain provider IDs and payment setup here.</p>
        </div>
      </section>
    );
  }

  return (
    <form action={saveProviderMappingWorksheet} className="worksheet-form" onSubmit={handleSubmit}>
      <input type="hidden" name="row_count" value={rows.length} />
      <input
        type="hidden"
        name="dirty_row_indexes"
        value={JSON.stringify(dirtyRows.flatMap((dirty, index) => dirty ? [index] : []))}
      />
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>ID & pay mapping worksheet</h2>
            <p className="subtle">DropX ID, name, and location are read-only. Select a payment method to show only its configured fields.</p>
          </div>
          <SubmitButton disabled={!canEdit || !hasDirtyRows} disabledText={canEdit ? "No edits" : "No edit access"}>
            Save all
          </SubmitButton>
        </div>

        <div className="mapping-rows">
          {rows.map((row, index) => (
            <div className={`mapping-row-card ${dirtyRows[index] ? "unsaved-row" : ""}`} key={`${row.id || row.dropxId}-${index}`}>
              <input type="hidden" name={`rows[${index}][id]`} value={row.id} />
              <input type="hidden" name={`rows[${index}][mapping_id]`} value={row.mappingId} />
              <input type="hidden" name={`rows[${index}][dropx_id]`} value={row.dropxId} />
              <input type="hidden" name={`rows[${index}][dropx_name]`} value={row.dropxName} />
              <input type="hidden" name={`rows[${index}][provider_id]`} value={row.providerId} />
              <input type="hidden" name={`rows[${index}][station_id]`} value={row.stationId} />
              <input type="hidden" name={`rows[${index}][payment_values_json]`} value={JSON.stringify(row.paymentValues)} />

              {dirtyRows[index] ? <span className="unsaved-badge mapping-unsaved-badge">Unsaved</span> : null}

              <div className="mapping-identity">
                <span className="mapping-dropx-id mono">{row.dropxId}</span>
                <strong>{row.dropxName || "-"}</strong>
                <span>{locationLabelById.get(row.stationId) ?? "No location"}</span>
                <label>Provider Member ID
                  <input
                    className="worksheet-input mono"
                    disabled={!canEdit}
                    name={`rows[${index}][provider_member_id]`}
                    onChange={(event) => updateRow(index, "providerMemberId", event.target.value)}
                    value={row.providerMemberId}
                  />
                </label>
              </div>

              <div className="mapping-edit-grid">
                <label>Payment method
                  <select
                    className="worksheet-select"
                    disabled={!canEdit}
                    name={`rows[${index}][payment_method_id]`}
                    onChange={(event) => updateRow(index, "paymentMethodId", event.target.value)}
                    value={row.paymentMethodId}
                  >
                    <option value="">Select payment method</option>
                    {paymentMethods.map((method) => (
                      <option key={method.id} value={method.id}>{method.name}</option>
                    ))}
                  </select>
                </label>

                {(paymentMethodById.get(row.paymentMethodId)?.components ?? []).map((component) => (
                  <label key={component.code}>{component.label}
                    <input
                      className="worksheet-input"
                      disabled={!canEdit}
                      min="0"
                      name={`rows[${index}][payment_values][${component.code}]`}
                      onChange={(event) => updatePaymentValue(index, component.code, event.target.value)}
                      placeholder="0.00"
                      step="0.01"
                      type="number"
                      value={row.paymentValues[component.code] ?? ""}
                    />
                  </label>
                ))}
                <div className="mapping-period-row">
                  <label>Effective from
                    <input
                      className="worksheet-input"
                      disabled={!canEdit}
                      name={`rows[${index}][effective_from]`}
                      onChange={(event) => updateRow(index, "effectiveFrom", event.target.value)}
                      type="date"
                      value={row.effectiveFrom}
                    />
                  </label>

                  <label>Effective to
                    <input
                      className="worksheet-input"
                      disabled={!canEdit}
                      name={`rows[${index}][effective_to]`}
                      onChange={(event) => updateRow(index, "effectiveTo", event.target.value)}
                      type="date"
                      value={row.effectiveTo}
                    />
                  </label>

                  <RowSaveButton canEdit={canEdit} dirty={dirtyRows[index]} index={index} />
                </div>
                {rowErrors[index] ? <div className="mapping-row-error">{rowErrors[index]}</div> : null}
              </div>
            </div>
          ))}
        </div>
      </section>
    </form>
  );
}
