import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { CodSectionTabs } from "@/components/cod-section-tabs";
import { PageHead } from "@/components/page-head";
import { SearchableSelect } from "@/components/searchable-select";
import { StatusPill } from "@/components/status-pill";
import { SubmitButton } from "@/components/submit-button";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import {
  amountValue,
  codSetupMessage,
  executiveDisplayName,
  executiveReconciliationStatuses,
  formatAmount,
  formatDateTime,
  isMissingCodSetup,
  loadExecutiveReconciliationRows,
  locationLabel,
  type ExecutiveReconciliationViewRow
} from "@/lib/ops-pulse/cod";
import { isSupabaseAdminConfigured } from "@/lib/supabase-admin";
import { addManualExecutiveReconciliation, refreshExecutiveReconciliationRoster, saveExecutiveReconciliation } from "./actions";

type SearchParams = {
  date?: string;
  location?: string;
  status?: string;
};

const denominations = [
  ["cash_500_count", "500"],
  ["cash_200_count", "200"],
  ["cash_100_count", "100"],
  ["cash_50_count", "50"],
  ["cash_20_count", "20"],
  ["cash_10_count", "10"]
] as const;

type DenominationField = typeof denominations[number][0];

function denominationValue(row: ExecutiveReconciliationViewRow, field: DenominationField) {
  return row[field] ?? 0;
}

function loadFlash() {
  const raw = cookies().get("dropx_cod_executive_reconciliation_flash")?.value;
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

function currentHref(searchParams?: SearchParams) {
  const query = new URLSearchParams();
  if (searchParams?.date) query.set("date", searchParams.date);
  if (searchParams?.location) query.set("location", searchParams.location);
  if (searchParams?.status) query.set("status", searchParams.status);
  const suffix = query.toString();
  return `/ops-pulse/cod/executive-reconciliation${suffix ? `?${suffix}` : ""}`;
}

function moneyClass(value: number) {
  if (value < 0) return "amount-negative";
  if (value > 0) return "amount-positive";
  return "amount-neutral";
}

function differenceLabel(value: number) {
  if (value < 0) return `Short ${formatAmount(Math.abs(value))}`;
  if (value > 0) return `Excess ${formatAmount(value)}`;
  return "0.00";
}

type PendingDetail = NonNullable<ExecutiveReconciliationViewRow["scc_pending_details"]>[number];

function stringValue(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function rawValueFromHeaders(raw: Record<string, unknown> | null | undefined, patterns: RegExp[]) {
  const headersRaw = raw?.headers;
  const cellsRaw = raw?.cells;
  const headers = Array.isArray(headersRaw) ? headersRaw.map(stringValue) : [];
  const cells = Array.isArray(cellsRaw) ? cellsRaw.map(stringValue) : [];
  const index = headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
  return index >= 0 ? cells[index] ?? "" : "";
}

function detailTrackingId(detail: PendingDetail, index: number) {
  const raw = objectValue(detail.raw_row);
  return stringValue(detail.tracking_id ?? detail.shipment_id ?? detail.package_id ?? detail.order_id)
    || rawValueFromHeaders(raw, [/tracking/i, /shipment/i, /package/i, /order/i, /awb/i, /tba/i])
    || `Row ${index + 1}`;
}

function detailAmount(detail: PendingDetail): number | string | null | undefined {
  const raw = objectValue(detail.raw_row);
  return detail.amount ?? rawValueFromHeaders(raw, [/pending/i, /amount/i, /cash/i, /cod/i]);
}

function detailStatus(detail: PendingDetail) {
  const raw = objectValue(detail.raw_row);
  return stringValue(detail.status) || rawValueFromHeaders(raw, [/status/i, /state/i, /reason/i]) || "-";
}

function detailDescription(detail: PendingDetail) {
  const direct = stringValue(detail.description);
  if (direct) return direct;
  const raw = objectValue(detail.raw_row);
  const cellsRaw = raw.cells;
  const cells = Array.isArray(cellsRaw) ? cellsRaw.map(stringValue).filter(Boolean) : [];
  return cells.slice(0, 8).join(" | ") || "-";
}

function PendingReconDetails({ row }: { row: ExecutiveReconciliationViewRow }) {
  const details = Array.isArray(row.scc_pending_details) ? row.scc_pending_details : [];
  return (
    <details className="associate-drilldown">
      <summary>
        <span className="associate-name-link">{executiveDisplayName(row)}</span>
        <span className="subtle">SCC pending {formatAmount(row.scc_pending_amount)}</span>
      </summary>
      <div className="scc-pending-panel">
        <div className="scc-pending-meta">
          <strong>Pending reconciliation details</strong>
          <span className="subtle">Last fetched: {formatDateTime(row.scc_last_detail_checked_at ?? row.source_updated_at)}</span>
        </div>
        {details.length ? (
          <table className="scc-pending-table">
            <thead>
              <tr>
                <th>Tracking ID</th>
                <th>Pending</th>
                <th>Status</th>
                <th>Source row</th>
              </tr>
            </thead>
            <tbody>
              {details.map((detail, index) => (
                <tr key={`${row.key}-pending-${index}`}>
                  <td>{detailTrackingId(detail, index)}</td>
                  <td>{formatAmount(detailAmount(detail))}</td>
                  <td>{detailStatus(detail)}</td>
                  <td>{detailDescription(detail)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="scc-detail-empty">
            No tracking-level rows captured yet. Fetch the SCC roster for this station/date after the worker is updated.
          </div>
        )}
      </div>
    </details>
  );
}

export const dynamic = "force-dynamic";

export default async function ExecutiveReconciliationPage({ searchParams }: { searchParams?: SearchParams }) {
  const authorization = await requirePagePermission("cod_executive_reconciliation", "access");
  const companyId = requireCompanyId(authorization);
  const permission = authorization.permissions.cod_executive_reconciliation;
  const flash = loadFlash();

  const result = await loadExecutiveReconciliationRows(
    companyId,
    authorization.locationScopeIds,
    authorization.hasAllLocationAccess,
    {
      businessDate: searchParams?.date ?? "",
      locationId: searchParams?.location ?? "",
      status: searchParams?.status ?? ""
    }
  );

  const defaultLocationId = searchParams?.location ?? (result.locations.length === 1 ? result.locations[0]?.id ?? "" : "");
  const returnHref = currentHref({
    date: searchParams?.date ?? result.businessDate,
    location: defaultLocationId,
    status: searchParams?.status ?? ""
  });
  const resultSetupError = result.error && isMissingCodSetup({ message: result.error }) ? result.error : null;
  const flashSetupError = flash.error && isMissingCodSetup({ message: flash.error }) ? flash.error : null;
  const setupError = resultSetupError ?? flashSetupError;
  const stationOptions = result.locations.map((location) => ({
    helper: [location.state, location.station_name].filter(Boolean).join(" / "),
    label: locationLabel(location),
    value: location.id
  }));
  const selectedStation = result.locations.find((location) => location.id === defaultLocationId);
  const rows = defaultLocationId
    ? result.rows.filter((row) => row.location_id === defaultLocationId || row.station_code === selectedStation?.station_code)
    : result.rows;
  const completed = rows.filter((row) => row.reconciliation_status === "Completed").length;
  const expectedTotal = rows.reduce((sum, row) => sum + amountValue(row.expected_amount), 0);
  const collectedTotal = rows.reduce((sum, row) => sum + amountValue(row.collected_amount), 0);
  const netDifference = rows.reduce((sum, row) => sum + amountValue(row.difference_amount), 0);
  const hasSingleStationScope = result.locations.length === 1;

  return (
    <AppShell active="COD" pageCode="cod_executive_reconciliation">
      <PageHead
        eyebrow="Ops Pulse"
        title="COD"
        subtitle="Collect associate-wise COD and count cash denominations against the expected amount."
        action={<span className={`status-pill ${isSupabaseAdminConfigured ? "good" : "warn"}`}>{isSupabaseAdminConfigured ? "Database connected" : "Database key missing"}</span>}
      />
      <CodSectionTabs active="executive-reconciliation" />

      {setupError ? (
        <section className="panel message-panel error">
          <div className="panel-body">
            <strong>Database setup needed</strong>
            <p className="subtle" style={{ marginTop: 6 }}>
              {codSetupMessage(setupError)} Also run scripts/cod_executive_reconciliation_denominations_v2.sql.
            </p>
          </div>
        </section>
      ) : null}

      {!setupError && result.error ? (
        <section className="panel message-panel error">
          <div className="panel-body"><strong>Unable to load executive reconciliation</strong><p className="subtle" style={{ marginTop: 6 }}>{result.error}</p></div>
        </section>
      ) : null}

      {!setupError && (flash.error || flash.notice) ? (
        <section className={`panel message-panel ${flash.error ? "error" : "success"}`}>
          <div className="panel-body"><strong>{flash.error ? "Action required" : "Completed"}</strong><p className="subtle" style={{ marginTop: 6 }}>{flash.error ?? flash.notice}</p></div>
        </section>
      ) : null}

      {!setupError ? (
        <>
          <section className="panel">
            <div className="panel-body">
              <form action="/ops-pulse/cod/executive-reconciliation" className="form-grid cod-reconciliation-filter-grid">
                <label>Business Date<input className="field" name="date" type="date" defaultValue={result.businessDate} /></label>
                <label className="span-2">Station
                  <select className="field" name="location" defaultValue={defaultLocationId} disabled={hasSingleStationScope}>
                    {!hasSingleStationScope ? <option value="">All permitted stations</option> : null}
                    {result.locations.map((location) => <option key={location.id} value={location.id}>{locationLabel(location)}</option>)}
                  </select>
                  {hasSingleStationScope ? <input type="hidden" name="location" value={defaultLocationId} /> : null}
                </label>
                <label>Status
                  <select className="field" name="status" defaultValue={searchParams?.status ?? ""}>
                    <option value="">All statuses</option>
                    {executiveReconciliationStatuses.map((status) => <option key={status}>{status}</option>)}
                  </select>
                </label>
                <div className="form-actions cod-filter-actions align-right">
                  <button className="button secondary" type="submit">Show sheet</button>
                </div>
              </form>
              {permission.canEdit ? (
                <form action={refreshExecutiveReconciliationRoster} className="form-actions align-right scc-refresh-form">
                  <input type="hidden" name="return_href" value={returnHref} />
                  <input type="hidden" name="business_date" value={result.businessDate} />
                  <input type="hidden" name="location_id" value={defaultLocationId} />
                  <SubmitButton className="button secondary" disabled={!defaultLocationId}>Fetch SCC roster</SubmitButton>
                </form>
              ) : null}
            </div>
          </section>

          <section className="summary-grid">
            <div className="metric-card"><span>Associates</span><strong>{rows.length}</strong><small>SCC roster plus manual rows</small></div>
            <div className="metric-card"><span>Balanced</span><strong>{completed}</strong><small>Cash equals expected COD</small></div>
            <div className="metric-card"><span>Expected COD</span><strong>{formatAmount(expectedTotal)}</strong><small>Amount entered by station</small></div>
            <div className="metric-card"><span>Net Cash Difference</span><strong className={moneyClass(netDifference)}>{differenceLabel(netDifference)}</strong><small>Collected {formatAmount(collectedTotal)}</small></div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Executive reconciliation sheet</h2>
                <p className="subtle">Associate names are pulled from Amazon SCC Driver Reconciliation for the selected date and station. Save rows after counting cash.</p>
              </div>
              <span className="count-badge">{rows.length} records</span>
            </div>
            <div className="table-wrap cash-reconciliation-wrap" aria-label="Executive reconciliation sheet">
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
                  {rows.length ? rows.map((row) => {
                    const difference = amountValue(row.difference_amount);
                    return (
                      <tr key={row.key}>
                        <td><strong>{row.station_code}</strong><br /><span className="subtle">{row.station_name ?? row.state ?? "-"}</span></td>
                        <td>
                          {row.source_associate_name ? (
                            <PendingReconDetails row={row} />
                          ) : (
                            <input className="field compact-field associate-field" form={`recon-${row.key}`} name="manual_associate_name" defaultValue={row.manual_associate_name ?? ""} placeholder="Associate name" required />
                          )}
                          <br /><span className="subtle">{row.shipment_type ?? "SCC Driver Reconciliation"}</span>
                        </td>
                        <td>{row.provider_employee_id}</td>
                        <td><input className="field compact-field amount-field" form={`recon-${row.key}`} name="expected_amount" defaultValue={String(row.expected_amount ?? 0)} inputMode="decimal" /></td>
                        {denominations.map(([name]) => (
                          <td key={`${row.key}-${name}`}>
                            <input className="field compact-field cash-count-field" form={`recon-${row.key}`} name={name} defaultValue={String(denominationValue(row, name))} inputMode="numeric" />
                          </td>
                        ))}
                        <td><input className="field compact-field cash-count-field" form={`recon-${row.key}`} name="cash_other_amount" defaultValue={String(row.cash_other_amount ?? 0)} inputMode="decimal" /></td>
                        <td><strong>{formatAmount(row.collected_amount)}</strong></td>
                        <td><strong className={moneyClass(difference)}>{differenceLabel(difference)}</strong></td>
                        <td><StatusPill status={row.reconciliation_status} /></td>
                        <td><input className="field compact-field remarks-field" form={`recon-${row.key}`} name="remarks" defaultValue={row.remarks ?? ""} placeholder="Notes" /></td>
                        <td>
                          <form action={saveExecutiveReconciliation} id={`recon-${row.key}`}>
                            <input type="hidden" name="return_href" value={returnHref} />
                            <input type="hidden" name="business_date" value={row.business_date} />
                            <input type="hidden" name="location_id" value={row.location_id ?? ""} />
                            <input type="hidden" name="station_code" value={row.station_code} />
                            <input type="hidden" name="provider_employee_id" value={row.provider_employee_id} />
                            <input type="hidden" name="source_associate_name" value={row.source_associate_name ?? ""} />
                            <input type="hidden" name="shipment_type" value={row.shipment_type ?? ""} />
                            <input type="hidden" name="total_delivery" value={String(row.total_delivery ?? 0)} />
                            <input type="hidden" name="total_activity" value={String(row.total_activity ?? 0)} />
                            <SubmitButton className="button secondary small-button" disabled={!permission.canEdit}>Save</SubmitButton>
                          </form>
                        </td>
                      </tr>
                    );
                  }) : (
                    <tr><td className="empty-cell" colSpan={16}>No associates found from SCC Driver Reconciliation yet. Run COD Portal Checks for this station/date, or add a missing associate below.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {permission.canAdd ? (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Associate not in SCC roster</h2>
                  <p className="subtle">Use this only when an executive collected COD but has not appeared in Driver Reconciliation yet.</p>
                </div>
              </div>
              <div className="panel-body">
                <form action={addManualExecutiveReconciliation} className="form-grid cod-manual-reconciliation-grid">
                  <input type="hidden" name="return_href" value={returnHref} />
                  <input type="hidden" name="provider_employee_id" value="__manual__" />
                  <label>Business Date<input className="field" name="business_date" type="date" defaultValue={result.businessDate} required /></label>
                  <label className="span-2">Station<SearchableSelect name="location_id" options={stationOptions} defaultValue={defaultLocationId} placeholder="Select station" required disabled={hasSingleStationScope} /></label>
                  {hasSingleStationScope ? <input type="hidden" name="location_id" value={defaultLocationId} /> : null}
                  <label>Associate Name<input className="field" name="manual_associate_name" placeholder="Missing associate name" required /></label>
                  <label>Expected COD<input className="field" name="expected_amount" inputMode="decimal" placeholder="0" /></label>
                  {denominations.map(([name, label]) => (
                    <label key={`manual-${name}`}>{label}<input className="field" name={name} inputMode="numeric" placeholder="0" /></label>
                  ))}
                  <label>Other / coins<input className="field" name="cash_other_amount" inputMode="decimal" placeholder="0" /></label>
                  <label className="span-3">Remarks<input className="field" name="remarks" placeholder="Why this associate was added manually" /></label>
                  <div className="form-actions span-4 align-right">
                    <SubmitButton>Add and calculate</SubmitButton>
                  </div>
                </form>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </AppShell>
  );
}
