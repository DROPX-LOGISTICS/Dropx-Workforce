import { AppShell } from "@/components/app-shell";
import { CodSectionTabs } from "@/components/cod-section-tabs";
import { PageHead } from "@/components/page-head";
import { StatusPill } from "@/components/status-pill";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import {
  amountValue,
  codPeriod,
  codSetupMessage,
  displayCodAmount,
  firstRelation,
  formatAmount,
  formatDate,
  formatDateTime,
  formTypeLabel,
  inferFormTypeFromLocation,
  isMissingCodSetup,
  loadCodLocations,
  loadCodSubmissions,
  locationLabel,
  variance
} from "@/lib/ops-pulse/cod";
import { isSupabaseAdminConfigured } from "@/lib/supabase-admin";

type SearchParams = {
  client?: string;
  from?: string;
  location?: string;
  status?: string;
  to?: string;
};

export const dynamic = "force-dynamic";

export default async function CodReportsPage({ searchParams }: { searchParams?: SearchParams }) {
  const authorization = await requirePagePermission("cod_reports", "access");
  const companyId = requireCompanyId(authorization);
  const [{ locations, error: locationsError }, submissionsResult] = await Promise.all([
    loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess),
    loadCodSubmissions(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess, {
      formType: searchParams?.client ?? "",
      fromDate: searchParams?.from ?? "",
      locationId: searchParams?.location ?? "",
      toDate: searchParams?.to ?? "",
      validationStatus: searchParams?.status ?? ""
    })
  ]);
  const selectedClient = searchParams?.client === "amazon" || searchParams?.client === "flipkart" ? searchParams.client : "";
  const clientLocations = selectedClient ? locations.filter((location) => inferFormTypeFromLocation(location) === selectedClient) : locations;
  const setupError = submissionsResult.error && isMissingCodSetup({ message: submissionsResult.error }) ? submissionsResult.error : null;
  const rows = submissionsResult.rows;
  const deposited = rows.reduce((sum, row) => sum + amountValue(row.deposited_amount), 0);
  const validated = rows.reduce((sum, row) => sum + amountValue(row.validated_amount ?? row.deposited_amount), 0);
  const pending = rows.filter((row) => row.validation_status === "Pending").length;
  const issues = rows.filter((row) => ["Short", "Excess", "Rejected"].includes(row.validation_status)).length;

  return (
    <AppShell active="COD" pageCode="cod_reports">
      <PageHead
        eyebrow="Ops Pulse"
        title="COD Reports"
        subtitle="Date, station, client, and validation-level COD reporting from actual submissions."
        action={<span className={`status-pill ${isSupabaseAdminConfigured ? "good" : "warn"}`}>{isSupabaseAdminConfigured ? "Database connected" : "Database key missing"}</span>}
      />
      <CodSectionTabs active="reports" />

      {setupError ? (
        <section className="panel message-panel error">
          <div className="panel-body"><strong>Database setup needed</strong><p className="subtle" style={{ marginTop: 6 }}>{codSetupMessage(setupError)}</p></div>
        </section>
      ) : null}

      {!setupError && (locationsError || submissionsResult.error) ? (
        <section className="panel message-panel error">
          <div className="panel-body"><strong>Unable to load COD reports</strong><p className="subtle" style={{ marginTop: 6 }}>{locationsError ?? submissionsResult.error}</p></div>
        </section>
      ) : null}

      {!setupError ? (
        <>
          <section className="panel">
            <div className="panel-body">
              <form action="/ops-pulse/cod/reports" className="form-grid five report-filter-grid">
                <label>From<input className="field" name="from" type="date" defaultValue={searchParams?.from ?? ""} /></label>
                <label>To<input className="field" name="to" type="date" defaultValue={searchParams?.to ?? ""} /></label>
                <label>Station
                  <select className="field" name="location" defaultValue={searchParams?.location ?? ""}>
                    <option value="">All permitted stations</option>
                    {clientLocations.map((location) => <option key={location.id} value={location.id}>{locationLabel(location)}</option>)}
                  </select>
                </label>
                <label>Client
                  <select className="field" name="client" defaultValue={searchParams?.client ?? ""}>
                    <option value="">All clients</option>
                    <option value="amazon">Amazon</option>
                    <option value="flipkart">Flipkart</option>
                  </select>
                </label>
                <label>Status
                  <select className="field" name="status" defaultValue={searchParams?.status ?? ""}>
                    <option value="">All statuses</option>
                    {["Pending", "Matched", "Short", "Excess", "Rejected"].map((status) => <option key={status}>{status}</option>)}
                  </select>
                </label>
                <div className="form-actions span-5 align-right">
                  <button className="button secondary" type="submit">Show report</button>
                </div>
              </form>
            </div>
          </section>

          <section className="summary-grid">
            <div className="metric-card"><span>Submissions</span><strong>{rows.length}</strong><small>For selected filter</small></div>
            <div className="metric-card"><span>Deposited</span><strong>{formatAmount(deposited)}</strong><small>Station submitted value</small></div>
            <div className="metric-card"><span>Validated</span><strong>{formatAmount(validated)}</strong><small>Manager accepted value</small></div>
            <div className="metric-card"><span>Pending / Issues</span><strong>{pending} / {issues}</strong><small>Open validation queue</small></div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>COD report</h2>
                <p className="subtle">Only real COD rows submitted from stations are shown here.</p>
              </div>
              <span className="count-badge">{rows.length} records</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Submitted</th>
                    <th>Station</th>
                    <th>Client</th>
                    <th>COD Period</th>
                    <th>Deposit Date</th>
                    <th>Remittance Code</th>
                    <th>Submitted</th>
                    <th>Validated</th>
                    <th>Variance</th>
                    <th>Status</th>
                    <th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length ? rows.map((row) => {
                    const station = firstRelation(row.stations);
                    const rowVariance = variance(row);
                    return (
                      <tr key={row.id}>
                        <td>{formatDateTime(row.created_at)}</td>
                        <td><strong>{locationLabel(station) || row.station_code || "-"}</strong></td>
                        <td>{row.client ?? formTypeLabel(row.form_type)}</td>
                        <td>{codPeriod(row)}</td>
                        <td>{formatDate(row.deposit_date)}</td>
                        <td>{row.remittance_code ?? row.reference_no ?? "-"}</td>
                        <td>{formatAmount(displayCodAmount(row))}</td>
                        <td>{formatAmount(row.validated_amount ?? row.deposited_amount)}</td>
                        <td>{formatAmount(rowVariance)}</td>
                        <td><StatusPill status={row.validation_status} /></td>
                        <td>{row.validation_remarks ?? row.remarks ?? "-"}</td>
                      </tr>
                    );
                  }) : (
                    <tr><td className="empty-cell" colSpan={11}>No COD report rows found for this filter.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </AppShell>
  );
}
