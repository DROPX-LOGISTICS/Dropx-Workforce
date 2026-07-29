import { NextResponse } from "next/server";
import { requireConnectAccount, type ConnectAccount } from "../../../../src/lib/connect-auth";
import { supabaseAdmin } from "../../../../src/lib/supabase-admin";

function setupMessage(error: unknown) {
  const message = String((error as { message?: unknown })?.message ?? "");
  return message.toLowerCase().includes("mob_app_notifications")
    ? "App notifications are not configured. Run scripts/mob_app_notifications_v1.sql in Supabase."
    : message || "Unable to load notifications.";
}

async function selectedAccount(request: Request, body?: Record<string, unknown>) {
  const url = new URL(request.url);
  const profileType = String(body?.profileType ?? url.searchParams.get("profileType") ?? "") as ConnectAccount["profileType"];
  const accountId = String(body?.accountId ?? url.searchParams.get("accountId") ?? "");
  return requireConnectAccount(profileType, accountId);
}

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const account = await selectedAccount(request);
    const result = await supabaseAdmin
      .from("mob_app_notifications")
      .select("id, event_code, title, body, route, data, created_at, read_at")
      .eq("company_id", account.companyId)
      .eq("recipient_profile_type", account.profileType)
      .eq("recipient_account_id", account.id)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(50);
    if (result.error) throw result.error;
    const notifications = result.data ?? [];
    return NextResponse.json({
      notifications,
      unreadCount: notifications.filter((row) => !row.read_at).length
    });
  } catch (error) {
    return NextResponse.json({ error: setupMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const account = await selectedAccount(request, body);
    const notificationId = String(body.notificationId ?? "").trim();
    const markAll = body.markAll === true;
    if (!notificationId && !markAll) {
      return NextResponse.json({ error: "Select a notification to mark as read." }, { status: 400 });
    }
    let query = supabaseAdmin
      .from("mob_app_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("company_id", account.companyId)
      .eq("recipient_profile_type", account.profileType)
      .eq("recipient_account_id", account.id)
      .is("archived_at", null)
      .is("read_at", null);
    if (!markAll) query = query.eq("id", notificationId);
    const result = await query;
    if (result.error) throw result.error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: setupMessage(error) }, { status: 500 });
  }
}
