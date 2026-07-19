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
  locationLabel
} from "@/lib/ops-pulse/cod";
import { isSupabaseAdminConfigured } from "@/lib/supabase-admin";
import { addManualExecutiveReconciliation, saveExecutiveReconciliation } from "./actions";

type SearchParams = {
  date?: string;
  location?: string;
  status?: string;
};

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

export const dynamic = "force-dynamic";

export default async function ExecutiveReconciliationPage({ searchParams }: { searchParams?: SearchParams }) {
  const authorization = await requirePagePermission("cod_executive_reconciliation", "access");
  const companyId = requireCompanyId(authorization);
  const permission = authorization.permissions.cod_executive_reconciliation;
  const flash = loadFlash();
  const returnHref = currentHref(searchParams);
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
  const setupError = result.error && isMissingCodSetup({ message: result.error }) ? result.error : null;
  const stationOptions = result.locations.map((location) => ({
    helper: [location.state, location.station_name].filter(Boolean).join(" / "),
    label: locationLabel(location),
    value: location.id
  }));
  const rows = result.rows;
  const completed = rows.filter((row) => row.reconciliation_status === "Completed").length;
  const openRows = rows.filter((row) => !["Completed", "Not applicable"].includes(row.reconciliation_status)).length;
  const pendingAmount = rows.reduce((sum, row) => sum + amountValue(row.pending_amount), 0);
  const manualRows = rows.filter((row) => row.source === "manual").length;

  return (
    <AppShell active="COD" pageCode="cod_executive_reconciliation">
      <PageHead
        eyebrow="Ops Pulse"
        title="COD"
        subtitle="Executive reconciliation is created from uploaded Amazon shipment data. Manual entry is only for executives missing from the source file."
        action={<span className={`status-pill ${isSupabaseAdminConfigured ? "good" : "warn"}`}>{isSupabaseAdminConfigured ? "Database connected" : "Database key missing"}</span>}
      />
      <CodSectionTabs active="executive-reconciliation" />

      {setupError ? (
        <section className="panel message-panel error">
          <div className="panel-body"><strong>Database setup needed</strong><p className="subtle" style={{ marginTop: 6 }}>{codSetupMessage(setupError)} Also run scripts/dev_mode_cod_executive_reconciliation_v1.sql.</p></div>
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
              <form action="/ops-pulse/cod/executive-reconciliation" className="form-grid four">
                <label>Business Date<input className="field" name="date" type="date" defaultValue={result.businessDate} /></label>
                <label className="span-2">Station
                  <select className="field" name="location" defaultValue={searchParams?.location ?? ""}>
                    <option value="">All permitted stations</option>
                    {result.locations.map((location) => <option key={location.id} value={location.id}>{locationLabel(location)}</option>)}
                  </select>
                </label>
                <label>Status
                  <select className="field" name="status" defaultValue={searchParams?.status ?? ""}>
                    <option value="">All statuses</option>
                    {executiveReconciliationStatuses.map((status) => <option key={status}>{status}</option>)}
                  </select>
                </label>
                <div className="form-actions span-4 align-right">
                  <button className="button secondary" type="submit">Show executives</button>
                </div>
              </form>
            </div>
          </section>

          <section className="summary-grid">
            <div className="metric-card"><span>Source Rows</span><strong>{rows.length}</strong><small>From shipment import plus manual additions</small></div>
            <div className="metric-card"><span>Completed</span><strong>{completed}</strong><small>Reconciliation closed</small></div>
            <div className="metric-card"><span>Open</span><strong>{openRows}</strong><small>Pending, mismatch, or pending amount</small></div>
            <div className="metric-card"><span>Pending Amount</span><strong>{formatAmount(pendingAmount)}</strong><small>{manualRows} manual rows</small></div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Executive reconciliation</h2>
                <p className="subtle">Associate names come from Amazon shipment imports. Enter manually only when the source file missed the executive.</p>
              </div>
              <span className="count-badge">{rows.length} records</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Station</th>
                    <th>Executive ID</th>
                    <th>Associate</th>
                    <th>Ship Type</th>
                    <th>Delivery</th>
                    <th>Activity</th>
                    <th>Status</th>
                    <th>Pending Amount</th>
                    <th>Remarks</th>
                    <th>Source</th>
                    <th>Updated</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length ? rows.map((row) => (
                    <tr key={row.key}>
                      <td><strong>{row.station_code}</strong><br /><span className="subtle">{row.station_name ?? row.state ?? "-"}</span></td>
                      <td>{row.provider_employee_id}</td>
                      <td>
                        {row.source_associate_name ? (
                          <strong>{executiveDisplayName(row)}</strong>
                        ) : null}
                        {!row.source_associate_name ? (
                          <input className="field compact-field" form={`recon-${row.key}`} name="manual_associate_name" defaultValue={row.manual_associate_name ?? ""} placeholder="Enter associate name" required />
                        ) : null}
                      </td>
                      <td>{row.shipment_type ?? "-"}</td>
                      <td>{row.total_delivery ?? 0}</td>
                      <td>{row.total_activity ?? 0}</td>
                      <td>
                        <select className="field compact-field" form={`recon-${row.key}`} name="reconciliation_status" defaultValue={row.reconciliation_status}>
                          {executiveReconciliationStatuses.map((status) => <option key={status}>{status}</option>)}
                        </select>
                      </td>
                      <td><input className="field compact-field" form={`recon-${row.key}`} name="pending_amount" defaultValue={String(row.pending_amount ?? 0)} inputMode="decimal" /></td>
                      <td><input className="field compact-field" form={`recon-${row.key}`} name="remarks" defaultValue={row.remarks ?? ""} placeholder="Notes" /></td>
                      <td><StatusPill status={row.source === "shipment_import" ? "Shipment Import" : "Manual"} /></td>
                      <td>{formatDateTime(row.updated_at ?? row.source_updated_at)}</td>
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
                  )) : (
                    <tr><td className="empty-cell" colSpan={12}>No executives found. Upload Amazon shipment count for this date/station, then refresh this page.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {permission.canAdd ? (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Add missing executive</h2>
                  <p className="subtle">Use only when the shipment report has missing or unreadable associate details.</p>
                </div>
              </div>
              <div className="panel-body">
                <form action={addManualExecutiveReconciliation} className="form-grid four">
                  <input type="hidden" name="return_href" value={returnHref} />
                  <label>Business Date<input className="field" name="business_date" type="date" defaultValue={result.businessDate} required /></label>
                  <label className="span-2">Station<SearchableSelect name="location_id" options={stationOptions} placeholder="Select station" required /></label>
                  <label>Executive ID<input className="field" name="provider_employee_id" placeholder="Provider / DA ID" required /></label>
                  <label className="span-2">Associate Name<input className="field" name="manual_associate_name" placeholder="Name missing from shipment file" required /></label>
                  <label>Ship Type<input className="field" name="shipment_type" placeholder="Optional" /></label>
                  <label>Status
                    <select className="field" name="reconciliation_status" defaultValue="Pending">
                      {executiveReconciliationStatuses.map((status) => <option key={status}>{status}</option>)}
                    </select>
                  </label>
                  <label>Pending Amount<input className="field" name="pending_amount" inputMode="decimal" placeholder="0" /></label>
                  <label className="span-3">Remarks<input className="field" name="remarks" placeholder="Reason for manual row" /></label>
                  <input type="hidden" name="station_code" value="manual" />
                  <div className="form-actions span-4 align-right">
                    <SubmitButton>Add executive</SubmitButton>
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
