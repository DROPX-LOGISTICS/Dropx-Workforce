import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { firstOnboardingActionLink } from "@/lib/onboarding-action-link";

export const dynamic = "force-dynamic";

function sameSecret(left: string, right: string) {
  const supplied = Buffer.from(left);
  const expected = Buffer.from(right);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function text(value: unknown, limit: number) {
  return String(value ?? "").trim().slice(0, limit);
}

function cleanPreview(raw: string) {
  return raw.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim().slice(0, 2000);
}

async function ingest(body: Record<string, unknown>) {
  if (!supabaseAdmin) return { body: { error: "Database unavailable" }, status: 503 };
  const recipient = text(body.recipient, 90).toLowerCase();
  const sender = text(body.sender, 320).toLowerCase();
  const messageId = text(body.messageId, 500);
  const actionUrl = text(body.actionUrl, 2000);
  if (!recipient || !sender || !messageId) return { body: { error: "Recipient, sender and message ID are required" }, status: 400 };
  const result = await supabaseAdmin.rpc("workforce_ingest_amazon_pilot_email", {
    p_action_url: actionUrl || null,
    p_message_id: messageId,
    p_preview: text(body.preview, 2000),
    p_received_at: text(body.receivedAt, 80) || new Date().toISOString(),
    p_recipient: recipient,
    p_sender: sender,
    p_subject: text(body.subject, 500),
  });
  if (result.error) throw new Error(result.error.message);
  const accepted = Boolean((result.data as { accepted?: boolean } | null)?.accepted);
  return { body: result.data ?? { accepted }, status: accepted ? 200 : 404 };
}

export async function POST(request: Request) {
  const suppliedSecret = request.headers.get("x-dropx-email-secret")?.trim() ?? "";
  try {
    if (suppliedSecret) {
      const configuredSecret = process.env.WORKFORCE_EMAIL_INGEST_SECRET?.trim() ?? "";
      if (!configuredSecret || !sameSecret(suppliedSecret, configuredSecret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const result = await ingest(await request.json() as Record<string, unknown>);
      return NextResponse.json(result.body, { status: result.status });
    }
    const apiKey = process.env.RESEND_API_KEY?.trim() ?? "";
    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET?.trim() ?? "";
    if (!apiKey || !webhookSecret) return NextResponse.json({ error: "Inbound email is not configured" }, { status: 503 });
    const payload = await request.text();
    const resend = new Resend(apiKey);
    const event = resend.webhooks.verify({
      payload,
      webhookSecret,
      headers: {
        id: request.headers.get("svix-id") ?? "",
        timestamp: request.headers.get("svix-timestamp") ?? "",
        signature: request.headers.get("svix-signature") ?? "",
      },
    });
    if (event.type !== "email.received") return NextResponse.json({ accepted: true });
    const received = await resend.emails.receiving.get(event.data.email_id, { html_format: "cid" });
    if (received.error || !received.data) throw new Error(received.error?.message || "Received email is unavailable");
    const content = received.data.text || received.data.html || "";
    const result = await ingest({
      actionUrl: firstOnboardingActionLink(content),
      messageId: event.data.message_id || event.data.email_id,
      preview: cleanPreview(content),
      receivedAt: event.data.created_at,
      recipient: event.data.to[0],
      sender: event.data.from,
      subject: event.data.subject,
    });
    // A shared inbound domain may receive typos or probes. Acknowledge unknown
    // aliases without retaining them so Resend does not retry the webhook.
    if (result.status === 404) return NextResponse.json({ accepted: false, ignored: true });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to ingest message" }, { status: 400 });
  }
}
