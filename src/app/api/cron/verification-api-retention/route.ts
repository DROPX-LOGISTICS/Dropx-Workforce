import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RETENTION_DAYS = 90;
const BATCH_SIZE = 1000;
const MAX_BATCHES = 20;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const auth = request.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Supabase service role key is not configured." },
      { status: 500 }
    );
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let deleted = 0;
  let hasMore = false;

  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const selection = await supabaseAdmin
      .from("verification_api_audit_logs")
      .select("id")
      .lt("created_at", cutoff)
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (selection.error) {
      return NextResponse.json({ error: selection.error.message }, { status: 500 });
    }

    const ids = (selection.data ?? []).map((row) => row.id as string);
    if (!ids.length) {
      hasMore = false;
      break;
    }

    const removal = await supabaseAdmin
      .from("verification_api_audit_logs")
      .delete()
      .in("id", ids);

    if (removal.error) {
      return NextResponse.json({ error: removal.error.message }, { status: 500 });
    }

    deleted += ids.length;
    hasMore = ids.length === BATCH_SIZE;
    if (!hasMore) break;
  }

  return NextResponse.json({
    cutoff,
    deleted,
    has_more: hasMore,
    retention_days: RETENTION_DAYS
  });
}
