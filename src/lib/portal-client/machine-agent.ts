import type { FuelPortalSource } from "./fuel-browser";

export type MachineAgentProgress = {
  phase: "queue" | "wait" | "import" | "done" | "error";
  detail: string;
  jobStatus?: string;
};

/**
 * Company-standard path: website queues a job; office gateway PC downloads;
 * dashboard imports into Master. Staff never install software.
 */
export async function runFuelViaMachineAgent(args: {
  sourceType: FuelPortalSource;
  reportDate: string;
  onProgress?: (p: MachineAgentProgress) => void;
  /** Max wait for agent (~8 min). */
  maxTicks?: number;
}): Promise<
  | { ok: true; message: string; imported?: number; skipped?: number; totalRows?: number }
  | { ok: false; error: string }
> {
  const { sourceType, reportDate, onProgress, maxTicks = 96 } = args;
  onProgress?.({ phase: "queue", detail: "Queueing job…" });

  const enqueueRes = await fetch("/api/report-imports/auto-run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_type: sourceType, report_date: reportDate })
  });
  const enqueue = (await enqueueRes.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    jobId?: string;
    queued?: boolean;
    message?: string;
  };
  if (!enqueueRes.ok || !enqueue.jobId) {
    return {
      ok: false,
      error:
        enqueue.error ||
        `Failed to queue job (${enqueueRes.status}). Is the report worker configured?`
    };
  }

  const jobId = enqueue.jobId;
  onProgress?.({
    phase: "wait",
    detail: "Waiting for the office gateway PC to download the report…",
    jobStatus: "queued"
  });

  let ticks = 0;
  let completed = false;
  while (ticks < maxTicks) {
    ticks += 1;
    await new Promise((r) => setTimeout(r, 5000));
    const stRes = await fetch(`/api/report-imports/portal-job?id=${encodeURIComponent(jobId)}`);
    const st = (await stRes.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      job?: { status?: string; error?: string | null };
    };
    if (!stRes.ok || !st.job) {
      onProgress?.({
        phase: "wait",
        detail: st.error || "Waiting for job status…",
        jobStatus: "unknown"
      });
      continue;
    }
    const status = String(st.job.status || "");
    onProgress?.({
      phase: "wait",
      detail:
        status === "running"
          ? "Office gateway is downloading…"
          : status === "queued"
            ? "Queued — IT should confirm the office gateway agent is online."
            : `Job status: ${status}`,
      jobStatus: status
    });
    if (status === "failed") {
      return {
        ok: false,
        error: String(
          st.job.error ||
            "Office gateway download failed. Ask IT to check the gateway PC (see Fuel auto-upload setup)."
        )
      };
    }
    if (status === "completed") {
      completed = true;
      break;
    }
  }

  if (!completed) {
    return {
      ok: false,
      error:
        "Timed out waiting for the office gateway. Ask IT to confirm Install-Agent.bat was run and the PC is online."
    };
  }

  onProgress?.({ phase: "import", detail: "Importing into Import Master…" });
  const impRes = await fetch("/api/report-imports/portal-job-import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: jobId })
  });
  const imp = (await impRes.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    message?: string;
    imported?: number;
    skipped?: number;
    totalRows?: number;
  };
  if (!impRes.ok) {
    return { ok: false, error: imp.error || `Import failed (${impRes.status})` };
  }
  onProgress?.({ phase: "done", detail: imp.message || "Done" });
  return {
    ok: true,
    message: imp.message || `${sourceType} imported.`,
    imported: imp.imported,
    skipped: imp.skipped,
    totalRows: imp.totalRows
  };
}
