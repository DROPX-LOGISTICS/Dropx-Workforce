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
  codPeriod,
  codSetupMessage,
  depositAttachmentsFor,
  firstRelation,
  formatAmount,
  formatDate,
  formatDateTime,
  inferFormTypeFromLocation,
  isMissingCodSetup,
  loadCodLocations,
  loadCodSubmissions,
  locationLabel,
  formTypeLabel
} from "@/lib/ops-pulse/cod";
import { isSupabaseAdminConfigured } from "@/lib/supabase-admin";
import { createCodSubmission } from "./actions";

type SearchParams = {
  client?: string;
  from?: string;
  location?: string;
  status?: string;
  to?: string;
};

function todayKolkata() {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Kolkata",
    year: "numeric"
  }).format(new Date());
}

function loadFlash() {
  const raw = cookies().get("dropx_cod_submission_flash")?.value;
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

export const dynamic = "force-dynamic";

export default async function CodSubmissionPage({ searchParams }: { searchParams?: SearchParams }) {
  const authorization = await requirePagePermission("cod_submission", "access");
  const companyId = requireCompanyId(authorization);
  const permission = authorization.permissions.cod_submission;
  const flash = loadFlash();
  const today = todayKolkata();
  const selectedClient = searchParams?.client === "amazon" || searchParams?.client === "flipkart" ? searchParams.client : "";
  const [{ locations, error: locationsError }, submissionsResult] = await Promise.all([
    loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess),
    loadCodSubmissions(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess, {
      fromDate: searchParams?.from ?? "",
      formType: selectedClient,
      locationId: searchParams?.location ?? "",
      toDate: searchParams?.to ?? "",
      validationStatus: searchParams?.status ?? ""
    })
  ]);
  const setupError = submissionsResult.error && isMissingCodSetup({ message: submissionsResult.error }) ? submissionsResult.error : null;
  const clientLocations = selectedClient ? locations.filter((location) => inferFormTypeFromLocation(location) === selectedClient) : locations;
  const stationOptions = clientLocations.map((location) => {
    const inferred = inferFormTypeFromLocation(location);
    return {
      value: location.id,
      label: locationLabel(location),
      helper: [location.state, inferred ? formTypeLabel(inferred) : "Client from Location Master"].filter(Boolean).join(" / ")
    };
  });

  return (
    <AppShell active="COD" pageCode="cod_submission">
      <PageHead
        eyebrow="Ops Pulse"
        title="COD Submission"
        subtitle="Submit only the COD remittance code and CMS/bank deposit proof. Daily screenshots stay in Daily Submission."
        action={<span className={`status-pill ${isSupabaseAdminConfigured ? "good" : "warn"}`}>{isSupabaseAdminConfigured ? "Database connected" : "Database key missing"}</span>}
      />
      <CodSectionTabs active="submission" />

      {setupError ? (
        <section className="panel message-panel error">
          <div className="panel-body"><strong>Database setup needed</strong><p className="subtle" style={{ marginTop: 6 }}>{codSetupMessage(setupError)}</p></div>
        </section>
      ) : null}

      {!setupError && (locationsError || submissionsResult.error) ? (
        <section className="panel message-panel error">
          <div className="panel-body"><strong>Unable to load COD submissions</strong><p className="subtle" style={{ marginTop: 6 }}>{locationsError ?? submissionsResult.error}</p></div>
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
            <div className="panel-head toolbar">
              <div>
                <h2>Submit COD deposit</h2>
                <p className="subtle">Station access comes from user role. Client/source is inferred from the selected station in Location Master.</p>
              </div>
            </div>
            <div className="panel-body">
              <form action={createCodSubmission} className="form-grid three" encType="multipart/form-data">
                <label className="span-2">Station
                  <SearchableSelect disabled={!permission.canAdd} name="location_id" options={stationOptions} placeholder="Select station" required />
                </label>
                <label>Deposit Date<input className="field" name="deposit_date" type="date" defaultValue={today} required /></label>
                <label>COD From<input className="field" name="cod_period_from" type="date" defaultValue={today} required /></label>
                <label>COD To<input className="field" name="cod_period_to" type="date" defaultValue={today} required /></label>
                <label>Deposited Amount<input className="field" name="deposited_amount" inputMode="decimal" placeholder="Amount deposited" required /></label>
                <label>Remittance Code<input className="field" name="remittance_code" placeholder="CMS / bank remittance code" required /></label>
                <label>Submitted By<input className="field" name="submitter_name" placeholder="Name of station user" /></label>
                <label className="span-2">CMS Cash / Bank Deposit Slip<input className="field" name="deposit_slip" type="file" accept="image/*,.pdf" required /></label>
                <label className="span-3">Remarks<textarea className="field" name="remarks" placeholder="Exception notes, if any" rows={3} /></label>
                <div className="form-actions span-3 align-right">
                  <SubmitButton disabled={!permission.canAdd || !isSupabaseAdminConfigured}>Submit COD</SubmitButton>
                </div>
              </form>
            </div>
          </section>

          <section className="panel">
            <div className="panel-body">
              <form action="/ops-pulse/cod/submission" className="form-grid four">
                <label>From<input className="field" name="from" type="date" defaultValue={searchParams?.from ?? ""} /></label>
                <label>To<input className="field" name="to" type="date" defaultValue={searchParams?.to ?? ""} /></label>
                <label>Station
                  <select className="field" name="location" defaultValue={searchParams?.location ?? ""}>
                    <option value="">All permitted stations</option>
                    {clientLocations.map((location) => <option key={location.id} value={location.id}>{locationLabel(location)}</option>)}
                  </select>
                </label>
                <input type="hidden" name="client" value={selectedClient} />
                <label>Validation
                  <select className="field" name="status" defaultValue={searchParams?.status ?? ""}>
                    <option value="">All statuses</option>
                    {["Pending", "Matched", "Short", "Excess", "Rejected"].map((status) => <option key={status}>{status}</option>)}
                  </select>
                </label>
                <div className="form-actions span-4 align-right">
                  <button className="button secondary" type="submit">Show submissions</button>
                </div>
              </form>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>COD submission register</h2>
                <p className="subtle">This is the live queue for manager/payroll validation.</p>
              </div>
              <span className="count-badge">{submissionsResult.rows.length} records</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Submitted</th>
                    <th>Station</th>
                    <th>Client</th>
                    <th>COD Date</th>
                    <th>Deposit Date</th>
                    <th>Remittance Code</th>
                    <th>Amount</th>
                    <th>Slip</th>
                    <th>Validation</th>
                    <th>AI</th>
                  </tr>
                </thead>
                <tbody>
                  {submissionsResult.rows.length ? submissionsResult.rows.map((row) => {
                    const station = firstRelation(row.stations);
                    return (
                      <tr key={row.id}>
                        <td>{formatDateTime(row.created_at)}</td>
                        <td><strong>{locationLabel(station) || row.station_code || "-"}</strong></td>
                        <td>{row.client ?? formTypeLabel(row.form_type)}</td>
                        <td>{codPeriod(row)}</td>
                        <td>{formatDate(row.deposit_date)}</td>
                        <td>{row.remittance_code ?? row.reference_no ?? "-"}</td>
                        <td>{formatAmount(row.deposited_amount)}</td>
                        <td>{depositAttachmentsFor(row).length}</td>
                        <td><StatusPill status={row.validation_status} /></td>
                        <td><StatusPill status={row.ai_status ?? "Not queued"} /></td>
                      </tr>
                    );
                  }) : (
                    <tr><td className="empty-cell" colSpan={10}>No COD submissions found for this filter.</td></tr>
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
