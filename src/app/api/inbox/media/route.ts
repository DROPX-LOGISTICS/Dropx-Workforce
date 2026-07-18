import { NextResponse } from "next/server";
import { getAuthorization, hasPermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type MediaPayload = {
  id?: string;
  mime_type?: string;
  filename?: string;
};

function mediaFromPayload(messageType: string, payload: unknown): MediaPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const media = record[messageType];
  if (!media || typeof media !== "object") return null;
  return media as MediaPayload;
}

function fallbackFilename(messageType: string, mimeType: string | null) {
  const extension = mimeType?.split("/")[1]?.split(";")[0] || "bin";
  return `${messageType || "attachment"}.${extension}`;
}

export async function GET(request: Request) {
  try {
    const authorization = await getAuthorization();
    if (!authorization || !hasPermission(authorization, "inbox", "access")) {
      return NextResponse.json({ error: "Inbox access denied." }, { status: 403 });
    }
    const companyId = requireCompanyId(authorization);
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const url = new URL(request.url);
    const messageId = url.searchParams.get("message")?.trim();
    if (!messageId) throw new Error("Message is required.");

    const messageResult = await supabaseAdmin
      .from("inbox_messages")
      .select("id, message_type, payload, whatsapp_profile_id")
      .eq("id", messageId)
      .eq("company_id", companyId)
      .single();
    if (messageResult.error) throw new Error(messageResult.error.message);

    const message = messageResult.data;
    if (!message.whatsapp_profile_id) throw new Error("This media message is not linked to a WhatsApp profile.");

    const media = mediaFromPayload(message.message_type, message.payload);
    if (!media?.id) throw new Error("Media ID was not found in this message.");

    const [profileResult, tokenResult] = await Promise.all([
      supabaseAdmin
        .from("whatsapp_profiles")
        .select("id, graph_api_version, is_active")
        .eq("id", message.whatsapp_profile_id)
        .eq("company_id", companyId)
        .single(),
      supabaseAdmin.rpc("get_whatsapp_profile_access_token", { profile_id: message.whatsapp_profile_id })
    ]);
    if (profileResult.error) throw new Error(profileResult.error.message);
    if (tokenResult.error) throw new Error(tokenResult.error.message);
    if (!profileResult.data.is_active) throw new Error("WhatsApp profile is inactive.");
    if (!tokenResult.data) throw new Error("WhatsApp profile access token is missing.");

    const metadataResponse = await fetch(`https://graph.facebook.com/${profileResult.data.graph_api_version}/${media.id}`, {
      headers: { Authorization: `Bearer ${tokenResult.data}` }
    });
    const metadata = await metadataResponse.json() as { url?: string; mime_type?: string; error?: { message?: string } };
    if (!metadataResponse.ok || !metadata.url) throw new Error(metadata.error?.message || "Unable to fetch WhatsApp media metadata.");

    const mediaResponse = await fetch(metadata.url, {
      headers: { Authorization: `Bearer ${tokenResult.data}` }
    });
    if (!mediaResponse.ok || !mediaResponse.body) throw new Error("Unable to download WhatsApp media.");

    const mimeType = metadata.mime_type || media.mime_type || "application/octet-stream";
    const filename = media.filename || fallbackFilename(message.message_type, mimeType);
    return new Response(mediaResponse.body, {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `inline; filename="${filename.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=300"
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load media." }, { status: 500 });
  }
}
