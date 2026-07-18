import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { StatusPill } from "@/components/status-pill";

const importSteps = [
  "Upload provider file",
  "Validate columns and date",
  "Store raw immutable rows",
  "Aggregate daily DA metrics",
  "Resolve Provider ID mapping",
  "Apply effective rate card",
  "Create earnings or exception"
];

export function ReportUploadPageContent({
  active = "Report Upload",
  pageCode = "report_upload"
}: {
  active?: string;
  pageCode?: string;
}) {
  return (
    <AppShell active={active} pageCode={pageCode}>
      <PageHead
        eyebrow="Daily source file"
        title="Provider report imports"
        subtitle="Amazon daily reports use holder_employee_id. Flipkart and Meesho use the same internal concept: Provider ID."
        action={<button className="button">Upload report</button>}
      />

      <section className="grid two">
        <div className="panel">
          <div className="panel-head">
            <h2>Upload daily report</h2>
          </div>
          <div className="panel-body">
            <div className="dropzone">
              <div>
                <h2>Drop `.xlsx` or `.csv` here</h2>
                <p className="subtle" style={{ marginTop: 8 }}>
                  The file is not trusted blindly. It is stored raw first, then transformed into daily metrics and exceptions.
                </p>
                <button className="button" style={{ marginTop: 16 }}>Choose file</button>
              </div>
            </div>
          </div>
        </div>

        <aside className="panel">
          <div className="panel-head"><h2>Import pipeline</h2></div>
          <div className="panel-body stacked">
            {importSteps.map((step, index) => (
              <div className="queue-card" key={step}>
                <span className="process-step">{index + 1}</span>
                <strong>{step}</strong>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Provider format contract</h2>
            <p className="subtle">Each provider parser maps their file columns into the same internal daily metrics table.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Provider</th><th>External ID column</th><th>Work date</th><th>Station</th><th>Shipment metrics</th><th>Result</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>AMAZON</td>
                <td className="mono">holder_employee_id</td>
                <td>report date / shipment date</td>
                <td>station code</td>
                <td>delivered, returns, MFN, other units</td>
                <td><StatusPill status="Ready" /></td>
              </tr>
              <tr>
                <td>FLIPKART</td>
                <td className="mono">Provider ID</td>
                <td>pending sample mapping</td>
                <td>pending sample mapping</td>
                <td>pending sample mapping</td>
                <td><StatusPill status="Waiting for sample" /></td>
              </tr>
              <tr>
                <td>MEESHO</td>
                <td className="mono">Provider ID</td>
                <td>pending sample mapping</td>
                <td>pending sample mapping</td>
                <td>pending sample mapping</td>
                <td><StatusPill status="Waiting for sample" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Recent imports</h2></div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>Provider</th>
                <th>Report Date</th>
                <th>ID Column</th>
                <th>Rows</th>
                <th>Provider IDs</th>
                <th>Mapped Rows</th>
                <th>Exceptions</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={9} className="empty-cell">No report imports found.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
