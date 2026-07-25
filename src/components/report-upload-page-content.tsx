import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { ReportImportUploader } from "@/components/report-import-uploader";
import { StatusPill } from "@/components/status-pill";
import { getAuthorization } from "@/lib/authorization";
import { ReportImportMaster, reportSchedule } from "@/lib/report-import-master";
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

function todayInIndia() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function validDate(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayInIndia();
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${value}T00:00:00Z`));
}

function displayDateTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata"
  }).format(new Date(value));
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function previousWeekday(value: string, weekday: number) {
  const date = new Date(`${value}T00:00:00Z`);
  const daysBack = (date.getUTCDay() - weekday + 7) % 7 || 7;
  return addDays(value, -daysBack);
}

function reportIsDue(report: ReportImportMaster, date: string) {
  if (report.frequency === "weekly" && report.weekday !== null) {
    return new Date(`${date}T00:00:00Z`).getUTCDay() === report.weekday;
  }
  return report.frequency !== "adhoc";
}

function createdDateInIndia(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function batchMatchesDate(batch: ImportBatch, date: string) {
  if (batch.report_from && batch.report_to) return batch.report_from <= date && batch.report_to >= date;
  if (batch.report_from) return batch.report_from === date;
  return createdDateInIndia(batch.created_at) === date;
}

async function loadImportMaster(companyId: string | null) {
  if (!companyId || !supabaseAdmin) return { rows: [] as ReportImportMaster[], error: null as string | null };
  const { data, error } = await supabaseAdmin
    .from("report_import_master")
    .select("id, source_code, name, description, file_types, day_offset, upload_time, frequency, weekday, parser_type, dedupe_fields, is_active")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("name");
  if (error) return { rows: [] as ReportImportMaster[], error: error.message };
  return { rows: (data ?? []) as ReportImportMaster[], error: null };
}

async function loadBatches(companyId: string | null) {
  if (!companyId || !supabaseAdmin) return { rows: [] as ImportBatch[], error: null as string | null };
  const { data, error } = await supabaseAdmin
    .from("report_import_batches")
    .select("id, source_type, file_name, row_count, imported_row_count, skipped_row_count, status, message, report_from, report_to, created_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return { rows: [] as ImportBatch[], error: error.message };
  return { rows: (data ?? []) as ImportBatch[], error: null };
}

export async function ReportUploadPageContent({
  active = "Report Imports",
  pageCode = "imports",
  selectedDate
}: {
  active?: string;
  pageCode?: string;
  selectedDate?: string;
}) {
  const authorization = await getAuthorization();
  const companyId = authorization?.companyId ?? null;
  const date = validDate(selectedDate);
  const { rows: reports, error: masterError } = await loadImportMaster(companyId);
  const { rows: batches, error: batchError } = await loadBatches(companyId);
  const dueReports = reports.filter((report) => reportIsDue(report, date));
  const reportBySource = new Map(reports.map((report) => [report.source_code, report]));
  const latestBySource = new Map<string, ImportBatch>();
  batches.filter((batch) => batchMatchesDate(batch, date)).forEach((batch) => {
    if (!latestBySource.has(batch.source_type)) latestBySource.set(batch.source_type, batch);
  });
  const today = todayInIndia();
  const missedWeekly = reports.flatMap((report) => {
    if (report.frequency !== "weekly" || report.weekday === null) return [];
    const dueDate = previousWeekday(today, report.weekday);
    const nextDueDate = addDays(dueDate, 7);
    const uploaded = batches.some((batch) => batch.source_type === report.source_code
      && createdDateInIndia(batch.created_at) >= dueDate
      && createdDateInIndia(batch.created_at) < nextDueDate
      && batch.status.toLowerCase() !== "failed");
    return uploaded ? [] : [{ report, dueDate }];
  });
  const recentBatches = batches.slice(0, 10);

  return (
    <AppShell active={active} pageCode={pageCode}>
      <PageHead
        eyebrow="Report Imports"
        title="Daily upload status"
        subtitle="Upload a report and track completion for the selected date."
        action={<span className={`status-pill ${isSupabaseAdminConfigured ? "good" : "warn"}`}>{isSupabaseAdminConfigured ? "Connected" : "Database unavailable"}</span>}
      />

      {masterError || batchError ? (
        <section className="panel message-panel error"><div className="panel-body"><strong>{masterError ?? batchError}</strong></div></section>
      ) : null}

      <section className="panel">
        <div className="panel-head compact-import-head">
          <div><h2>Upload report</h2></div>
          <Link className="button secondary compact" href="/master/imports">Manage reports</Link>
        </div>
        <ReportImportUploader reports={reports} compact />
      </section>

      <section className="panel">
        <div className="panel-head toolbar">
          <div>
            <h2>{displayDate(date)}</h2>
            <p className="subtle">Expected reports and latest upload result.</p>
          </div>
          <form className="toolbar-actions" method="get">
            <input aria-label="Status date" className="field compact-date" defaultValue={date} name="date" type="date" />
            <button className="button secondary compact" type="submit">View</button>
            <Link className="button secondary compact" href="/imports">Today</Link>
          </form>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Report</th><th>Upload time</th><th>Frequency</th><th>Report day</th><th>Status</th><th>File</th><th>Rows</th></tr>
            </thead>
            <tbody>
              {dueReports.map((report) => {
                const batch = latestBySource.get(report.source_code);
                const schedule = reportSchedule(report).split(" · ");
                const status = batch?.status ?? "Pending";
                return (
                  <tr key={report.id}>
                    <td><strong>{report.name}</strong></td>
                    <td>{schedule[1]}</td>
                    <td>{report.frequency === "weekly" && report.weekday !== null ? schedule[2] : report.frequency}</td>
                    <td>{schedule[0]}</td>
                    <td><StatusPill status={status} /></td>
                    <td>{batch?.file_name ?? "-"}</td>
                    <td>{batch ? `${batch.imported_row_count} imported · ${batch.skipped_row_count} skipped` : "-"}</td>
                  </tr>
                );
              })}
              {!dueReports.length ? <tr><td className="empty-cell" colSpan={7}>No reports due on this date.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Upload log</h2>
            <p className="subtle">Latest activity and missed weekly uploads.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Uploaded</th><th>Report</th><th>Report period</th><th>Result</th><th>Rows</th><th>File</th></tr></thead>
            <tbody>
              {missedWeekly.map(({ report, dueDate }) => (
                <tr key={`missed-${report.id}-${dueDate}`}>
                  <td>-</td>
                  <td><strong>{report.name}</strong></td>
                  <td>{displayDate(dueDate)}</td>
                  <td><StatusPill status="Missed" /></td>
                  <td>-</td>
                  <td>-</td>
                </tr>
              ))}
              {recentBatches.map((batch) => {
                const report = reportBySource.get(batch.source_type);
                const period = batch.report_from
                  ? batch.report_to && batch.report_to !== batch.report_from
                    ? `${displayDate(batch.report_from)} – ${displayDate(batch.report_to)}`
                    : displayDate(batch.report_from)
                  : "-";
                return (
                  <tr key={batch.id}>
                    <td>{displayDateTime(batch.created_at)}</td>
                    <td><strong>{report?.name ?? batch.source_type}</strong></td>
                    <td>{period}</td>
                    <td><StatusPill status={batch.status} /></td>
                    <td>{batch.status.toLowerCase() === "failed" ? "-" : `${batch.imported_row_count} imported · ${batch.skipped_row_count} skipped`}</td>
                    <td>{batch.file_name}</td>
                  </tr>
                );
              })}
              {!missedWeekly.length && !recentBatches.length ? <tr><td className="empty-cell" colSpan={6}>No upload activity yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
