import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { ReportImportUploader } from "@/components/report-import-uploader";
import { StatusPill } from "@/components/status-pill";
import { getAuthorization } from "@/lib/authorization";
import { ReportImportMaster, reportSchedule } from "@/lib/report-import-master";
import { loadCodLocations, locationModelName, providerName } from "@/lib/ops-pulse/cod";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";

type ImportBatch = {
  id: string;
  source_type: string;
  file_name: string;
  row_count: number;
  imported_row_count: number;
  skipped_row_count: number;
  station_code: string | null;
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

function dueTimePassed(report: ReportImportMaster, date: string, today: string) {
  if (date < today) return true;
  if (date > today) return false;
  if (!report.upload_time) return false;
  const now = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date());
  return now >= report.upload_time.slice(0, 5);
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

function successfulBatchCoversDate(batch: ImportBatch, sourceCode: string, date: string) {
  return batch.source_type === sourceCode
    && batch.status.toLowerCase() !== "failed"
    && batchMatchesDate(batch, date);
}

async function loadImportMaster(companyId: string | null) {
  if (!companyId || !supabaseAdmin) return { rows: [] as ReportImportMaster[], error: null as string | null };
  const { data, error } = await supabaseAdmin
    .from("report_import_master")
    .select("id, source_code, name, description, file_types, day_offset, upload_time, frequency, weekday, parser_type, dedupe_fields, is_active, requires_station, station_scope, requires_report_date, report_date_label, date_default_offset")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("name");
  if (error) return { rows: [] as ReportImportMaster[], error: error.message };
  return {
    rows: ((data ?? []) as ReportImportMaster[]).filter((report) => Array.isArray(report.file_types) && report.file_types.length > 0),
    error: null
  };
}

async function loadBatches(companyId: string | null) {
  if (!companyId || !supabaseAdmin) return { rows: [] as ImportBatch[], error: null as string | null };
  const { data, error } = await supabaseAdmin
    .from("report_import_batches")
    .select("id, source_type, station_code, file_name, row_count, imported_row_count, skipped_row_count, status, message, report_from, report_to, created_at")
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
  const [{ rows: reports, error: masterError }, { rows: batches, error: batchError }, locationResult] = await Promise.all([
    loadImportMaster(companyId),
    loadBatches(companyId),
    authorization && companyId
      ? loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess)
      : Promise.resolve({ locations: [], error: null })
  ]);
  const stationIds = locationResult.locations.map((location) => location.id);
  const parentRows = companyId && supabaseAdmin && stationIds.length
    ? await supabaseAdmin.from("stations").select("id, parent_station_id").eq("company_id", companyId).in("id", stationIds)
    : { data: [] as Array<{ id: string; parent_station_id: string | null }> };
  const parentById = new Map((parentRows.data ?? []).map((row) => [row.id, row.parent_station_id]));
  const codeById = new Map(locationResult.locations.map((location) => [location.id, location.station_code]));
  const childCodesByParent = new Map<string, string[]>();
  parentById.forEach((parentId, childId) => {
    if (!parentId) return;
    const childCode = codeById.get(childId);
    if (childCode) childCodesByParent.set(parentId, [...(childCodesByParent.get(parentId) ?? []), childCode]);
  });
  const shipmentStations = locationResult.locations.map((location) => ({
    id: location.id,
    code: location.station_code,
    name: location.station_name || location.city || location.station_code,
    model: locationModelName(location),
    provider: providerName(location),
    parentStationId: parentById.get(location.id) ?? null,
    childCodes: (childCodesByParent.get(location.id) ?? []).sort()
  }));
  const dueReports = reports.filter((report) => reportIsDue(report, date));
  const reportBySource = new Map(reports.map((report) => [report.source_code, report]));
  const latestBySource = new Map<string, ImportBatch>();
  dueReports.forEach((report) => {
    const reportDate = addDays(date, report.day_offset);
    const batch = batches.find((candidate) =>
      candidate.source_type === report.source_code && batchMatchesDate(candidate, reportDate));
    if (batch) latestBySource.set(report.source_code, batch);
  });
  const today = todayInIndia();
  const coverageGaps = reports.flatMap((report) => {
    if (report.frequency === "adhoc" || report.frequency === "monthly") return [];
    const expectedPeriods: { dueDate: string; reportDate: string }[] = [];
    if (report.frequency === "daily") {
      for (let daysBack = 14; daysBack >= 0; daysBack -= 1) {
        const dueDate = addDays(today, -daysBack);
        if (dueTimePassed(report, dueDate, today)) {
          expectedPeriods.push({ dueDate, reportDate: addDays(dueDate, report.day_offset) });
        }
      }
    } else if (report.weekday !== null) {
      let dueDate = previousWeekday(addDays(today, 1), report.weekday);
      for (let week = 0; week < 6; week += 1) {
        if (dueTimePassed(report, dueDate, today)) {
          expectedPeriods.push({ dueDate, reportDate: addDays(dueDate, report.day_offset) });
        }
        dueDate = addDays(dueDate, -7);
      }
    }
    const missing = expectedPeriods.filter(({ reportDate }) =>
      !batches.some((batch) => successfulBatchCoversDate(batch, report.source_code, reportDate)));
    return missing.length ? [{ report, missing }] : [];
  });
  const recentBatches = batches.slice(0, 10);
  const shipmentCoverageDates = Array.from({ length: 7 }, (_, index) => addDays(today, -index));
  const shipmentCoverage = shipmentCoverageDates.map((coverageDate) => {
    const findBatch = (sourceType: string) => batches.find((batch) => successfulBatchCoversDate(batch, sourceType, coverageDate));
    return {
      date: coverageDate,
      delivered: findBatch("delivered_shipment_detail"),
      inbound: findBatch("inbound_shipment_detail")
    };
  });

  return (
    <AppShell active={active} pageCode={pageCode}>
      <PageHead
        eyebrow="Report Imports"
        title="Daily upload status"
        subtitle="Upload a report and track completion for the selected date."
        action={<span className={`status-pill ${isSupabaseAdminConfigured ? "good" : "warn"}`}>{isSupabaseAdminConfigured ? "Connected" : "Database unavailable"}</span>}
      />

      {masterError || batchError || locationResult.error ? (
        <section className="panel message-panel error"><div className="panel-body"><strong>{masterError ?? batchError ?? locationResult.error}</strong></div></section>
      ) : null}

      <section className="panel">
        <div className="panel-head compact-import-head">
          <div><h2>Upload report</h2></div>
          <Link className="button secondary compact" href="/master/imports">Manage reports</Link>
        </div>
        <ReportImportUploader reports={reports} stations={shipmentStations} compact />
      </section>

      <section className="panel">
        <div className="panel-head">
          <div><h2>Shipment coverage</h2><p className="subtle">Latest seven days. Re-uploading refreshes existing Tracking IDs without double-counting.</p></div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Delivered</th><th>Inbound</th></tr></thead>
            <tbody>
              {shipmentCoverage.map((row) => (
                <tr key={`shipment-coverage-${row.date}`}>
                  <td><strong>{displayDate(row.date)}</strong></td>
                  <td>{row.delivered ? <><StatusPill status="Uploaded" /> <span className="subtle">{row.delivered.station_code || "Detected"} · {row.delivered.file_name}</span></> : <StatusPill status="Missing" />}</td>
                  <td>{row.inbound ? <><StatusPill status="Uploaded" /> <span className="subtle">{row.inbound.station_code || "Detected"} · {row.inbound.file_name}</span></> : <StatusPill status="Missing" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {coverageGaps.length ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Coverage gaps</h2>
              <p className="subtle">Missing daily dates from the last 14 days and weekly due dates from the last 6 weeks.</p>
            </div>
            <StatusPill status={`${coverageGaps.length} reports need attention`} />
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Report</th><th>Frequency</th><th>Missing periods</th><th>Action</th></tr></thead>
              <tbody>
                {coverageGaps.map(({ report, missing }) => (
                  <tr key={`coverage-${report.id}`}>
                    <td><strong>{report.name}</strong></td>
                    <td>{report.frequency}</td>
                    <td>{missing.slice(-8).map(({ reportDate }) => displayDate(reportDate)).join(", ")}{missing.length > 8 ? ` · +${missing.length - 8} earlier` : ""}</td>
                    <td><Link className="button secondary compact" href={`/imports?date=${missing[missing.length - 1].dueDate}`}>Review</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="panel message-panel success">
          <div className="panel-body"><strong>Report coverage is complete for the monitored daily and weekly periods.</strong></div>
        </section>
      )}

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
            <p className="subtle">Latest upload activity.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Uploaded</th><th>Report</th><th>Report period</th><th>Result</th><th>Rows</th><th>File</th></tr></thead>
            <tbody>
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
              {!recentBatches.length ? <tr><td className="empty-cell" colSpan={6}>No upload activity yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
