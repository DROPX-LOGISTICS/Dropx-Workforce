"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
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
  workforceId: string;
  sourceType: "workforce" | "employee" | "contractor" | "field_executive";
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

export type ProviderPendingMappingRow = {
  id: string;
  providerMemberId: string;
  providerName: string;
  sourceName: string;
  stationCode: string;
  firstSeen: string;
  lastSeen: string;
  dailyRows: number;
  deliveries: number;
  reason: string;
};

function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const csv = [headers.map(csvCell).join(","), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function rowSignature(row: MappingWorksheetRow) {
  return [
    row.id,
    row.workforceId,
    row.sourceType,
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
  paymentMethods,
  providerPending,
  providerPendingPeriod
}: {
  canEdit: boolean;
  locations: LocationOption[];
  mappings: MappingWorksheetRow[];
  paymentMethods: PaymentMethodOption[];
  providerPending: ProviderPendingMappingRow[];
  providerPendingPeriod: string;
}) {
  const initialRows = useMemo(() => mappings, [mappings]);
  const initialSignatures = useMemo(() => initialRows.map(rowSignature), [initialRows]);
  const [rows, setRows] = useState(initialRows);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [mappingStatus, setMappingStatus] = useState("all");
  const [directionView, setDirectionView] = useState<"provider" | "dropx">("provider");
  const [stationFilter, setStationFilter] = useState("");
  const [pageSize, setPageSize] = useState("25");
  const [currentPage, setCurrentPage] = useState(1);

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
  const locationLabelById = useMemo(
    () => new Map(locations.map((location) => [location.id, location.label])),
    [locations]
  );
  const paymentMethodById = useMemo(
    () => new Map(paymentMethods.map((method) => [method.id, method])),
    [paymentMethods]
  );
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const filteredIndexes = rows.flatMap((row, index) => {
    const matchesSearch = !normalizedSearch || [
      row.dropxId,
      row.dropxName,
      row.providerMemberId,
      locationLabelById.get(row.stationId) ?? ""
    ].some((value) => value.toLocaleLowerCase().includes(normalizedSearch));
    const mapped = Boolean(row.mappingId || (row.providerMemberId && row.paymentMethodId));
    const matchesStatus = mappingStatus === "all" || (mappingStatus === "mapped" ? mapped : !mapped);
    const matchesStation = !stationFilter || row.stationId === stationFilter;
    return matchesSearch && matchesStatus && matchesStation ? [index] : [];
  });
  const filteredProviderPending = providerPending.filter((row) => {
    const matchesSearch = !normalizedSearch || [row.providerMemberId, row.providerName, row.sourceName, row.stationCode]
      .some((value) => value.toLocaleLowerCase().includes(normalizedSearch));
    const station = locations.find((location) => location.id === stationFilter)?.label.split(" - ")[0] ?? "";
    return matchesSearch && (!stationFilter || row.stationCode === station);
  });
  const numericPageSize = Number(pageSize);
  const totalPages = Math.max(1, Math.ceil(filteredIndexes.length / numericPageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pageStart = (safePage - 1) * numericPageSize;
  const paginatedIndexes = new Set(filteredIndexes.slice(pageStart, pageStart + numericPageSize));

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, mappingStatus, pageSize, stationFilter, directionView]);

  if (!rows.length) {
    return (
      <section className="panel">
        <div className="empty-state">
          <strong>No DropX IDs available for mapping.</strong>
          <p className="subtle">Complete a Workforce registration with a DropX ID first, then maintain provider IDs and payment setup here.</p>
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
            <p className="subtle">Reconcile both directions: source provider IDs without a DropX identity and Workforce DropX IDs without a provider ID.</p>
          </div>
          {directionView === "dropx" ? <SubmitButton disabled={!canEdit || !hasDirtyRows} disabledText={canEdit ? "No edits" : "No edit access"}>Save all</SubmitButton> : null}
        </div>

        <div className="mapping-direction-tabs">
          <button className={directionView === "provider" ? "active" : ""} onClick={() => { setDirectionView("provider"); setMappingStatus("all"); }} type="button">
            Provider IDs pending DropX ID <strong>{providerPending.length}</strong>
          </button>
          <button className={directionView === "dropx" ? "active" : ""} onClick={() => { setDirectionView("dropx"); setMappingStatus("unmapped"); }} type="button">
            DropX IDs pending provider ID <strong>{rows.filter((row) => !row.providerMemberId.trim()).length}</strong>
          </button>
        </div>

        <div className="mapping-toolbar">
          <label className="mapping-toolbar-search">Search {directionView === "provider" ? "provider backlog" : "Workforce"}
            <input
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="DropX ID, name, location or provider ID"
              type="search"
              value={searchQuery}
            />
          </label>
          <label>Station
            <select onChange={(event) => setStationFilter(event.target.value)} value={stationFilter}>
              <option value="">All stations</option>
              {locations.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}
            </select>
          </label>
          {directionView === "dropx" ? <label>Status
            <select onChange={(event) => setMappingStatus(event.target.value)} value={mappingStatus}>
              <option value="all">All mappings</option>
              <option value="mapped">Mapped</option>
              <option value="unmapped">Provider ID pending</option>
            </select>
          </label> : <span className="mapping-period-note">MTD source: {providerPendingPeriod}</span>}
          <label>Rows
            <select onChange={(event) => setPageSize(event.target.value)} value={pageSize}>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>
          <div className="mapping-toolbar-summary">
            <span>{directionView === "provider" ? `${filteredProviderPending.length} provider IDs pending` : `${filteredIndexes.length} of ${rows.length} Workforce profiles`}</span>
            {directionView === "dropx" ? <div>
              <button disabled={safePage === 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} type="button">Previous</button>
              <strong>{safePage} / {totalPages}</strong>
              <button disabled={safePage === totalPages} onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} type="button">Next</button>
            </div> : null}
            <button className="mapping-download" onClick={() => directionView === "provider"
              ? downloadCsv("provider-ids-pending-dropx-id.csv", filteredProviderPending.map((row) => ({
                  "Provider ID": row.providerMemberId, Provider: row.providerName, "Source name": row.sourceName, Station: row.stationCode,
                  "First seen": row.firstSeen, "Last seen": row.lastSeen, "Daily rows": row.dailyRows, Deliveries: row.deliveries, Reason: row.reason
                })))
              : downloadCsv("dropx-ids-provider-mapping.csv", filteredIndexes.map((index) => ({
                  "DropX ID": rows[index].dropxId, Name: rows[index].dropxName, Station: locationLabelById.get(rows[index].stationId) ?? "",
                  "Provider ID": rows[index].providerMemberId, Status: rows[index].providerMemberId ? "Mapped" : "Pending", "Effective from": rows[index].effectiveFrom
                })))} type="button"><Download size={13} /> Download CSV</button>
          </div>
        </div>

        {directionView === "provider" ? <div className="table-wrap mapping-pending-table"><table><thead><tr><th>Provider ID</th><th>Source name</th><th>Provider</th><th>Station</th><th>Activity</th><th>Last seen</th><th>Reason</th></tr></thead><tbody>
          {filteredProviderPending.map((row) => <tr key={row.id}><td><strong className="mono">{row.providerMemberId}</strong></td><td>{row.sourceName}</td><td>{row.providerName}</td><td>{row.stationCode}</td><td>{row.deliveries.toLocaleString("en-IN")} delivered<small>{row.dailyRows} daily rows</small></td><td>{row.lastSeen}<small>First {row.firstSeen}</small></td><td><span className="wf-pay-state unmapped">Pending DropX ID</span><small>{row.reason}</small></td></tr>)}
          {!filteredProviderPending.length ? <tr><td className="empty-cell" colSpan={7}>No provider IDs are pending for these filters.</td></tr> : null}
        </tbody></table></div> : <div className="mapping-rows">
          {rows.map((row, index) => (
            <div className={`mapping-row-card ${dirtyRows[index] ? "unsaved-row" : ""}`} hidden={!paginatedIndexes.has(index)} key={`${row.workforceId}-${index}`}>
              <input type="hidden" name={`rows[${index}][id]`} value={row.id} />
              <input type="hidden" name={`rows[${index}][workforce_id]`} value={row.workforceId} />
              <input type="hidden" name={`rows[${index}][source_type]`} value={row.sourceType} />
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
          {!filteredIndexes.length ? (
            <div className="mapping-no-results">
              <strong>No matching Workforce profiles</strong>
              <span>Change the search or mapping status filter.</span>
            </div>
          ) : null}
        </div>}
      </section>
    </form>
  );
}
