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
    <div className="table-wrap cash-reconciliation-wrap" aria-label="Add associate reconciliation rows">
      <table className="cash-reconciliation-table">
        <thead>
          <tr>
            <th>Station</th>
            <th>Associate</th>
            <th>Executive ID</th>
            <th>Expected COD</th>
            {denominations.map(([, label]) => <th key={label}>{label}</th>)}
            <th>Other</th>
            <th>Collected</th>
            <th>Short / Excess</th>
            <th>Status</th>
            <th>Remarks</th>
            <th>Save</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((entry, index) => {
            const associate = optionMap.get(entry.providerEmployeeId);
            const formId = `new-reconciliation-${entry.key}`;
            return (
              <tr key={entry.key}>
                <td><strong>{stationCode}</strong><br /><span className="subtle">{stationLabel}</span></td>
                <td>
                  <select
                    className="field compact-field associate-field"
                    value={entry.providerEmployeeId}
                    onChange={(event) => selectAssociate(entry.key, event.target.value)}
                    required
                    aria-label={`Associate ${index + 1}`}
                    form={formId}
                    name="provider_employee_id"
                  >
                    <option value="">Select associate</option>
                    {associates.map((option) => (
                      <option key={option.providerEmployeeId} value={option.providerEmployeeId}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                  <input form={formId} type="hidden" name="source_associate_name" value={associate?.name ?? ""} />
                  <input form={formId} type="hidden" name="shipment_type" value={associate?.shipmentType ?? "SCC Driver Reconciliation"} />
                </td>
                <td>{associate?.providerEmployeeId ?? "-"}</td>
                <td>
                  <input
                    className="field compact-field amount-field"
                    form={formId}
                    name="expected_amount"
                    defaultValue={associate ? String(associate.pendingAmount) : ""}
                    key={`${entry.key}-${entry.providerEmployeeId}-expected`}
                    inputMode="decimal"
                    placeholder="0"
                  />
                </td>
                {denominations.map(([name]) => (
                  <td key={`${entry.key}-${name}`}>
                    <input className="field compact-field cash-count-field" form={formId} name={name} inputMode="numeric" placeholder="0" />
                  </td>
                ))}
                <td><input className="field compact-field cash-count-field" form={formId} name="cash_other_amount" inputMode="decimal" placeholder="0" /></td>
                <td className="subtle">After save</td>
                <td className="subtle">After save</td>
                <td><span className="status-pill warn">New</span></td>
                <td><input className="field compact-field remarks-field" form={formId} name="remarks" placeholder="Notes" /></td>
                <td>
                  <form action={saveExecutiveReconciliation} id={formId}>
                    <input type="hidden" name="return_href" value={returnHref} />
                    <input type="hidden" name="business_date" value={businessDate} />
                    <input type="hidden" name="location_id" value={locationId} />
                    <input type="hidden" name="station_code" value={stationCode} />
                    <input type="hidden" name="total_delivery" value="0" />
                    <input type="hidden" name="total_activity" value="0" />
                    <div className="form-actions" style={{ flexWrap: "nowrap" }}>
                      <SubmitButton className="button secondary small-button" disabled={!canEdit || !entry.providerEmployeeId}>Save</SubmitButton>
                      {rows.length > 1 ? (
                        <button className="button ghost small-button" type="button" onClick={() => removeRow(entry.key)} aria-label={`Remove associate row ${index + 1}`}>×</button>
                      ) : null}
                    </div>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="form-actions" style={{ justifyContent: "flex-start", padding: "12px 14px" }}>
        <button className="button secondary" type="button" onClick={addRow} disabled={!associates.length || !canEdit}>
          + Add associate
        </button>
        {!associates.length ? <span className="subtle">Sync Amazon SCC for this station and date to load associates.</span> : null}
      </div>
    </div>
  );
}
