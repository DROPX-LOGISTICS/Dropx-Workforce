"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { type FuelPortalSource } from "@/lib/portal-client/fuel-browser";
import { runFuelViaMachineAgent } from "@/lib/portal-client/machine-agent";

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

  function startPortalRun(sourceType: FuelPortalSource) {
    setMessage(null);
    setError(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
      setError("Choose a valid report date.");
      return;
    }

    startRun(async () => {
      setProgress({
        portal: sourceType,
        reportDate,
        steps: [
          { label: "Queue on company systems", status: "active" },
          { label: "Office gateway download", status: "pending" },
          { label: "Import into Master", status: "pending" }
        ]
      });

      try {
        const result = await runFuelViaMachineAgent({
          sourceType,
          reportDate,
          onProgress: (p) => {
            const waitActive = p.phase === "wait" || p.phase === "queue";
            const importActive = p.phase === "import";
            setProgress({
              portal: sourceType,
              reportDate,
              steps: [
                {
                  label: "Queue on company systems",
                  status: p.phase === "queue" ? "active" : "done",
                  detail: p.phase === "queue" ? p.detail : undefined
                },
                {
                  label: "Office gateway download",
                  status: waitActive ? "active" : p.phase === "error" ? "error" : "done",
                  detail: waitActive || p.phase === "error" ? p.detail : undefined
                },
                {
                  label: "Import into Master",
                  status: importActive ? "active" : p.phase === "done" ? "done" : "pending",
                  detail: importActive || p.phase === "done" ? p.detail : undefined
                }
              ]
            });
          }
        });
        if (!result.ok) throw new Error(result.error);
        setProgress(null);
        setMessage(result.message);
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
        Click Run — the office gateway PC downloads the report and Import Master updates. Staff do
        not install software.{" "}
        <Link href="/imports/portal-extension">How this is set up</Link>
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
          disabled={isPending}
          onClick={() => startPortalRun("bpcl_fuel")}
          type="button"
        >
          {isPending && progress?.portal === "bpcl_fuel" ? "Running BPCL…" : "Run BPCL"}
        </button>
        <Link className="button secondary" href="/imports">Back to imports</Link>
      </div>

      {progress ? (
        <section className="panel message-panel">
          <div className="panel-body stacked">
            <strong>
              {portalLabels[progress.portal]} · {progress.reportDate}
            </strong>
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
          <div className="panel-body">
            <strong>{message}</strong>
          </div>
        </section>
      ) : null}

      {error ? (
        <section className="panel message-panel error">
          <div className="panel-body">
            <strong>{error}</strong>
          </div>
        </section>
      ) : null}
    </div>
  );
}
