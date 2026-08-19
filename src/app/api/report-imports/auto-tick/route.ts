export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { getAuthorization, hasPermission } from "@/lib/authorization";
import { isReportAutoWorkerConfigured, reportAutoPost } from "@/lib/report-auto-worker";

/**
 * Advance Delivered data by one station. Frontend calls this in a loop so
 * Auto upload can fill every station without picking one.
 */
export async function POST(request: Request) {
  const authorization = await getAuthorization();
  if (!authorization) return Response.json({ error: "Login required." }, { status: 401 });
  if (!hasPermission(authorization, "imports", "add") && !hasPermission(authorization, "imports", "edit")) {
    return Response.json({ error: "Report import permission denied." }, { status: 403 });
  }
  if (!isReportAutoWorkerConfigured()) {
    return Response.json({ error: "Auto upload is not configured." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    source_type?: string;
    report_date?: string;
    run_id?: string;
  };
  if (body.source_type !== "delivered_shipment_detail") {
    return Response.json({ error: "Tick is only used for Delivered data." }, { status: 400 });
  }

  try {
    const tick = await reportAutoPost<{
      ok?: boolean;
      done?: boolean;
      stationCode?: string | null;
      run?: {
        id?: string;
        status?: string;
        stationsOk?: number;
        stationsFailed?: number;
        stationsTotal?: number;
        error?: string | null;
      };
    }>("/api/admin/reports/delivered-shipment/tick", {
      reportDate: body.report_date,
      runId: body.run_id
    });

    const run = tick.run;
    return Response.json({
      ok: true,
      sourceType: "delivered_shipment_detail",
      runId: run?.id || body.run_id,
      reportDate: body.report_date,
      done: Boolean(tick.done),
      lastStationCode: tick.stationCode ?? null,
      stationsOk: run?.stationsOk,
      stationsFailed: run?.stationsFailed,
      stationsTotal: run?.stationsTotal,
      status: run?.status,
      error: run?.error || undefined
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number }).status || 502;
    return Response.json({
      ok: false,
      sourceType: "delivered_shipment_detail",
      runId: body.run_id,
      reportDate: body.report_date,
      error: message,
    }, { status });
  }
}
