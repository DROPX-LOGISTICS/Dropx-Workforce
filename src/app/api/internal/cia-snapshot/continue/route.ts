import { NextResponse } from "next/server";
import { continueCiaSnapshot, isCashReconWorkerConfigured } from "@/lib/ops-pulse/cash-recon-worker";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function adminKeyFromRequest(request: Request) {
  return (
    request.headers.get("x-admin-key")
    || request.headers.get("x-cron-secret")
    || ""
  ).trim();
}

function expectedAdminKey() {
  return (process.env.CASH_RECON_ADMIN_KEY || process.env.X_ADMIN_KEY || "").trim().replace(/^["']|["']$/g, "");
}

/**
 * Worker cron calls this with x-admin-key so overnight refresh uses the same
 * BFF chunked path as Update numbers (no nested Cloudflare self-fetch).
 */
export async function POST(request: Request) {
  try {
    const expected = expectedAdminKey();
    const provided = adminKeyFromRequest(request);
    if (!expected || provided !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isCashReconWorkerConfigured()) {
      return NextResponse.json(
        { error: "Cash recon worker is not configured." },
        { status: 503 }
      );
    }
    const body = (await request.json().catch(() => ({}))) as { runId?: string };
    const runId = String(body.runId ?? "").trim() || undefined;
    return NextResponse.json(await continueCiaSnapshot(runId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to advance Cash In Associate refresh.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
