import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

type PortalRun = {
  id: string;
  company_id: string;
  location_id: string | null;
  cod_master_id: string | null;
  station_code: string;
  portal_station_code: string | null;
  check_date: string;
  check_type: "driver_reconciliation" | "prepared_deposit";
  attempt_count: number | string;
  cod_station_settings?: {
    amazon_driver_recon_url: string | null;
    amazon_bank_deposit_url: string | null;
    portal_login_url: string | null;
    portal_username: string | null;
    portal_secret_name: string | null;
    portal_check_interval_minutes: number | string | null;
  } | Array<{
    amazon_driver_recon_url: string | null;
    amazon_bank_deposit_url: string | null;
    portal_login_url: string | null;
    portal_username: string | null;
    portal_secret_name: string | null;
    portal_check_interval_minutes: number | string | null;
  }> | null;
};

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function retryAt(minutes: number | string | null | undefined) {
  const parsed = Number(minutes ?? 30);
  const delay = Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
  return new Date(Date.now() + delay * 60 * 1000).toISOString();
}

async function markRun(id: string, update: Record<string, unknown>) {
  if (!supabaseAdmin) return;
  await supabaseAdmin
    .from("ops_portal_check_runs")
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq("id", id);
}

async function logRun(run: PortalRun, eventType: string, message: string, payload: Record<string, unknown> = {}) {
  if (!supabaseAdmin) return;
  await supabaseAdmin.from("ops_portal_check_events").insert({
    company_id: run.company_id,
    run_id: run.id,
    event_type: eventType,
    message,
    payload
  });
}

async function processRun(run: PortalRun, workerUrl: string, workerSecret: string) {
  const setting = firstRelation(run.cod_station_settings);
  if (!setting) {
    await markRun(run.id, {
      status: "Error",
      error_message: "COD Master row is missing for this portal check.",
      last_checked_at: new Date().toISOString(),
      attempt_count: Number(run.attempt_count ?? 0) + 1,
      next_check_at: retryAt(30)
    });
    return { error: 1, ok: 0 };
  }

  await markRun(run.id, {
    status: "Running",
    error_message: null,
    last_checked_at: new Date().toISOString(),
    attempt_count: Number(run.attempt_count ?? 0) + 1
  });

  const requestBody = {
    run_id: run.id,
    company_id: run.company_id,
    location_id: run.location_id,
    station_code: run.station_code,
    portal_station_code: run.portal_station_code,
    check_date: run.check_date,
    check_type: run.check_type,
    login_url: setting.portal_login_url,
    username: setting.portal_username,
    secret_name: setting.portal_secret_name,
    urls: {
      driver_reconciliation: setting.amazon_driver_recon_url,
      bank_deposits: setting.amazon_bank_deposit_url
    }
  };

  try {
    const response = await fetch(workerUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${workerSecret}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(result.error ?? `Worker returned HTTP ${response.status}`));

    const status = ["Pass", "Fail", "Manual Review", "Error", "Skipped"].includes(String(result.status))
      ? String(result.status)
      : "Manual Review";

    await markRun(run.id, {
      status,
      pending_count: Number(result.pending_count ?? 0) || 0,
      pending_amount: Number(result.pending_amount ?? 0) || 0,
      summary: String(result.summary ?? "").trim() || "Portal worker completed the check.",
      evidence: result.evidence ?? {},
      raw_result: result,
      error_message: status === "Error" ? String(result.error_message ?? "Portal worker returned an error.") : null,
      last_checked_at: new Date().toISOString(),
      next_check_at: ["Fail", "Manual Review", "Error"].includes(status) ? retryAt(setting.portal_check_interval_minutes) : null
    });
    await logRun(run, "worker_result", `Portal worker completed ${run.check_type}.`, result as Record<string, unknown>);
    return { error: 0, ok: 1 };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Portal worker failed.";
    await markRun(run.id, {
      status: "Error",
      error_message: message,
      summary: "Portal check could not be completed.",
      last_checked_at: new Date().toISOString(),
      next_check_at: retryAt(setting.portal_check_interval_minutes)
    });
    await logRun(run, "worker_error", message);
    return { error: 1, ok: 0 };
  }
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const auth = request.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) return unauthorized();
  }
  if (!supabaseAdmin) return NextResponse.json({ error: "Supabase service role key is not configured." }, { status: 500 });

  const workerUrl = process.env.OPS_PORTAL_WORKER_URL?.trim();
  const workerSecret = process.env.OPS_PORTAL_WORKER_SECRET?.trim();
  const now = new Date().toISOString();

  const runsResult = await supabaseAdmin
    .from("ops_portal_check_runs")
    .select("id, company_id, location_id, cod_master_id, station_code, portal_station_code, check_date, check_type, attempt_count, cod_station_settings (amazon_driver_recon_url, amazon_bank_deposit_url, portal_login_url, portal_username, portal_secret_name, portal_check_interval_minutes)")
    .in("status", ["Queued", "Fail", "Manual Review", "Error"])
    .or(`next_check_at.is.null,next_check_at.lte.${now}`)
    .order("created_at", { ascending: true })
    .limit(10);

  if (runsResult.error) return NextResponse.json({ error: runsResult.error.message }, { status: 500 });
  const runs = (runsResult.data ?? []) as unknown as PortalRun[];

  if (!workerUrl || !workerSecret) {
    for (const run of runs) {
      await markRun(run.id, {
        status: "Error",
        error_message: "Portal worker not configured. Set OPS_PORTAL_WORKER_URL and OPS_PORTAL_WORKER_SECRET in deployment secrets.",
        summary: "Waiting for backend portal worker configuration.",
        last_checked_at: now,
        next_check_at: retryAt(60)
      });
    }
    return NextResponse.json({ processed: runs.length, ok: 0, error: runs.length, message: "Portal worker not configured." });
  }

  const totals = { ok: 0, error: 0 };
  for (const run of runs) {
    const result = await processRun(run, workerUrl, workerSecret);
    totals.ok += result.ok;
    totals.error += result.error;
  }

  return NextResponse.json({ processed: runs.length, ...totals });
}
