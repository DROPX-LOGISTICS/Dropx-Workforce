export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { getAuthorization, hasPermission } from "@/lib/authorization";
import {
  isReportAutoWorkerConfigured,
  reportAutoFetchFile,
  reportAutoGet
} from "@/lib/report-auto-worker";

/**
 * After the PC agent finishes a portal_fuel job, pull the CSV into Import Master
 * using the logged-in dashboard session (shows in Upload log).
 */
export async function POST(request: Request) {
  const authorization = await getAuthorization();
  if (!authorization) return Response.json({ error: "Login required." }, { status: 401 });
  if (!hasPermission(authorization, "imports", "add") && !hasPermission(authorization, "imports", "edit")) {
    return Response.json({ error: "Report import permission denied." }, { status: 403 });
  }
  if (!isReportAutoWorkerConfigured()) {
    return Response.json({ error: "Report auto worker is not configured." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as { id?: string };
  const id = String(body.id || "").trim();
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const payload = await reportAutoGet<{ ok?: boolean; job?: Record<string, unknown>; error?: string }>(
    "/api/admin/reports/portal-jobs",
    { id }
  );
  const job = payload.job;
  if (!job) {
    return Response.json({ error: payload.error || "job not found" }, { status: 404 });
  }
  if (String(job.status) !== "completed") {
    return Response.json({ error: `Job is ${String(job.status)}, not completed` }, { status: 409 });
  }

  const portal = String(job.portal || "iocl").toLowerCase();
  const sourceType = portal === "bpcl" ? "bpcl_fuel" : "iocl_fuel";
  const reportDate = String(job.report_date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    return Response.json({ error: "Job has invalid report_date" }, { status: 422 });
  }

  const file = await reportAutoFetchFile(
    `/api/admin/reports/portal-jobs/download?id=${encodeURIComponent(id)}`
  );
  const form = new FormData();
  form.set("source_type", sourceType);
  form.set("report_date", reportDate);
  form.set("file", new File([file.bytes], file.fileName, { type: file.mime || "text/csv" }));

  const cookie = request.headers.get("cookie");
  const importRes = await fetch(new URL("/api/report-imports", request.url), {
    method: "POST",
    headers: cookie ? { cookie } : undefined,
    body: form,
    cache: "no-store"
  });
  const importPayload = (await importRes.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    imported?: number;
    skipped?: number;
    totalRows?: number;
  };
  if (!importRes.ok) {
    return Response.json(
      { ok: false, error: importPayload.error || importPayload.message || `Import failed (${importRes.status})` },
      { status: importRes.status >= 400 ? importRes.status : 502 }
    );
  }
  return Response.json({
    ok: true,
    sourceType,
    reportDate,
    imported: importPayload.imported,
    skipped: importPayload.skipped,
    totalRows: importPayload.totalRows,
    message: importPayload.message || `${sourceType} imported into Import Master.`
  });
}
