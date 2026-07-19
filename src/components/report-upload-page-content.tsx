import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { ReportImportUploader } from "@/components/report-import-uploader";
import { StatusPill } from "@/components/status-pill";
import { getAuthorization } from "@/lib/authorization";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";

type ImportBatch = {
  id: string;
  source_type: string;
  file_name: string;
  row_count: number;
  imported_row_count: number;
  skipped_row_count: number;
  status: string;
  message: string | null;
  report_from: string | null;
  report_to: string | null;
  created_at: string;
};

const sourceNames: Record<string, string> = {
  amazon_shipments: "Amazon shipment",
  bpcl_fuel: "BPCL fuel",
  cashbook: "Cashbook",
  iocl_fuel: "IOC fuel"
};

function displayDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

function displayRange(from: string | null, to: string | null) {
  if (!from && !to) return "-";
  if (from === to || !to) return from ?? "-";
  return `${from} to ${to}`;
}

async function loadRecentImports(companyId: string | null) {
  if (!companyId || !supabaseAdmin) return { rows: [] as ImportBatch[], error: null as string | null };
  const { data, error } = await supabaseAdmin
    .from("report_import_batches")
    .select("id, source_type, file_name, row_count, imported_row_count, skipped_row_count, status, message, report_from, report_to, created_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return { rows: [] as ImportBatch[], error: error.message };
  return { rows: (data ?? []) as ImportBatch[], error: null };
}

export async function ReportUploadPageContent({
  active = "Report Upload",
  pageCode = "report_upload"
}: {
  active?: string;
  pageCode?: string;
}) {
  const authorization = await getAuthorization();
  const { rows, error } = await loadRecentImports(authorization?.companyId ?? null);

  return (
    <AppShell active={active} pageCode={pageCode}>
      <PageHead
        eyebrow="Report Imports"
        title="Source file imports"
        subtitle="Upload Amazon shipment counts, IOC/BPCL fuel, and cashbook expenses. Imported rows feed CPS and later payroll."
        action={<span className={`status-pill ${isSupabaseAdminConfigured ? "good" : "warn"}`}>{isSupabaseAdminConfigured ? "Database connected" : "Database key missing"}</span>}
      />

      {error ? (
        <section className="panel message-panel error">
          <div className="panel-body">
            <strong>Database setup needed</strong>
            <p className="subtle" style={{ marginTop: 6 }}>
              {error} Run `scripts/cps_report_imports_v1.sql` in Supabase SQL Editor, then refresh this page.
            </p>
          </div>
        </section>
      ) : null}

      <section className="grid two">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Upload report</h2>
              <p className="subtle">Each file is stored raw first, then normalized into station-day facts.</p>
            </div>
          </div>
          <ReportImportUploader />
        </div>

        <aside className="panel">
          <div className="panel-head"><h2>What this feeds</h2></div>
          <div className="panel-body stacked">
            <div className="queue-card">
              <span className="process-step">1</span>
              <strong>Amazon shipment counts become CPS denominator by station/date.</strong>
            </div>
            <div className="queue-card">
              <span className="process-step">2</span>
              <strong>IOC/BPCL fuel gets mapped by vehicle to station where possible.</strong>
            </div>
            <div className="queue-card">
              <span className="process-step">3</span>
              <strong>Cashbook rows become fuel, rent, vehicle, staff, DA, or other CPS cost heads.</strong>
            </div>
            <div className="queue-card">
              <span className="process-step">4</span>
              <strong>Payroll can later update DA and staff costs on the same CPS day rows.</strong>
            </div>
          </div>
        </aside>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Accepted file contracts</h2>
            <p className="subtle">Column names can vary, but each source must contain the practical fields listed below.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Source</th><th>Required</th><th>Used for CPS</th><th>Future link</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>Amazon shipment count</td>
                <td>date, station, provider/holder ID, delivered units</td>
                <td>Station denominator and DA activity</td>
                <td>DA payroll rate cards</td>
              </tr>
              <tr>
                <td>IOC/BPCL fuel</td>
                <td>transaction date, amount, vehicle number</td>
                <td>Fuel cost by station through vehicle master</td>
                <td>Fleet fuel variance</td>
              </tr>
              <tr>
                <td>Cashbook</td>
                <td>date, station, amount, expense type/category</td>
                <td>Rent, vehicle, fuel, staff, DA, other costs</td>
                <td>Finance approval and P&L</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Recent imports</h2>
            <p className="subtle">{rows.length} batch{rows.length === 1 ? "" : "es"} found.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Uploaded</th>
                <th>Source</th>
                <th>File</th>
                <th>Report period</th>
                <th>Rows</th>
                <th>Imported</th>
                <th>Skipped</th>
                <th>Status</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.map((row) => (
                <tr key={row.id}>
                  <td>{displayDate(row.created_at)}</td>
                  <td>{sourceNames[row.source_type] ?? row.source_type}</td>
                  <td>{row.file_name}</td>
                  <td>{displayRange(row.report_from, row.report_to)}</td>
                  <td>{row.row_count}</td>
                  <td>{row.imported_row_count}</td>
                  <td>{row.skipped_row_count}</td>
                  <td><StatusPill status={row.status} /></td>
                  <td>{row.message ?? "-"}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={9} className="empty-cell">No report imports found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
