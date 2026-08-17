export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { getAuthorization, hasPermission } from "@/lib/authorization";
import {
  isReportAutoSource,
  isReportAutoWorkerConfigured,
  isoWeekFromYmd,
  reportAutoGet,
  reportAutoPost,
  type AutoRunResult,
  type WorkforceReadyResponse
} from "@/lib/report-auto-worker";

function yesterdayIst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
    new Date(Date.now() - 24 * 60 * 60 * 1000)
  );
}

function ymdOrNull(value: unknown): string | undefined {
  const raw = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
}

export async function POST(request: Request) {
  const authorization = await getAuthorization();
  if (!authorization) return Response.json({ error: "Login required." }, { status: 401 });
  if (!hasPermission(authorization, "imports", "add") && !hasPermission(authorization, "imports", "edit")) {
    return Response.json({ error: "Report import permission denied." }, { status: 403 });
  }
  if (!isReportAutoWorkerConfigured()) {
    return Response.json(
      { error: "Auto upload is not configured. Set REPORT_AUTO_WORKER_URL and REPORT_AUTO_ADMIN_KEY, or use Manual upload." },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    source_type?: string;
    report_date?: string;
    station_code?: string;
  };
  const sourceType = String(body.source_type || "").trim();
  if (!isReportAutoSource(sourceType)) {
    return Response.json(
      { error: "Auto upload is not available for this report. Use Manual upload." },
      { status: 400 }
    );
  }

  const reportDate = ymdOrNull(body.report_date) || yesterdayIst();

  try {
    if (sourceType === "amazon_shipments" || sourceType === "daily_edsp_metrics") {
      const isoWeek = ymdOrNull(body.report_date) ? isoWeekFromYmd(String(body.report_date)) : undefined;
      const ready = await reportAutoGet<WorkforceReadyResponse>(
        "/api/admin/reports/workforce-supp/ready",
        isoWeek ? { isoWeek } : undefined
      );
      if (!ready.ready && !ready.alreadyUploaded) {
        return Response.json(
          {
            ok: false,
            sourceType,
            ready: false,
            isoWeek: isoWeek || ready.isoWeek,
            error:
              ready.reason
              || "Amazon has not published today’s weekly-supp files yet (formattedCreationDate). Use Manual upload or retry after 8am–3pm."
          },
          { status: 409 }
        );
      }
      const run = await reportAutoPost<{ ok: boolean; run?: { id?: string }; isoWeek?: string }>(
        "/api/admin/reports/workforce-supp/run",
        { ...(isoWeek ? { isoWeek } : {}), forceNew: true }
      );
      const week = run.isoWeek || ready.isoWeek || isoWeek;
      const result: AutoRunResult = {
        ok: true,
        sourceType,
        runId: run.run?.id,
        isoWeek: week,
        ready: true,
        message: `Workforce weekly-supp run started for ${week}. Files upload to Import Master when the worker finishes.`
      };
      return Response.json(result);
    }

    if (sourceType === "delivered_shipment_detail") {
      const run = await reportAutoPost<{
        ok: boolean;
        done?: boolean;
        reportDate?: string;
        run?: { id?: string };
        lastStationCode?: string;
      }>("/api/admin/reports/delivered-shipment/refresh", {
        reportDate,
        forceNew: true,
        processTicks: 1
      });
      const runId = run.run?.id;
      const result: AutoRunResult = {
        ok: true,
        sourceType,
        runId,
        reportDate: run.reportDate || reportDate,
        done: Boolean(run.done),
        statusUrl: runId
          ? `/api/admin/reports/delivered-shipment/status?reportDate=${encodeURIComponent(run.reportDate || reportDate)}&runId=${encodeURIComponent(runId)}`
          : undefined,
        message: run.done
          ? `Delivered data finished for ${run.reportDate || reportDate}.`
          : `Delivered data started (${run.lastStationCode || "first station"}). Remaining stations continue on the worker ticker — check Upload log shortly.`
      };
      return Response.json(result);
    }

    const path =
      sourceType === "iocl_fuel"
        ? "/api/admin/reports/iocl-fuel/run"
        : sourceType === "bpcl_fuel"
          ? "/api/admin/reports/bpcl-fuel/run"
          : "/api/admin/reports/cashbook/run";
    const run = await reportAutoPost<{
      ok?: boolean;
      error?: string;
      reportDate?: string;
      run?: { id?: string; error?: string | null };
    }>(path, { reportDate, forceNew: true });
    if (run.error || run.run?.error) {
      return Response.json(
        { ok: false, sourceType, reportDate, error: run.error || run.run?.error },
        { status: 502 }
      );
    }
    const result: AutoRunResult = {
      ok: true,
      sourceType,
      runId: run.run?.id,
      reportDate: run.reportDate || reportDate,
      message: `${sourceType} auto run completed for ${run.reportDate || reportDate}. Check Upload log for the Import Master batch.`
    };
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number }).status === 409 ? 409 : 502;
    return Response.json({ ok: false, sourceType, error: message }, { status });
  }
}
