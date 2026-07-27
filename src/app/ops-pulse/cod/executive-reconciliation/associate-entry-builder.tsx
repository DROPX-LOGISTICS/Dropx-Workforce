"use client";

import { useMemo, useState } from "react";
import { SearchableSelect } from "@/components/searchable-select";
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
  expectedAmount: string;
  cashOtherAmount: string;
  denominationCounts: Record<DenominationName, string>;
};

const denominations = [
  ["cash_500_count", "₹500", 500],
  ["cash_200_count", "₹200", 200],
  ["cash_100_count", "₹100", 100],
  ["cash_50_count", "₹50", 50],
  ["cash_20_count", "₹20", 20],
  ["cash_10_count", "₹10", 10]
] as const;

type DenominationName = typeof denominations[number][0];

function emptyDenominations(): Record<DenominationName, string> {
  return {
    cash_500_count: "",
    cash_200_count: "",
    cash_100_count: "",
    cash_50_count: "",
    cash_20_count: "",
    cash_10_count: ""
  };
}

function numberValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function currency(value: number) {
  return value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

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
  const [rows, setRows] = useState<EntryRow[]>([{
    key: 1,
    providerEmployeeId: "",
    expectedAmount: "",
    cashOtherAmount: "",
    denominationCounts: emptyDenominations()
  }]);
  const optionMap = useMemo(
    () => new Map(associates.map((associate) => [associate.providerEmployeeId, associate])),
    [associates]
  );

  function addRow() {
    setRows((current) => [
      ...current,
      {
        key: Math.max(0, ...current.map((row) => row.key)) + 1,
        providerEmployeeId: "",
        expectedAmount: "",
        cashOtherAmount: "",
        denominationCounts: emptyDenominations()
      }
    ]);
  }

  function addAllDrivers() {
    setRows(associates.map((associate, index) => ({
      key: index + 1,
      providerEmployeeId: associate.providerEmployeeId,
      expectedAmount: Number(associate.pendingAmount) > 0 ? String(associate.pendingAmount) : "",
      cashOtherAmount: "",
      denominationCounts: emptyDenominations()
    })));
  }

  function removeRow(key: number) {
    setRows((current) => current.length === 1 ? current : current.filter((row) => row.key !== key));
  }

  function selectAssociate(key: number, providerEmployeeId: string) {
    const associate = optionMap.get(providerEmployeeId);
    setRows((current) => current.map((row) => row.key === key ? {
      ...row,
      providerEmployeeId,
      expectedAmount: associate && Number(associate.pendingAmount) > 0 ? String(associate.pendingAmount) : ""
    } : row));
  }

  function updateRow(key: number, update: Partial<EntryRow>) {
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...update } : row));
  }

  function updateDenomination(key: number, name: DenominationName, value: string) {
    setRows((current) => current.map((row) => row.key === key ? {
      ...row,
      denominationCounts: { ...row.denominationCounts, [name]: value }
    } : row));
  }

  return (
    <div className="reconciliation-entry-list" aria-label="Add associate reconciliation rows">
      {rows.map((entry, index) => {
        const associate = optionMap.get(entry.providerEmployeeId);
        const formId = `new-reconciliation-${entry.key}`;
        const selectedByOtherRow = new Set(
          rows.filter((row) => row.key !== entry.key).map((row) => row.providerEmployeeId).filter(Boolean)
        );
        const associateOptions = associates
          .filter((option) => option.providerEmployeeId === entry.providerEmployeeId || !selectedByOtherRow.has(option.providerEmployeeId))
          .map((option) => ({
            value: option.providerEmployeeId,
            label: option.name,
            helper: option.providerEmployeeId
          }));
        const collectedAmount = denominations.reduce(
          (total, [name, , amount]) => total + numberValue(entry.denominationCounts[name]) * amount,
          numberValue(entry.cashOtherAmount)
        );
        const expectedAmount = numberValue(entry.expectedAmount);
        const difference = collectedAmount - expectedAmount;
        const cashState = expectedAmount === 0 && collectedAmount === 0
          ? { className: "waiting", label: "Enter amounts", amount: "" }
          : Math.abs(difference) < 0.005
            ? { className: "matched", label: "Matched", amount: "" }
          : difference < 0
            ? { className: "short", label: "Pending", amount: `₹${currency(Math.abs(difference))}` }
            : { className: "excess", label: "Excess", amount: `₹${currency(difference)}` };
        return (
          <article className="reconciliation-entry-card" key={entry.key}>
            <form action={saveExecutiveReconciliation} id={formId}>
              <div className="reconciliation-entry-grid">
                <label>Associate
                  <SearchableSelect
                    name="provider_employee_id"
                    options={associateOptions}
                    value={entry.providerEmployeeId}
                    onValueChange={(value) => selectAssociate(entry.key, value)}
                    placeholder="Search DA name or ID"
                    required
                  />
                </label>
                <label>Expected COD
                  <input
                    className="field"
                    name="expected_amount"
                    value={entry.expectedAmount}
                    onChange={(event) => updateRow(entry.key, { expectedAmount: event.target.value })}
                    inputMode="decimal"
                    placeholder="₹ 0"
                  />
                </label>
                <label>Remarks
                  <input className="field" name="remarks" placeholder="Optional note" />
                </label>
                <div className="reconciliation-row-actions">
                  <input type="hidden" name="return_href" value={returnHref} />
                  <input type="hidden" name="business_date" value={businessDate} />
                  <input type="hidden" name="location_id" value={locationId} />
                  <input type="hidden" name="station_code" value={stationCode} />
                  <input type="hidden" name="source_associate_name" value={associate?.name ?? ""} />
                  <input type="hidden" name="shipment_type" value={associate?.shipmentType ?? "SCC Driver Reconciliation"} />
                  <input type="hidden" name="total_delivery" value="0" />
                  <input type="hidden" name="total_activity" value="0" />
                  <SubmitButton disabled={!canEdit || !entry.providerEmployeeId}>Save cash</SubmitButton>
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
                      <input
                        className="field"
                        name={name}
                        value={entry.denominationCounts[name]}
                        onChange={(event) => updateDenomination(entry.key, name, event.target.value)}
                        inputMode="numeric"
                        placeholder="0"
                      />
                    </label>
                  ))}
                  <label>Other / coins
                    <input
                      className="field"
                      name="cash_other_amount"
                      value={entry.cashOtherAmount}
                      onChange={(event) => updateRow(entry.key, { cashOtherAmount: event.target.value })}
                      inputMode="decimal"
                      placeholder="0"
                    />
                  </label>
                </div>
              </details>
              <div className={`cash-live-status ${cashState.className}`} aria-live="polite">
                <span>Collected <strong>₹{currency(collectedAmount)}</strong></span>
                <span>Expected <strong>₹{currency(expectedAmount)}</strong></span>
                <span className="cash-live-result">{cashState.label} {cashState.amount ? <strong>{cashState.amount}</strong> : null}</span>
              </div>
            </form>
          </article>
        );
      })}
      <div className="form-actions reconciliation-add-action">
        <button className="button secondary" type="button" onClick={addRow} disabled={!associates.length || !canEdit}>
          + Add associate
        </button>
        <button className="button secondary" type="button" onClick={addAllDrivers} disabled={!associates.length || !canEdit}>
          Add all drivers
        </button>
        <span className="subtle">{associates.length ? `${associates.length} associates available for ${stationCode} · ${stationLabel}` : "Run SCC sync to load the station roster."}</span>
      </div>
    </div>
  );
}
