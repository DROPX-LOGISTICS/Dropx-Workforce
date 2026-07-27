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
  loadPortalCheckRuns,
  locationLabel,
  type ExecutiveReconciliationViewRow
} from "@/lib/ops-pulse/cod";
import { isSupabaseAdminConfigured } from "@/lib/supabase-admin";
import {
  addManualExecutiveReconciliation,
  continueCodWithPendingDriverReconciliation,
  deleteExecutiveReconciliation,
  queueCodClosureCheck,
  requestCodGateException,
  reviewCodGateException,
  refreshExecutiveReconciliationRoster,
  saveExecutiveReconciliation,
  submitCodCashCollection,
  submitCodDayClosure
} from "./actions";
import { LiveCacheRefresh } from "./live-cache-refresh";
import { AssociateEntryBuilder } from "./associate-entry-builder";
import { loadCodDayClosures, loadCodManagerNotifications } from "@/lib/ops-pulse/cod-day-closure";
import { canAccessCodAudit, loadCodAuditRows } from "@/lib/ops-pulse/cod-audit";
import { PortalCheckProgress } from "./portal-check-progress";
import { resolveOperatingContext } from "@/lib/ops-pulse/operating-context";
import { CashSubmissionButton } from "./cash-submission-button";

export const maxDuration = 300;

type SearchParams = {
  date?: string;
  location?: string;
  status?: string;
  step?: string;
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
  if (searchParams?.step) query.set("step", searchParams.step);
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

  const operatingContext = resolveOperatingContext(result.locations);
  const requestedLocationId = searchParams?.location ?? "";
  const defaultLocationId = result.locations.some((location) => location.id === requestedLocationId)
    ? requestedLocationId
    : operatingContext.location?.id ?? "";
  const returnHref = currentHref({
    date: searchParams?.date ?? result.businessDate,
    location: defaultLocationId,
    status: searchParams?.status ?? "",
    step: searchParams?.step ?? "1"
  });
  const resultSetupError = result.error && isMissingCodSetup({ message: result.error }) ? result.error : null;
  const setupError = resultSetupError;
  const stationOptions = result.locations.map((location) => ({
    helper: [location.state, location.station_name].filter(Boolean).join(" / "),
    label: locationLabel(location),
    value: location.id
  }));
  const selectedStation = result.locations.find((location) => location.id === defaultLocationId);
  const rows = defaultLocationId
    ? result.rows.filter((row) => row.location_id === defaultLocationId || row.station_code === selectedStation?.station_code)
    : result.rows;
  const savedRows = rows.filter((row) => row.reconciliation_id);
  const availableRows = rows.filter((row) => row.source_associate_name && !row.reconciliation_id);
  const completed = savedRows.filter((row) => row.reconciliation_status === "Completed").length;
  const expectedTotal = savedRows.reduce((sum, row) => sum + amountValue(row.expected_amount), 0);
  const collectedTotal = savedRows.reduce((sum, row) => sum + amountValue(row.collected_amount), 0);
  const netDifference = savedRows.reduce((sum, row) => sum + amountValue(row.difference_amount), 0);
  const hasSingleStationScope = result.locations.length <= 1;
  const sccRows = rows.filter((row) => row.source === "scc_driver_reconciliation").length;
  const workerReady = Boolean(process.env.OPS_PORTAL_WORKER_URL?.trim() && process.env.OPS_PORTAL_WORKER_SECRET?.trim());
  const auditAllowed = canAccessCodAudit(authorization);
  const [closures, managerNotifications, auditRows, portalRunsResult] = await Promise.all([
    loadCodDayClosures(companyId, result.businessDate, result.locations.map((location) => location.id)),
    loadCodManagerNotifications(companyId, result.locations.map((location) => location.id)),
    auditAllowed
      ? loadCodAuditRows(companyId, result.locations.map((location) => location.id), result.businessDate, defaultLocationId)
      : Promise.resolve([]),
    loadPortalCheckRuns(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess, {
      checkDate: result.businessDate,
      locationId: defaultLocationId
    })
  ]);
  const driverRun = portalRunsResult.rows.find((run) => run.check_type === "driver_reconciliation");
  const depositRun = portalRunsResult.rows.find((run) => run.check_type === "prepared_deposit");
  const hasActivePortalCheck = [driverRun, depositRun].some((run) =>
    run && ["Queued", "Running", "Manual Review", "Error"].includes(run.status) && Number(run.attempt_count ?? 0) < 3
  );
  const selectedClosure = closures.find((closure) => closure.location_id === defaultLocationId) ?? null;
  const closureSnapshot = objectValue(selectedClosure?.validation_snapshot);
  const cashSubmissionSnapshot = objectValue(closureSnapshot.cash_submission);
  const cashSubmitted = Boolean(cashSubmissionSnapshot.submitted_at) && selectedClosure?.submission_status !== "Draft";
  const submittedDifference = amountValue(String(cashSubmissionSnapshot.difference_amount ?? 0));
  const cashSubmissionStatus = !cashSubmitted
    ? "Draft"
    : submittedDifference < 0
      ? "Submitted with shortage"
      : submittedDifference > 0
        ? "Submitted with excess"
        : "Submitted";
  const currentVarianceType = netDifference < 0 ? "short" : netDifference > 0 ? "excess" : "balanced";
  const currentVarianceLabel = netDifference < 0
    ? `COD short ${formatAmount(Math.abs(netDifference))}`
    : netDifference > 0
      ? `COD excess ${formatAmount(netDifference)}`
      : "No COD variance";
  const driverCleared = selectedClosure?.driver_check_status === "Passed" ||
    selectedClosure?.driver_check_status === "Exception approved";
  const driverDisplayStatus = driverRun?.status === "Pass"
    ? "Driver recon cleared"
    : driverRun?.status === "Fail"
      ? `Pending recon found${Number(driverRun.pending_count ?? 0) ? ` · ${driverRun.pending_count}` : ""}`
      : driverRun?.status === "Error"
        ? "Validation unavailable"
        : driverRun?.status === "Manual Review"
          ? "Manual login required"
      : selectedClosure?.driver_exception_reason?.startsWith("Continued with SCC pending.")
        ? "Continued with pending · notified"
        : selectedClosure?.driver_check_status ?? "Not run";
  const depositAmountDifference = Number((
    collectedTotal - amountValue(selectedClosure?.amazon_open_remittance_expected)
  ).toFixed(2));
  const depositMatched = selectedClosure?.deposit_check_status === "Passed" &&
    selectedClosure.no_deposit_liability &&
    selectedClosure.amazon_open_remittance_count > 0 &&
    Math.abs(depositAmountDifference) <= 1;
  const depositCleared = depositMatched || selectedClosure?.deposit_check_status === "Exception approved";
  const depositDisplayStatus = selectedClosure?.deposit_check_status === "Passed" && !depositMatched
    ? "Pending"
    : selectedClosure?.deposit_check_status ?? "Locked";
  const canManagerReview = auditAllowed;
  const requestedStep = ["1", "2", "3"].includes(String(searchParams?.step)) ? Number(searchParams?.step) : 1;
  const cashReady = savedRows.length > 0;
  const activeStep = requestedStep >= 3 && !driverCleared
    ? cashReady ? 2 : 1
    : requestedStep >= 2 && !cashReady
      ? 1
      : requestedStep;
  const stepHref = (step: number) => currentHref({
    date: result.businessDate,
    location: defaultLocationId,
    status: searchParams?.status ?? "",
    step: String(step)
  });
  return (
    <AppShell active="COD" pageCode="cod_executive_reconciliation">
      <PageHead
        eyebrow="Ops Pulse"
        title="Executive Reconciliation"
        subtitle="Count cash, validate SCC and close the station day."
        action={<span className={`status-pill ${workerReady && isSupabaseAdminConfigured ? "good" : "warn"}`}>{workerReady && isSupabaseAdminConfigured ? "Automation ready" : "Setup required"}</span>}
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
          <LiveCacheRefresh active={hasActivePortalCheck} />
          <section className="panel reconciliation-control-bar">
            <div className="panel-body">
              <form action="/ops-pulse/cod/executive-reconciliation" className="form-grid cod-reconciliation-filter-grid">
                <label>Business Date<input className="field" name="date" type="date" defaultValue={result.businessDate} /></label>
                <label className="span-2">Station
                  <select className="field" name="location" defaultValue={defaultLocationId} disabled={hasSingleStationScope}>
                    {!hasSingleStationScope ? <option value="">Select station</option> : null}
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
                <input type="hidden" name="step" value="1" />
                <div className="form-actions cod-filter-actions align-right">
                  <button className="button secondary" type="submit">Apply</button>
                </div>
              </form>
            </div>
          </section>

          <nav className="reconciliation-wizard" aria-label="Executive reconciliation steps">
            <a className={`${activeStep === 1 ? "current" : ""} ${cashReady ? "complete" : ""}`} href={stepHref(1)}>
              <i>1</i><span><strong>Cash sheet</strong><small>Select drivers and count cash</small></span>
            </a>
            <a className={`${activeStep === 2 ? "current" : ""} ${driverCleared ? "complete" : ""} ${!cashReady ? "locked" : ""}`} href={cashReady ? stepHref(2) : stepHref(1)} aria-disabled={!cashReady}>
              <i>2</i><span><strong>Driver validation</strong><small>Submit COD and check SCC</small></span>
            </a>
            <a className={`${activeStep === 3 ? "current" : ""} ${selectedClosure?.is_final_submitted ? "complete" : ""} ${!driverCleared ? "locked" : ""}`} href={driverCleared ? stepHref(3) : stepHref(cashReady ? 2 : 1)} aria-disabled={!driverCleared}>
              <i>3</i><span><strong>Deposit & summary</strong><small>Match bank deposit and close</small></span>
            </a>
          </nav>

          {activeStep === 1 ? (
            <section className="panel reconciliation-stage">
              <div className="panel-head">
                <div><span className="stage-kicker">Step 1 of 3</span><h2>Associate cash sheet</h2><p className="subtle">Select one driver or add all available drivers, then enter the expected COD and denomination count.</p></div>
                <StatusPill status={rows.length ? `${availableRows.length} available` : "Driver sync required"} />
              </div>
              <div className="panel-body reconciliation-cash-source">
                <div className="reconciliation-stage-action">
                  <div><strong>{selectedStation ? `${selectedStation.station_code} · ${result.businessDate}` : "Select a station"}</strong><span>{rows.length ? `${rows.length} drivers loaded · ${savedRows.length} cash rows saved` : "Load SCC drivers before adding cash rows."}</span></div>
                  {defaultLocationId ? (
                    <form action={refreshExecutiveReconciliationRoster}>
                      <input type="hidden" name="return_href" value={stepHref(1)} />
                      <input type="hidden" name="business_date" value={result.businessDate} />
                      <input type="hidden" name="location_id" value={defaultLocationId} />
                      <SubmitButton className="button secondary" disabled={!permission.canEdit || Boolean(selectedClosure?.is_final_submitted)}>
                        {rows.length ? "Refresh drivers" : "Load drivers"}
                      </SubmitButton>
                    </form>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          <section className={`summary-grid reconciliation-summary ${activeStep === 1 ? "reconciliation-step-hidden" : ""}`}>
            <div className="metric-card"><span>Associates</span><strong>{rows.length}</strong><small>{sccRows ? `${sccRows} validated in SCC` : "From station shipment data"}</small></div>
            <div className="metric-card"><span>Cash entered</span><strong>{savedRows.length}</strong><small>{completed} balanced</small></div>
            <div className="metric-card"><span>Collected</span><strong>{formatAmount(collectedTotal)}</strong><small>Expected {formatAmount(expectedTotal)}</small></div>
            <div className="metric-card"><span>COD variance</span><strong className={moneyClass(netDifference)}>{differenceLabel(netDifference)}</strong><small>Short or excess can be submitted</small></div>
          </section>

          <section className={`panel reconciliation-closure-panel ${activeStep !== 2 && activeStep !== 3 ? "reconciliation-step-hidden" : ""}`}>
            <div className="panel-head">
              <div>
                <h2>{activeStep === 2 ? "Submit cash & validate drivers" : "Bank deposit & closure summary"}</h2>
                <p className="subtle">{selectedStation ? `${selectedStation.station_code} · ${result.businessDate}` : "Select a station"}</p>
              </div>
              <StatusPill status={selectedClosure?.is_final_submitted ? "Final submitted" : cashSubmissionStatus} />
            </div>
            <div className="panel-body">
              {activeStep === 3 ? (
                <section className="reconciliation-final-summary">
                  <div><span>Cash submitted</span><strong>{formatAmount(collectedTotal)}</strong><small>{currentVarianceLabel}</small></div>
                  <div><span>SCC driver check</span><strong>{driverDisplayStatus}</strong><small>{Number(driverRun?.pending_count ?? 0)} pending · {formatAmount(driverRun?.pending_amount)}</small></div>
                  <div><span>Bank expected</span><strong>{formatAmount(selectedClosure?.amazon_open_remittance_expected)}</strong><small>{selectedClosure?.amazon_open_remittance_count ?? 0} open remittances</small></div>
                  <div><span>Deposit difference</span><strong className={moneyClass(depositAmountDifference)}>{differenceLabel(depositAmountDifference)}</strong><small>{depositDisplayStatus}</small></div>
                </section>
              ) : null}
              <div className="reconciliation-lifecycle reconciliation-step-hidden" aria-label="COD closure lifecycle">
                <div className={savedRows.length ? "complete" : "current"}><i>1</i><span>Cash sheet</span><strong>{savedRows.length ? `${savedRows.length} entered` : "Start"}</strong></div>
                <div className={cashSubmitted ? "complete" : savedRows.length ? "current" : ""}><i>2</i><span>Submit COD</span><strong>{cashSubmissionStatus}</strong></div>
                <div className={driverCleared ? "complete" : cashSubmitted ? "current" : ""}><i>3</i><span>Driver recon</span><strong>{driverDisplayStatus}</strong></div>
                <div className={selectedClosure?.is_final_submitted ? "complete" : driverCleared ? "current" : ""}><i>4</i><span>Deposit & close</span><strong>{selectedClosure?.is_final_submitted ? "Closed" : depositDisplayStatus}</strong></div>
              </div>
              {defaultLocationId ? (
                <>
                  <section className={`cash-submission-card ${currentVarianceType} ${activeStep !== 2 ? "reconciliation-step-hidden" : ""}`}>
                    <div>
                      <span>Cash submission</span>
                      <strong>{currentVarianceLabel}</strong>
                      <small>
                        Expected {formatAmount(expectedTotal)} · Collected {formatAmount(collectedTotal)}
                        {cashSubmitted ? ` · Last submitted ${formatDateTime(String(cashSubmissionSnapshot.submitted_at ?? ""))}` : ""}
                      </small>
                    </div>
                    <form action={submitCodCashCollection}>
                      <input type="hidden" name="return_href" value={returnHref} />
                      <input type="hidden" name="business_date" value={result.businessDate} />
                      <input type="hidden" name="location_id" value={defaultLocationId} />
                      <CashSubmissionButton
                        disabled={!permission.canEdit || !savedRows.length || Boolean(selectedClosure?.is_final_submitted)}
                        varianceLabel={currentVarianceLabel}
                        varianceType={currentVarianceType}
                      />
                    </form>
                  </section>
                  {activeStep === 2 && cashSubmitted && submittedDifference !== 0 ? (
                    <div className="cash-exception-strip">
                      <StatusPill status={cashSubmissionStatus} />
                      <span>
                        Manager notification: {selectedClosure?.manager_status === "Pending" ? "sent / pending review" : selectedClosure?.manager_status ?? "pending"}.
                        Driver Reconciliation continues independently.
                      </span>
                    </div>
                  ) : null}
                  <div className="reconciliation-gates">
                  <section className={`reconciliation-gate ${activeStep !== 2 ? "reconciliation-step-hidden" : ""}`}>
                    <div className="reconciliation-gate-head">
                      <div><span>Validation 1</span><strong>Driver reconciliation</strong></div>
                      <StatusPill status={driverDisplayStatus} />
                    </div>
                    <PortalCheckProgress
                      attemptCount={Number(driverRun?.attempt_count ?? 0)}
                      checkLabel="SCC Driver Reconciliation"
                      lastCheckedAt={driverRun?.last_checked_at ?? null}
                      nextCheckAt={driverRun?.next_check_at ?? null}
                      summary={driverRun?.summary ?? null}
                      status={driverRun?.status ?? "Not run"}
                    />
                    <form action={queueCodClosureCheck} className="form-actions" style={{ marginTop: 12 }}>
                      <input type="hidden" name="return_href" value={returnHref} />
                      <input type="hidden" name="business_date" value={result.businessDate} />
                      <input type="hidden" name="location_id" value={defaultLocationId} />
                      <input type="hidden" name="check_type" value="driver_reconciliation" />
                      <SubmitButton className="button secondary" disabled={!permission.canEdit || !cashSubmitted || selectedClosure?.is_final_submitted}>
                        {cashSubmitted ? "Recheck SCC" : "Submit cash first"}
                      </SubmitButton>
                    </form>
                    {selectedClosure && ["Pending", "Manual Review", "Error", "Exception rejected"].includes(selectedClosure.driver_check_status) ? (
                      <details className="reconciliation-exception">
                        <summary>Continue with SCC pending</summary>
                        <form action={continueCodWithPendingDriverReconciliation} className="form-grid three">
                          <input type="hidden" name="return_href" value={returnHref} />
                          <input type="hidden" name="business_date" value={result.businessDate} />
                          <input type="hidden" name="location_id" value={defaultLocationId} />
                          <label className="span-2">Reason<textarea className="field" name="exception_reason" rows={2} placeholder="Why the station is proceeding with SCC pending" required /></label>
                          <div className="form-actions align-right"><SubmitButton>Continue & notify</SubmitButton></div>
                        </form>
                      </details>
                    ) : null}
                    {selectedClosure?.driver_check_status === "Exception requested" ? (
                      <div className="alert danger" style={{ marginTop: 12 }}>
                        <strong>Manager approval pending</strong>
                        <span>{selectedClosure.driver_exception_reason}</span>
                      </div>
                    ) : null}
                    {selectedClosure?.driver_check_status === "Exception requested" && canManagerReview ? (
                      <form action={reviewCodGateException} className="form-grid three" style={{ marginTop: 12 }}>
                        <input type="hidden" name="return_href" value={returnHref} />
                        <input type="hidden" name="closure_id" value={selectedClosure.id} />
                        <input type="hidden" name="gate" value="driver" />
                        <label className="span-2">Manager remarks<input className="field" name="manager_remarks" placeholder="Approval or rejection remarks" /></label>
                        <div className="form-actions align-right">
                          <button className="button secondary" name="decision" value="reject">Reject</button>
                          <button className="button" name="decision" value="approve">Approve exception</button>
                        </div>
                      </form>
                    ) : null}
                  </section>

                  <section className={`reconciliation-gate ${!driverCleared ? "locked" : ""} ${activeStep !== 3 ? "reconciliation-step-hidden" : ""}`}>
                    <div className="reconciliation-gate-head">
                      <div><span>Validation 2</span><strong>Bank deposit</strong></div>
                      <StatusPill status={depositDisplayStatus} />
                    </div>
                    <PortalCheckProgress
                      attemptCount={Number(depositRun?.attempt_count ?? 0)}
                      checkLabel="SCC Bank Deposit"
                      lastCheckedAt={depositRun?.last_checked_at ?? null}
                      nextCheckAt={depositRun?.next_check_at ?? null}
                      summary={depositRun?.summary ?? null}
                      status={driverCleared ? depositRun?.status ?? "Not run" : "Locked"}
                    />
                    <form action={queueCodClosureCheck} className="form-actions" style={{ marginTop: 12 }}>
                      <input type="hidden" name="return_href" value={returnHref} />
                      <input type="hidden" name="business_date" value={result.businessDate} />
                      <input type="hidden" name="location_id" value={defaultLocationId} />
                      <input type="hidden" name="check_type" value="prepared_deposit" />
                      <SubmitButton className="button secondary" disabled={!permission.canEdit || !driverCleared || selectedClosure?.is_final_submitted}>
                        {driverCleared ? "Validate deposit" : "Driver recon required"}
                      </SubmitButton>
                    </form>
                    {selectedClosure && ["Pending", "Error", "Exception rejected"].includes(depositDisplayStatus) ? (
                      <details className="reconciliation-exception">
                        <summary>Request exception</summary>
                        <form action={requestCodGateException} className="form-grid three">
                          <input type="hidden" name="return_href" value={returnHref} />
                          <input type="hidden" name="business_date" value={result.businessDate} />
                          <input type="hidden" name="location_id" value={defaultLocationId} />
                          <input type="hidden" name="gate" value="deposit" />
                          <label className="span-2">Reason<textarea className="field" name="exception_reason" rows={2} required /></label>
                          <div className="form-actions align-right"><SubmitButton>Send to manager</SubmitButton></div>
                        </form>
                      </details>
                    ) : null}
                    {selectedClosure?.deposit_check_status === "Exception requested" ? (
                      <div className="alert danger" style={{ marginTop: 12 }}>
                        <strong>Manager approval pending</strong>
                        <span>{selectedClosure.deposit_exception_reason}</span>
                      </div>
                    ) : null}
                    {selectedClosure?.deposit_check_status === "Exception requested" && canManagerReview ? (
                      <form action={reviewCodGateException} className="form-grid three" style={{ marginTop: 12 }}>
                        <input type="hidden" name="return_href" value={returnHref} />
                        <input type="hidden" name="closure_id" value={selectedClosure.id} />
                        <input type="hidden" name="gate" value="deposit" />
                        <label className="span-2">Manager remarks<input className="field" name="manager_remarks" placeholder="Approval or rejection remarks" /></label>
                        <div className="form-actions align-right">
                          <button className="button secondary" name="decision" value="reject">Reject</button>
                          <button className="button" name="decision" value="approve">Approve exception</button>
                        </div>
                      </form>
                    ) : null}
                  </section>

                  <section className={`reconciliation-gate final ${!depositCleared ? "locked" : ""} ${activeStep !== 3 ? "reconciliation-step-hidden" : ""}`}>
                    <div className="reconciliation-gate-head">
                      <div><span>Final</span><strong>Close station day</strong></div>
                      <StatusPill status={selectedClosure?.is_final_submitted ? "Final submitted" : "Pending"} />
                    </div>
                    <p className="subtle">Final close locks all cash entries.</p>
                    <form action={submitCodDayClosure} className="form-actions" style={{ marginTop: 12 }}>
                      <input type="hidden" name="return_href" value={returnHref} />
                      <input type="hidden" name="business_date" value={result.businessDate} />
                      <input type="hidden" name="location_id" value={defaultLocationId} />
                      <SubmitButton disabled={!permission.canEdit || !driverCleared || !depositCleared || selectedClosure?.is_final_submitted}>
                        {selectedClosure?.is_final_submitted ? "Final submitted and locked" : "Submit final COD closure"}
                      </SubmitButton>
                    </form>
                  </section>
                </div>
                </>
              ) : <p className="subtle">Select one station to submit its day closure.</p>}
              {activeStep === 3 && managerNotifications.length ? (
                <details className="reconciliation-support-panel">
                  <summary>Manager notifications ({managerNotifications.length})</summary>
                  <div className="table-wrap">
                  <table>
                    <thead><tr><th>Created</th><th>Manager notification</th><th>Portal</th><th>Email</th></tr></thead>
                    <tbody>
                      {managerNotifications.map((notification) => (
                        <tr key={notification.id}>
                          <td>{formatDateTime(notification.created_at)}</td>
                          <td><strong>{notification.title}</strong><br /><span className="subtle">{notification.message}</span></td>
                          <td><StatusPill status={notification.status} /></td>
                          <td><StatusPill status={notification.email_status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </details>
              ) : null}
            </div>
          </section>

          <section className={`panel ${activeStep !== 1 ? "reconciliation-step-hidden" : ""}`}>
            <div className="panel-head">
              <div>
                <h2>Collect cash</h2>
                <p className="subtle">Select associate, count denominations and save.</p>
              </div>
              <span className="count-badge">{availableRows.length} available</span>
            </div>
            {defaultLocationId && selectedStation ? (
              <AssociateEntryBuilder
                associates={availableRows
                  .map((row) => ({
                    name: row.source_associate_name ?? "",
                    providerEmployeeId: row.provider_employee_id,
                    shipmentType: row.shipment_type ?? "SCC Driver Reconciliation",
                    pendingAmount: amountValue(row.pending_amount)
                  }))}
                businessDate={result.businessDate}
                canEdit={permission.canEdit && !selectedClosure?.is_final_submitted}
                locationId={defaultLocationId}
                returnHref={returnHref}
                stationCode={selectedStation.station_code}
                stationLabel={selectedStation.station_name ?? selectedStation.state ?? ""}
              />
            ) : (
              <div className="panel-body"><p className="subtle">Select one station to load its Amazon associates.</p></div>
            )}
          </section>

          <section className={`panel ${activeStep !== 1 ? "reconciliation-step-hidden" : ""}`}>
            <div className="panel-head">
              <div>
                <h2>Saved cash</h2>
                <p className="subtle">Edit or delete before final close.</p>
              </div>
              <span className="count-badge">{savedRows.length} entries</span>
            </div>
            <div className="table-wrap reconciliation-saved-wrap" aria-label="Executive reconciliation sheet">
              <table className="reconciliation-saved-table">
                <thead>
                  <tr>
                    <th>Associate</th>
                    <th>Executive ID</th>
                    <th>Expected COD</th>
                    <th>Cash count</th>
                    <th>Collected</th>
                    <th>Difference</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {savedRows.length ? savedRows.map((row) => {
                    const difference = amountValue(row.difference_amount);
                    return (
                      <tr key={row.key}>
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
                        <td>
                          <details className="cash-breakdown inline">
                            <summary>Edit denominations</summary>
                            <div className="cash-breakdown-grid">
                              {denominations.map(([name, label]) => (
                                <label key={`${row.key}-${name}`}>₹{label}
                                  <input className="field compact-field cash-count-field" form={`recon-${row.key}`} name={name} defaultValue={String(denominationValue(row, name))} inputMode="numeric" />
                                </label>
                              ))}
                              <label>Other
                                <input className="field compact-field cash-count-field" form={`recon-${row.key}`} name="cash_other_amount" defaultValue={String(row.cash_other_amount ?? 0)} inputMode="decimal" />
                              </label>
                              <label className="cash-remarks">Remarks
                                <input className="field compact-field" form={`recon-${row.key}`} name="remarks" defaultValue={row.remarks ?? ""} placeholder="Optional note" />
                              </label>
                            </div>
                          </details>
                        </td>
                        <td><strong>{formatAmount(row.collected_amount)}</strong></td>
                        <td><strong className={moneyClass(difference)}>{differenceLabel(difference)}</strong></td>
                        <td><StatusPill status={row.reconciliation_status} /></td>
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
                            <div className="form-actions" style={{ flexWrap: "nowrap" }}>
                              <SubmitButton className="button secondary small-button" disabled={!permission.canEdit || selectedClosure?.is_final_submitted}>Update</SubmitButton>
                              <button
                                className="button ghost small-button"
                                formAction={deleteExecutiveReconciliation}
                                disabled={!permission.canEdit || selectedClosure?.is_final_submitted}
                                type="submit"
                              >
                                Delete
                              </button>
                            </div>
                          </form>
                        </td>
                      </tr>
                    );
                  }) : (
                    <tr><td className="empty-cell" colSpan={8}>No saved cash entries.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {savedRows.length ? <div className="reconciliation-stage-footer"><span>Review differences before submitting COD.</span><a className="button" href={stepHref(2)}>Continue to driver validation →</a></div> : null}
          </section>

          {activeStep === 3 && auditAllowed ? (
            <details className="panel reconciliation-support-panel">
              <summary>Activity history ({auditRows.length})</summary>
              <div className="reconciliation-support-toolbar">
                <span className="subtle">Entries, edits, deletions, checks and approvals</span>
                <a className="button secondary" href={`/api/ops-pulse/cod/audit-export?date=${encodeURIComponent(result.businessDate)}${defaultLocationId ? `&location=${encodeURIComponent(defaultLocationId)}` : ""}`}>Download CSV</a>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Time</th><th>Station</th><th>Associate</th><th>Action</th><th>Changed fields</th><th>Performed by</th></tr></thead>
                  <tbody>
                    {auditRows.length ? auditRows.map((audit) => (
                      <tr key={audit.id}>
                        <td>{formatDateTime(audit.created_at)}</td>
                        <td>{audit.station_code}</td>
                        <td>{audit.associate_name ?? audit.provider_employee_id ?? "-"}</td>
                        <td><strong>{audit.action}</strong></td>
                        <td>{Array.isArray(audit.changed_fields) && audit.changed_fields.length ? audit.changed_fields.join(", ") : "-"}</td>
                        <td>{audit.actor_name ?? audit.actor_email ?? audit.actor_role ?? "-"}</td>
                      </tr>
                    )) : (
                      <tr><td className="empty-cell" colSpan={6}>No audited COD activity for this selection yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}

          {activeStep === 1 && permission.canAdd ? (
            <details className="panel reconciliation-support-panel">
              <summary>Add associate missing from DER</summary>
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
            </details>
          ) : null}
        </>
      ) : null}
    </AppShell>
  );
}
