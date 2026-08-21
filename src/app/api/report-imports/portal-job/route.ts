export const dynamic = "force-dynamic";

import { getAuthorization, hasPermission } from "@/lib/authorization";
import { isReportAutoWorkerConfigured, reportAutoGet } from "@/lib/report-auto-worker";

/** GET /api/report-imports/portal-job?id=… — status of a machine-agent fuel job */
export async function GET(request: Request) {
  const authorization = await getAuthorization();
  if (!authorization) return Response.json({ error: "Login required." }, { status: 401 });
  if (!hasPermission(authorization, "imports", "add") && !hasPermission(authorization, "imports", "edit")) {
    return Response.json({ error: "Report import permission denied." }, { status: 403 });
  }
  if (!isReportAutoWorkerConfigured()) {
    return Response.json({ error: "Report auto worker is not configured." }, { status: 503 });
  }

  const id = new URL(request.url).searchParams.get("id")?.trim() || "";
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  const payload = await reportAutoGet<{ ok?: boolean; job?: Record<string, unknown>; error?: string }>(
    "/api/admin/reports/portal-jobs",
    { id }
  );
  if (!payload.job) {
    return Response.json({ ok: false, error: payload.error || "job not found" }, { status: 404 });
  }
  return Response.json({ ok: true, job: payload.job });
}
