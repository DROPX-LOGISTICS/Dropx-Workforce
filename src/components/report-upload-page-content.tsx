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

type ShipmentFactRow = {
  client: string | null;
  provider_employee_id: string | null;
  provider_employee_name: string | null;
  shipment_type: string | null;
  station_code: string | null;
  total_activity: number | null;
  total_delivery: number | null;
  updated_at: string | null;
  work_date: string | null;
};

const sourceNames: Record<string, string> = {
  amazon_shipments: "Amazon shipment",
  bpcl_fuel: "BPCL fuel",
  cashbook: "Cashbook",
  iocl_fuel: "IOC fuel"
};

const numberFormatter = new Intl.NumberFormat("en-IN");

function displayCount(value: number) {
  return numberFormatter.format(Math.round(value));
}

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

function displaySourceDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00+05:30`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
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

async function loadShipmentFacts(companyId: string | null) {
  if (!companyId || !supabaseAdmin) return { rows: [] as ShipmentFactRow[], error: null as string | null };
  const { data, error } = await supabaseAdmin
    .from("cps_shipment_daily")
    .select("client, station_code, provider_employee_id, provider_employee_name, shipment_type, work_date, total_delivery, total_activity, updated_at")
    .eq("company_id", companyId)
    .order("work_date", { ascending: false })
    .limit(5000);
  if (error) return { rows: [] as ShipmentFactRow[], error: error.message };
  return { rows: (data ?? []) as ShipmentFactRow[], error: null };
}

function latestText(values: Array<string | null>) {
  return values.filter(Boolean).sort().at(-1) ?? null;
}

function earliestText(values: Array<string | null>) {
  return values.filter(Boolean).sort()[0] ?? null;
}

function summarizeShipments(rows: ShipmentFactRow[]) {
  const stationMap = new Map<string, {
    activity: number;
    dates: Set<string>;
    delivery: number;
    providerIds: Set<string>;
    stationCode: string;
    updatedAt: string | null;
  }>();
  const typeMap = new Map<string, { activity: number; delivery: number; rows: number }>();

  rows.forEach((row) => {
    const stationCode = row.station_code ?? "-";
    const providerId = row.provider_employee_id ?? "";
    const delivery = Number(row.total_delivery ?? 0);
    const activity = Number(row.total_activity ?? 0);
    const station = stationMap.get(stationCode) ?? {
      activity: 0,
      dates: new Set<string>(),
      delivery: 0,
      providerIds: new Set<string>(),
      stationCode,
      updatedAt: null
    };
    station.delivery += delivery;
    station.activity += activity;
    if (row.work_date) station.dates.add(row.work_date);
    if (providerId) station.providerIds.add(providerId);
    if (row.updated_at && (!station.updatedAt || row.updated_at > station.updatedAt)) station.updatedAt = row.updated_at;
    stationMap.set(stationCode, station);

    const typeName = row.shipment_type || "Unspecified";
    const currentType = typeMap.get(typeName) ?? { activity: 0, delivery: 0, rows: 0 };
    currentType.delivery += delivery;
    currentType.activity += activity;
    currentType.rows += 1;
    typeMap.set(typeName, currentType);
  });

  return {
    daCount: new Set(rows.map((row) => row.provider_employee_id).filter(Boolean)).size,
    fromDate: earliestText(rows.map((row) => row.work_date)),
    latestDate: latestText(rows.map((row) => row.work_date)),
    latestRefresh: latestText(rows.map((row) => row.updated_at)),
    stationCount: stationMap.size,
    stationRows: Array.from(stationMap.values())
      .map((station) => {
        const dates = Array.from(station.dates).sort();
        return {
          ...station,
          dateCount: dates.length,
          fromDate: dates[0] ?? null,
          toDate: dates.at(-1) ?? null
        };
      })
      .sort((a, b) => (b.toDate ?? "").localeCompare(a.toDate ?? "") || a.stationCode.localeCompare(b.stationCode))
      .slice(0, 12),
    totalActivity: rows.reduce((sum, row) => sum + Number(row.total_activity ?? 0), 0),
    totalDelivery: rows.reduce((sum, row) => sum + Number(row.total_delivery ?? 0), 0),
    typeRows: Array.from(typeMap.entries())
      .map(([shipmentType, values]) => ({ shipmentType, ...values }))
      .sort((a, b) => b.activity - a.activity),
    visibleDaRows: rows
      .slice()
      .sort((a, b) => (b.work_date ?? "").localeCompare(a.work_date ?? "") || (a.station_code ?? "").localeCompare(b.station_code ?? ""))
      .slice(0, 20)
  };
}

export async function ReportUploadPageContent({
  active = "Report Upload",
  pageCode = "report_upload"
}: {
  active?: string;
  pageCode?: string;
}) {
  const authorization = await getAuthorization();
  const companyId = authorization?.companyId ?? null;
  const { rows, error } = await loadRecentImports(companyId);
  const { rows: shipmentRows, error: shipmentError } = await loadShipmentFacts(companyId);
  const shipmentSummary = summarizeShipments(shipmentRows);

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
        <div className="panel-head toolbar">
          <div>
            <h2>Shipment source ledger</h2>
            <p className="subtle">Amazon shipment facts available for CPS, payroll, station reviews, cluster summaries, and DA-level checks.</p>
          </div>
          <div className="toolbar-actions">
            <a className="button secondary compact" href="/api/report-imports/source-ledger?level=station">Station CSV</a>
            <a className="button secondary compact" href="/api/report-imports/source-ledger?level=shipment_type">Type CSV</a>
            <a className="button secondary compact" href="/api/report-imports/source-ledger?level=da">DA CSV</a>
            {shipmentSummary.latestRefresh ? <StatusPill status={`Refreshed ${displayDate(shipmentSummary.latestRefresh)}`} /> : null}
          </div>
        </div>
        {shipmentError ? (
          <div className="panel-body">
            <div className="inline-error">{shipmentError}</div>
          </div>
        ) : (
          <>
            <div className="summary-grid" style={{ padding: "0 14px" }}>
              <div className="metric-card"><span>Updated till</span><strong>{displaySourceDate(shipmentSummary.latestDate)}</strong><small>Latest shipment date imported</small></div>
              <div className="metric-card"><span>Stations</span><strong>{displayCount(shipmentSummary.stationCount)}</strong><small>{displaySourceDate(shipmentSummary.fromDate)} to {displaySourceDate(shipmentSummary.latestDate)}</small></div>
              <div className="metric-card"><span>DA / provider IDs</span><strong>{displayCount(shipmentSummary.daCount)}</strong><small>Unique IDs in shipment facts</small></div>
              <div className="metric-card"><span>Total deliveries</span><strong>{displayCount(shipmentSummary.totalDelivery)}</strong><small>{displayCount(shipmentSummary.totalActivity)} total activity count</small></div>
            </div>

            <div className="grid two" style={{ padding: "0 14px 14px" }}>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Station</th><th>Period</th><th>Days</th><th>DAs</th><th>Delivery</th><th>Activity</th><th>Last refresh</th></tr>
                  </thead>
                  <tbody>
                    {shipmentSummary.stationRows.length ? shipmentSummary.stationRows.map((row) => (
                      <tr key={row.stationCode}>
                        <td>{row.stationCode}</td>
                        <td>{displayRange(row.fromDate, row.toDate)}</td>
                        <td>{displayCount(row.dateCount)}</td>
                        <td>{displayCount(row.providerIds.size)}</td>
                        <td>{displayCount(row.delivery)}</td>
                        <td>{displayCount(row.activity)}</td>
                        <td>{displayDate(row.updatedAt)}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={7} className="empty-cell">No Amazon shipment facts imported yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Shipment type</th><th>Rows</th><th>Delivery</th><th>Activity</th></tr>
                  </thead>
                  <tbody>
                    {shipmentSummary.typeRows.length ? shipmentSummary.typeRows.map((row) => (
                      <tr key={row.shipmentType}>
                        <td>{row.shipmentType}</td>
                        <td>{displayCount(row.rows)}</td>
                        <td>{displayCount(row.delivery)}</td>
                        <td>{displayCount(row.activity)}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={4} className="empty-cell">No shipment type summary available.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="table-wrap" style={{ padding: "0 14px 14px" }}>
              <table>
                <thead>
                  <tr><th>Date</th><th>Station</th><th>Provider ID</th><th>Name</th><th>Type</th><th>Delivery</th><th>Activity</th></tr>
                </thead>
                <tbody>
                  {shipmentSummary.visibleDaRows.length ? shipmentSummary.visibleDaRows.map((row, index) => (
                    <tr key={`${row.work_date}-${row.station_code}-${row.provider_employee_id}-${index}`}>
                      <td>{displaySourceDate(row.work_date)}</td>
                      <td>{row.station_code ?? "-"}</td>
                      <td>{row.provider_employee_id ?? "-"}</td>
                      <td>{row.provider_employee_name ?? "-"}</td>
                      <td>{row.shipment_type ?? "-"}</td>
                      <td>{displayCount(Number(row.total_delivery ?? 0))}</td>
                      <td>{displayCount(Number(row.total_activity ?? 0))}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={7} className="empty-cell">No DA-level shipment rows available.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
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
