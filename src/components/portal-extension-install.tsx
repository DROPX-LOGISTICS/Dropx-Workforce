"use client";

import Link from "next/link";

/**
 * Company-standard ops note: staff use the website only.
 * IT installs the office gateway agent once (double-click installer).
 */
export function PortalExtensionInstall() {
  return (
    <section className="panel">
      <div className="panel-body stacked">
        <p>
          <strong>Staff:</strong> use <Link href="/imports">Report imports</Link> →{" "}
          <strong>Auto upload</strong> (or Portal runner → Run IOCL). Nothing to install on your
          laptop.
        </p>
        <p className="subtle">
          Fuel portals (IOCL/BPCL) only accept office/residential network access. The company runs
          one always-on <strong>office gateway PC</strong> that opens Chrome there when someone
          clicks Auto — same pattern as a print server or sync gateway.
        </p>

        <div className="panel" style={{ marginTop: 8 }}>
          <div className="panel-head">
            <strong>IT — office gateway PC (once)</strong>
          </div>
          <div className="panel-body stacked subtle">
            <ol style={{ paddingLeft: "1.25rem", lineHeight: 1.65, margin: 0 }}>
              <li>On the designated office PC (Indian ISP), open the <code>Report-auto-worker\portal-runner-python</code> folder.</li>
              <li>Double‑click <code>Install-Agent.bat</code> (no Command Prompt typing).</li>
              <li>Leave that PC powered on. The agent starts with Windows.</li>
            </ol>
            <p style={{ marginBottom: 0 }}>
              Credentials stay in <code>Report-auto-worker\.dev.vars</code> on that PC. Staff never
              see PowerShell, extensions, or developer mode.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
