"use client";

import { useMemo, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { saveExecutiveReconciliation } from "./actions";

type AssociateOption = {
  name: string;
  providerEmployeeId: string;
  shipmentType: string;
  pendingAmount: number;
};

type EntryRow = {
  key: number;
  providerEmployeeId: string;
};

const denominations = [
  ["cash_500_count", "₹500"],
  ["cash_200_count", "₹200"],
  ["cash_100_count", "₹100"],
  ["cash_50_count", "₹50"],
  ["cash_20_count", "₹20"],
  ["cash_10_count", "₹10"]
] as const;

export function AssociateEntryBuilder({
  associates,
  businessDate,
  canEdit,
  locationId,
  returnHref,
  stationCode,
  stationLabel
}: {
  associates: AssociateOption[];
  businessDate: string;
  canEdit: boolean;
  locationId: string;
  returnHref: string;
  stationCode: string;
  stationLabel: string;
}) {
  const [rows, setRows] = useState<EntryRow[]>([{ key: 1, providerEmployeeId: "" }]);
  const optionMap = useMemo(
    () => new Map(associates.map((associate) => [associate.providerEmployeeId, associate])),
    [associates]
  );

  function addRow() {
    setRows((current) => [
      ...current,
      {
        key: Math.max(0, ...current.map((row) => row.key)) + 1,
        providerEmployeeId: ""
      }
    ]);
  }

  function removeRow(key: number) {
    setRows((current) => current.length === 1 ? current : current.filter((row) => row.key !== key));
  }

  function selectAssociate(key: number, providerEmployeeId: string) {
    setRows((current) => current.map((row) => row.key === key ? { ...row, providerEmployeeId } : row));
  }

  return (
    <div className="reconciliation-entry-list" aria-label="Add associate reconciliation rows">
      {rows.map((entry, index) => {
        const associate = optionMap.get(entry.providerEmployeeId);
        const formId = `new-reconciliation-${entry.key}`;
        return (
          <article className="reconciliation-entry-card" key={entry.key}>
            <div className="reconciliation-entry-grid">
              <label>Associate
                <select
                  className="field"
                  value={entry.providerEmployeeId}
                  onChange={(event) => selectAssociate(entry.key, event.target.value)}
                  required
                  aria-label={`Associate ${index + 1}`}
                  form={formId}
                  name="provider_employee_id"
                >
                  <option value="">Select associate</option>
                  {associates.map((option) => (
                    <option
                      disabled={rows.some((row) => row.key !== entry.key && row.providerEmployeeId === option.providerEmployeeId)}
                      key={option.providerEmployeeId}
                      value={option.providerEmployeeId}
                    >
                      {option.name} · {option.providerEmployeeId}
                    </option>
                  ))}
                </select>
              </label>
              <label>Expected COD
                <input
                  className="field"
                  form={formId}
                  name="expected_amount"
                  defaultValue={associate ? String(associate.pendingAmount) : ""}
                  key={`${entry.key}-${entry.providerEmployeeId}-expected`}
                  inputMode="decimal"
                  placeholder="₹ 0"
                />
              </label>
              <label>Remarks
                <input className="field" form={formId} name="remarks" placeholder="Optional note" />
              </label>
              <div className="reconciliation-row-actions">
                <form action={saveExecutiveReconciliation} id={formId}>
                  <input type="hidden" name="return_href" value={returnHref} />
                  <input type="hidden" name="business_date" value={businessDate} />
                  <input type="hidden" name="location_id" value={locationId} />
                  <input type="hidden" name="station_code" value={stationCode} />
                  <input type="hidden" name="source_associate_name" value={associate?.name ?? ""} />
                  <input type="hidden" name="shipment_type" value={associate?.shipmentType ?? "SCC Driver Reconciliation"} />
                  <input type="hidden" name="total_delivery" value="0" />
                  <input type="hidden" name="total_activity" value="0" />
                  <SubmitButton disabled={!canEdit || !entry.providerEmployeeId}>Save cash</SubmitButton>
                </form>
                {rows.length > 1 ? (
                  <button className="button ghost" type="button" onClick={() => removeRow(entry.key)} aria-label={`Remove associate row ${index + 1}`}>Remove</button>
                ) : null}
              </div>
            </div>
            <details className="cash-breakdown">
              <summary>Cash denomination count</summary>
              <div className="cash-breakdown-grid">
                {denominations.map(([name, label]) => (
                  <label key={`${entry.key}-${name}`}>{label}
                    <input className="field" form={formId} name={name} inputMode="numeric" placeholder="0" />
                  </label>
                ))}
                <label>Other / coins
                  <input className="field" form={formId} name="cash_other_amount" inputMode="decimal" placeholder="0" />
                </label>
              </div>
            </details>
          </article>
        );
      })}
      <div className="form-actions reconciliation-add-action">
        <button className="button secondary" type="button" onClick={addRow} disabled={!associates.length || !canEdit}>
          + Add associate
        </button>
        <span className="subtle">{associates.length ? `${associates.length} associates available for ${stationCode} · ${stationLabel}` : "Run SCC sync to load the station roster."}</span>
      </div>
    </div>
  );
}
