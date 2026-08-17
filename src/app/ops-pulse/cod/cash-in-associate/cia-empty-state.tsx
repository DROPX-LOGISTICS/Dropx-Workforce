"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { postCiaJson } from "./cia-fetch";

/**
 * Shown instead of the network table when there is nothing to render.
 * The three reasons need different actions, so they are never collapsed into
 * one generic "unavailable" message.
 */
export function CiaEmptyState({ code, message }: { code: string | null; message: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [pending, startTransition] = useTransition();

  const schemaMissing = code === "CIA_SCHEMA_MISSING";
  const noSnapshot = code === "NO_CIA_SNAPSHOT";
  const notConfigured = code === "WORKER_NOT_CONFIGURED";

  async function startSnapshot() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await postCiaJson("/api/ops-pulse/cod/cash-recon/cash-in-associate/refresh");
      setStarted(true);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the snapshot run.");
    } finally {
      setBusy(false);
    }
  }

  const title = schemaMissing
    ? "Cash In Associate database is not set up"
    : notConfigured
      ? "Cash recon worker is not configured"
      : noSnapshot
        ? "No snapshot has been taken yet"
        : "Unable to load Cash In Associate";

  return (
    <section className={`panel message-panel ${noSnapshot ? "info" : "error"}`}>
      <div className="panel-body">
        <strong>{title}</strong>
        <p className="subtle" style={{ marginTop: 6 }}>{message}</p>

        {schemaMissing ? (
          <ol className="subtle cia-empty-steps">
            <li>Open the Supabase SQL editor for the company project.</li>
            <li>
              Paste and run <code>sql/company-cutover.sql</code>. It only creates missing
              tables — it never drops or overwrites existing company data.
            </li>
            <li>
              Confirm with <code>GET /api/admin/diag/db</code> on the worker, then reload
              this page and start a snapshot.
            </li>
          </ol>
        ) : null}

        {noSnapshot ? (
          <>
            <p className="subtle" style={{ marginTop: 6 }}>
              The 06:00 IST cron fills this automatically. You can also start a run now —
              stations are processed one at a time while this page stays open.
            </p>
            <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                className="button"
                onClick={startSnapshot}
                disabled={busy || pending || started}
              >
                {busy || pending ? <Loader2 size={16} className="cia-spin" /> : <RefreshCw size={16} />}
                {started ? "Snapshot started" : busy ? "Starting…" : "Start snapshot now"}
              </button>
              {started ? (
                <span className="subtle">Reload in a few minutes to see the first stations.</span>
              ) : null}
            </div>
            {error ? (
              <p className="subtle" style={{ marginTop: 8, color: "var(--danger, #b42318)" }}>{error}</p>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
