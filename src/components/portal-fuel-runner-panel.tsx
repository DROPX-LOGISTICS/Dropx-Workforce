"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { runFuelPortalInPopup, type FuelPortalSource } from "@/lib/portal-client/fuel-browser";

type RunnerStep = {
  label: string;
  detail?: string;
  status: "done" | "active" | "pending" | "error";
};

type RunnerProgress = {
  portal: FuelPortalSource;
  reportDate: string;
  steps: RunnerStep[];
};

function indiaDate(days = 0) {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

const portalLabels: Record<FuelPortalSource, string> = {
  iocl_fuel: "IOCL Fuel",
  bpcl_fuel: "BPCL Fuel"
};

export function PortalFuelRunnerPanel() {
  const router = useRouter();
  const [reportDate, setReportDate] = useState(indiaDate(-1));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<RunnerProgress | null>(null);
  const [isPending, startRun] = useTransition();

  async function importDownload(sourceType: FuelPortalSource, file: File, date: string) {
    setProgress((prev) => prev ? {
      ...prev,
      steps: [
        { label: "Open portal runner", status: "done" },
        { label: "Download report", status: "done", detail: file.name },
        { label: "Import into Master", status: "active" }
      ]
    } : prev);

    const form = new FormData();
    form.set("source_type", sourceType);
    form.set("report_date", date);
    form.set("file", file);
    const response = await fetch("/api/report-imports", { method: "POST", body: form });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(String(payload.error || `Import failed (${response.status}).`));
    }
    return payload;
  }

  function startPortalRun(sourceType: FuelPortalSource) {
    setMessage(null);
    setError(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
      setError("Choose a valid report date.");
      return;
    }
    if (sourceType === "bpcl_fuel") {
      setError("BPCL browser auto-upload is not available yet — use Manual upload on Report Imports.");
      return;
    }

    startRun(async () => {
      setProgress({
        portal: sourceType,
        reportDate,
        steps: [
          { label: "Open portal runner", status: "active", detail: "Small popup in the corner" },
          { label: "Download report", status: "pending" },
          { label: "Import into Master", status: "pending" }
        ]
      });

      try {
        const browser = await runFuelPortalInPopup({ sourceType, reportDate });
        setProgress((prev) => prev ? {
          ...prev,
          steps: [
            { label: "Open portal runner", status: "done" },
            { label: "Download report", status: "done", detail: browser.fileName },
            { label: "Import into Master", status: "active" }
          ]
        } : prev);

        const imported = await importDownload(sourceType, browser.file, reportDate);
        setProgress(null);
        setMessage(String(imported.message || `${portalLabels[sourceType]} import completed via your browser.`));
        router.refresh();
      } catch (err) {
        setProgress(null);
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="panel-body stacked">
      <p className="subtle">
        Runs IOCL fuel download in a small popup using your browser network (same as the local auto runner).
        The popup closes automatically when the report is downloaded and imported.
      </p>

      <div className="form-grid two-up">
        <label className="field-block">
          <span>Report date</span>
          <input
            aria-label="Report date"
            className="field"
            disabled={isPending}
            onChange={(event) => setReportDate(event.target.value)}
            type="date"
            value={reportDate}
          />
        </label>
      </div>

      <div className="toolbar-actions">
        <button
          className="button"
          disabled={isPending}
          onClick={() => startPortalRun("iocl_fuel")}
          type="button"
        >
          {isPending && progress?.portal === "iocl_fuel" ? "Running IOCL…" : "Run IOCL"}
        </button>
        <button
          className="button secondary"
          disabled
          title="BPCL browser runner is coming soon"
          type="button"
        >
          Run BPCL (soon)
        </button>
        <Link className="button secondary" href="/imports">Back to imports</Link>
      </div>

      {progress ? (
        <section className="panel message-panel">
          <div className="panel-body stacked">
            <strong>{portalLabels[progress.portal]} · {progress.reportDate}</strong>
            <p className="subtle">Keep this tab open. A small popup is working in the corner and will close when done.</p>
            <ul className="auto-step-list">
              {progress.steps.map((step) => (
                <li key={step.label} className={`auto-step ${step.status}`}>
                  <span>{step.label}</span>
                  {step.detail ? <span className="subtle">{step.detail}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {message ? (
        <section className="panel message-panel success">
          <div className="panel-body"><strong>{message}</strong></div>
        </section>
      ) : null}

      {error ? (
        <section className="panel message-panel error">
          <div className="panel-body"><strong>{error}</strong></div>
        </section>
      ) : null}

      <details className="panel import-gap-panel">
        <summary className="panel-head"><strong>Troubleshooting</strong></summary>
        <div className="panel-body stacked subtle">
          <p>Allow popups for this dashboard site if the runner does not open.</p>
          <p>IOCL needs your office/residential network — datacenter IPs are blocked by their WAF.</p>
          <p>If download succeeds but import fails, upload the file manually from <Link href="/imports">Report Imports</Link>.</p>
        </div>
      </details>
    </div>
  );
}
