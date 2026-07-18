import { NextResponse } from "next/server";
import { assertReplyWindowOpen, loadInboxSnapshot, normalizeMobile, requireInboxAccess } from "@/lib/inbox-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

function messageTypeFromMime(mimeType: string) {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "document";
}

export async function POST(request: Request) {
  try {
    const guard = await requireInboxAccess("add");
    if (guard.response) return guard.response;
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const formData = await request.formData();
    const conversationId = String(formData.get("conversationId") ?? "").trim();
    const caption = String(formData.get("caption") ?? "").trim();
    const file = formData.get("file");
    if (!conversationId) throw new Error("Select a conversation.");
    if (!(file instanceof File) || !file.size) throw new Error("Select a file to send.");

    const conversationResult = await supabaseAdmin
      .from("inbox_conversations")
      .select("id, whatsapp_profile_id, whatsapp_profile_name, contact_external_id, contact_name, contact_phone, status")
      .eq("company_id", guard.companyId!)
      .eq("id", conversationId)
      .single();
    if (conversationResult.error) throw new Error(conversationResult.error.message);
    const conversation = conversationResult.data;
    if (!conversation.whatsapp_profile_id) throw new Error("This conversation is not linked to a WhatsApp sender profile.");

    await assertReplyWindowOpen(guard.companyId!, conversation.id);

    const [profileResult, tokenResult] = await Promise.all([
      supabaseAdmin
        .from("whatsapp_profiles")
        .select("id, profile_name, phone_number_id, graph_api_version, is_active")
        .eq("company_id", guard.companyId!)
        .eq("id", conversation.whatsapp_profile_id)
        .single(),
      supabaseAdmin.rpc("get_whatsapp_profile_access_token", { profile_id: conversation.whatsapp_profile_id })
    ]);
    if (profileResult.error) throw new Error(profileResult.error.message);
    if (tokenResult.error) throw new Error(tokenResult.error.message);
    const profile = profileResult.data;
    if (!profile.is_active) throw new Error("Selected WhatsApp profile is inactive.");
    if (!tokenResult.data) throw new Error("WhatsApp profile access token is missing.");

    const to = normalizeMobile(conversation.contact_external_id || conversation.contact_phone);
    if (!to) throw new Error("Contact mobile number is missing.");

    const uploadForm = new FormData();
    uploadForm.set("messaging_product", "whatsapp");
    uploadForm.set("file", file);
    const uploadResponse = await fetch(`https://graph.facebook.com/${profile.graph_api_version}/${profile.phone_number_id}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenResult.data}` },
      body: uploadForm
    });
    const uploadPayload = await uploadResponse.json() as { id?: string; error?: { message?: string } };
    if (!uploadResponse.ok || !uploadPayload.id) throw new Error(uploadPayload.error?.message || "Meta rejected the media upload.");

    const messageType = messageTypeFromMime(file.type);
    const mediaPayload: Record<string, string> = { id: uploadPayload.id };
    if (caption && ["image", "video", "document"].includes(messageType)) mediaPayload.caption = caption;
    if (messageType === "document") mediaPayload.filename = file.name;

    const requestPayload = {
      messaging_product: "whatsapp",
      to,
      type: messageType,
      [messageType]: mediaPayload
    };
    const sendResponse = await fetch(`https://graph.facebook.com/${profile.graph_api_version}/${profile.phone_number_id}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenResult.data}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestPayload)
    });
    const sendPayload = await sendResponse.json() as { messages?: Array<{ id?: string }>; error?: { message?: string } };
    if (!sendResponse.ok) throw new Error(sendPayload.error?.message || "Meta rejected the WhatsApp attachment.");
    const providerMessageId = sendPayload.messages?.[0]?.id ?? null;
    const now = new Date().toISOString();
    const preview = caption || `[${messageType}]`;

    const insertResult = await supabaseAdmin
      .from("inbox_messages")
      .insert({
        company_id: guard.companyId!,
        conversation_id: conversation.id,
        channel: "whatsapp",
        whatsapp_profile_id: profile.id,
        direction: "outgoing",
        provider_message_id: providerMessageId,
        message_type: messageType,
        message_text: caption || null,
        contact_external_id: conversation.contact_external_id,
        contact_name: conversation.contact_name,
        contact_phone: conversation.contact_phone,
        payload: {
          request: requestPayload,
          response: sendPayload,
          sender_name: guard.authorization?.fullName || guard.authorization?.email || "Dashboard user",
          sender_email: guard.authorization?.email ?? null,
          sender_user_id: guard.authorization?.userId ?? null,
          [messageType]: {
            id: uploadPayload.id,
            mime_type: file.type,
            filename: file.name,
            caption
          }
        },
        status: "sent",
        message_timestamp: now
      })
      .select("id")
      .single();
    if (insertResult.error) throw new Error(insertResult.error.message);

    await supabaseAdmin
      .from("inbox_conversations")
      .update({
        last_message_preview: preview,
        last_message_at: now,
        status: "open",
        updated_at: now
      })
      .eq("company_id", guard.companyId!)
      .eq("id", conversation.id);

    await supabaseAdmin.from("whatsapp_message_logs").insert({
      company_id: guard.companyId!,
      event_code: "inbox_attachment",
      whatsapp_profile_id: profile.id,
      whatsapp_profile_name: profile.profile_name,
      recipient: to,
      status: "sent",
      provider_message_id: providerMessageId,
      request_payload: requestPayload,
      response_payload: sendPayload
    });

    return NextResponse.json({ snapshot: await loadInboxSnapshot(guard.companyId!, conversation.id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to send attachment." }, { status: 500 });
  }
}
