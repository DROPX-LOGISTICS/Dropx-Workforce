import { NextRequest } from "next/server";
import { findCompanyByWebhookKey, WEBHOOK_COMPANY_HEADER, WEBHOOK_COMPANY_KEY_HEADER } from "@/lib/webhook-company";
import { GET as handleGet, POST as handlePost } from "../meta/route";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    webhookKey: string;
  }>;
};

async function scopedRequest(request: NextRequest, webhookKey: string) {
  const company = await findCompanyByWebhookKey(webhookKey);
  if (!company?.id) return null;
  const headers = new Headers(request.headers);
  headers.set(WEBHOOK_COMPANY_HEADER, company.id);
  headers.set(WEBHOOK_COMPANY_KEY_HEADER, webhookKey);
  return new NextRequest(request, { headers });
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { webhookKey } = await context.params;
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && challenge && token === webhookKey) {
    const company = await findCompanyByWebhookKey(webhookKey);
    if (!company?.id) return Response.json({ error: "Webhook company was not found or is inactive." }, { status: 404 });
    return new Response(challenge, { status: 200 });
  }
  const scoped = await scopedRequest(request, webhookKey);
  if (!scoped) return Response.json({ error: "Webhook company was not found or is inactive." }, { status: 404 });
  return handleGet(scoped);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { webhookKey } = await context.params;
  const scoped = await scopedRequest(request, webhookKey);
  if (!scoped) return Response.json({ error: "Webhook company was not found or is inactive." }, { status: 404 });
  return handlePost(scoped);
}
