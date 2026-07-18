import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { webhookCompanyId, webhookCompanyKey } from "@/lib/webhook-company";
import { POST as handleLeadWebhookPost } from "../leads/route";
import { POST as handleWhatsAppWebhookPost } from "../whatsapp/route";

export const dynamic = "force-dynamic";

type MetaPageMessagingEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    is_echo?: boolean;
    text?: string;
    attachments?: Array<{
      type?: string;
      payload?: Record<string, unknown>;
    }>;
  };
};

type MetaPageWebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    time?: number;
    messaging?: MetaPageMessagingEvent[];
  }>;
};

async function getVerifyTokens(companyId: string | null) {
  if (!supabaseAdmin) return [];
  if (!companyId) return [];
  let messagingQuery = supabaseAdmin
    .from("meta_messaging_settings")
    .select("webhook_verify_token")
    .eq("id", true);
  let leadsQuery = supabaseAdmin
    .from("meta_leads_settings")
    .select("webhook_verify_token")
    .eq("id", true);
  let whatsAppQuery = supabaseAdmin
    .from("whatsapp_settings")
    .select("webhook_verify_token")
    .eq("id", true);
  if (companyId) {
    messagingQuery = messagingQuery.eq("company_id", companyId);
    leadsQuery = leadsQuery.eq("company_id", companyId);
    whatsAppQuery = whatsAppQuery.eq("company_id", companyId);
  }
  const [messagingResult, leadsResult, whatsAppResult] = await Promise.all([
    messagingQuery.maybeSingle(),
    leadsQuery.maybeSingle(),
    whatsAppQuery.maybeSingle()
  ]);
  return [
    messagingResult.data?.webhook_verify_token,
    leadsResult.data?.webhook_verify_token,
    whatsAppResult.data?.webhook_verify_token
  ].filter(Boolean) as string[];
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  const companyKey = webhookCompanyKey(request);
  const verifyTokens = await getVerifyTokens(webhookCompanyId(request));

  if (mode === "subscribe" && challenge && token && (token === companyKey || verifyTokens.includes(token))) {
    return new Response(challenge, { status: 200 });
  }

  return Response.json({ error: "Webhook verification failed." }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const companyId = webhookCompanyId(request);
  if (!companyId) {
    return Response.json(
      { received: false, error: "Webhook company is missing. Use the company-specific webhook URL." },
      { status: 400 }
    );
  }
  const forwardedRequest = request.clone();
  const payload = await request.json().catch(() => null);
  const changes = Array.isArray(payload?.entry) ? payload.entry.flatMap((entry: { changes?: unknown[] }) => entry.changes ?? []) : [];
  const hasLeadgenPayload = changes.some((change: { field?: string; value?: { leadgen_id?: string } }) => {
    return change.field === "leadgen" && Boolean(change.value?.leadgen_id);
  });
  const isWhatsAppPayload = changes.some((change: { value?: { messaging_product?: string; metadata?: { phone_number_id?: string }; statuses?: unknown[]; messages?: unknown[] } }) => {
    const value = change.value;
    return value?.messaging_product === "whatsapp" || Boolean(value?.metadata?.phone_number_id && (value?.statuses || value?.messages));
  });

  if (hasLeadgenPayload) {
    return handleLeadWebhookPost(forwardedRequest);
  }

  if (isWhatsAppPayload) {
    return handleWhatsAppWebhookPost(forwardedRequest);
  }

  if (payload?.object === "page") {
    const result = await saveFacebookPageMessages(payload as MetaPageWebhookPayload, companyId);
    console.log("Meta page webhook processed", JSON.stringify(result));
    return Response.json({ received: true, ...result });
  }

  if (payload?.object === "instagram") {
    const result = await saveInstagramMessages(payload as MetaPageWebhookPayload, companyId);
    console.log("Meta instagram webhook processed", JSON.stringify(result));
    return Response.json({ received: true, ...result });
  }

  console.log("Meta webhook received", JSON.stringify(payload));
  return Response.json({ received: true });
}

function timestampToIso(timestamp: number | undefined) {
  if (!timestamp || !Number.isFinite(timestamp)) return new Date().toISOString();
  return new Date(timestamp).toISOString();
}

function pageMessagePreview(event: MetaPageMessagingEvent) {
  const text = pageMessageText(event);
  if (text) return text;
  const attachment = event.message?.attachments?.[0];
  if (attachment?.type) return `[${attachment.type}]`;
  return "[message]";
}

function pageMessageText(event: MetaPageMessagingEvent) {
  const directText = event.message?.text?.trim();
  if (directText) return directText;
  const message = event.message as Record<string, unknown> | undefined;
  const nestedText = message?.text;
  if (typeof nestedText === "string" && nestedText.trim()) return nestedText.trim();
  return null;
}

function senderNameFromPageMessage(text: string | null | undefined, fallback: string) {
  const message = text?.trim();
  if (!message) return fallback;
  const patterns = [
    /^Full\s*name\s*:\s*(.+)$/im,
    /^Name\s*:\s*(.+)$/im
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    const name = match?.[1]?.trim();
    if (name) return name;
  }
  return fallback;
}

async function loadFacebookPageSettings(pageId: string | undefined, companyId: string | null) {
  const defaults = {
    enabled: false,
    companyId: null as string | null,
    pageId: pageId ?? "",
    pageName: pageId ? `Facebook Page ${pageId}` : "Facebook Page",
    profileName: pageId ? `Facebook Page ${pageId}` : "Facebook Page"
  };
  if (!supabaseAdmin) return defaults;

  let profileQuery = pageId ? supabaseAdmin
    .from("meta_channel_profiles")
    .select("company_id, profile_name, page_id, page_name, chat_enabled, is_active")
    .eq("channel", "facebook")
    .eq("page_id", pageId) : null;
  if (profileQuery && companyId) profileQuery = profileQuery.eq("company_id", companyId);
  const profileResult = profileQuery ? await profileQuery.maybeSingle() : { data: null, error: null };

  if (!profileResult.error && profileResult.data) {
    return {
      enabled: Boolean(profileResult.data.is_active && profileResult.data.chat_enabled),
      companyId: profileResult.data.company_id ?? null,
      pageId: profileResult.data.page_id || pageId || "",
      pageName: profileResult.data.page_name || profileResult.data.profile_name || pageId || "Facebook Page",
      profileName: profileResult.data.profile_name || profileResult.data.page_name || pageId || "Facebook Page"
    };
  }

  return defaults;
}

async function loadInstagramSettings(instagramBusinessId: string | undefined, companyId: string | null) {
  const defaults = {
    enabled: false,
    companyId: null as string | null,
    profileId: null as string | null,
    businessAccountId: instagramBusinessId ?? null,
    profileName: instagramBusinessId ? `Instagram ${instagramBusinessId}` : "Instagram",
    graphApiVersion: "v25.0"
  };
  if (!supabaseAdmin) return defaults;

  let instagramQuery = instagramBusinessId ? supabaseAdmin
    .from("meta_channel_profiles")
    .select("id, company_id, profile_name, page_name, instagram_business_account_id, connected_page_id, graph_api_version, chat_enabled, is_active")
    .eq("channel", "instagram")
    .eq("instagram_business_account_id", instagramBusinessId) : null;
  if (instagramQuery && companyId) instagramQuery = instagramQuery.eq("company_id", companyId);
  const byInstagramBusinessId = instagramQuery ? await instagramQuery.maybeSingle() : { data: null, error: null };

  let pageQuery = !byInstagramBusinessId.data && instagramBusinessId ? supabaseAdmin
    .from("meta_channel_profiles")
    .select("id, company_id, profile_name, page_name, instagram_business_account_id, connected_page_id, graph_api_version, chat_enabled, is_active")
    .eq("channel", "instagram")
    .eq("connected_page_id", instagramBusinessId) : null;
  if (pageQuery && companyId) pageQuery = pageQuery.eq("company_id", companyId);
  const byConnectedPageId = pageQuery ? await pageQuery.maybeSingle() : { data: null, error: null };

  const profile = byInstagramBusinessId.error || byConnectedPageId.error ? null : byInstagramBusinessId.data ?? byConnectedPageId.data;
  if (profile) {
    return {
      enabled: Boolean(profile.is_active && profile.chat_enabled),
      companyId: profile.company_id ?? null,
      profileId: profile.id ?? null,
      businessAccountId: profile.instagram_business_account_id || instagramBusinessId || null,
      profileName: profile.profile_name || profile.page_name || instagramBusinessId || "Instagram",
      graphApiVersion: profile.graph_api_version || "v25.0"
    };
  }

  return defaults;
}

async function resolveInstagramSenderName(
  instagramSettings: { profileId: string | null; graphApiVersion: string },
  senderId: string,
  fallback: string
) {
  if (!supabaseAdmin || !instagramSettings.profileId) return fallback;
  try {
    const tokenResult = await supabaseAdmin.rpc("get_meta_channel_profile_access_token", { profile_id: instagramSettings.profileId });
    if (tokenResult.error || !tokenResult.data) return fallback;
    const response = await fetch(`https://graph.instagram.com/${instagramSettings.graphApiVersion}/${senderId}?fields=name,username`, {
      headers: { Authorization: `Bearer ${tokenResult.data}` }
    });
    const payload = await response.json().catch(() => null) as { name?: string; username?: string } | null;
    if (!response.ok) return fallback;
    return payload?.name || payload?.username || fallback;
  } catch {
    return fallback;
  }
}

async function saveFacebookPageMessages(payload: MetaPageWebhookPayload, companyId: string | null) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  let receivedMessages = 0;
  let savedMessages = 0;
  let skippedMessages = 0;

  for (const entry of payload.entry ?? []) {
    const pageSettings = await loadFacebookPageSettings(entry.id, companyId);
    if (!pageSettings.enabled || !pageSettings.companyId) {
      skippedMessages += entry.messaging?.filter((event) => event.message?.mid).length ?? 0;
      continue;
    }

    for (const event of entry.messaging ?? []) {
      if (!event.message?.mid || !event.sender?.id) continue;
      receivedMessages += 1;

      const existingMessage = await supabaseAdmin
        .from("inbox_messages")
        .select("id")
        .eq("company_id", pageSettings.companyId)
        .eq("provider_message_id", event.message.mid)
        .maybeSingle();
      if (existingMessage.error) throw new Error(existingMessage.error.message);
      if (existingMessage.data) {
        skippedMessages += 1;
        continue;
      }

      const contactExternalId = event.sender.id;
      const messageTimestamp = timestampToIso(event.timestamp ?? entry.time);
      const preview = pageMessagePreview(event);
      const messageType = event.message.attachments?.[0]?.type || "text";
      const contactName = senderNameFromPageMessage(event.message.text, contactExternalId);

      const existingConversation = await supabaseAdmin
        .from("inbox_conversations")
        .select("id, unread_count")
        .eq("company_id", pageSettings.companyId)
        .eq("channel", "facebook")
        .is("whatsapp_profile_id", null)
        .eq("contact_external_id", contactExternalId)
        .maybeSingle();
      if (existingConversation.error) throw new Error(existingConversation.error.message);

      const conversationPayload = {
        company_id: pageSettings.companyId,
        channel: "facebook",
        whatsapp_profile_id: null,
        whatsapp_profile_name: pageSettings.profileName,
        contact_external_id: contactExternalId,
        contact_name: contactName,
        contact_phone: contactExternalId,
        status: "open",
        last_message_preview: preview,
        last_message_at: messageTimestamp,
        updated_at: new Date().toISOString()
      };

      const conversationResult = existingConversation.data
        ? await supabaseAdmin
          .from("inbox_conversations")
          .update(conversationPayload)
          .eq("company_id", pageSettings.companyId)
          .eq("id", existingConversation.data.id)
          .select("id, unread_count")
          .single()
        : await supabaseAdmin
          .from("inbox_conversations")
          .insert(conversationPayload)
          .select("id, unread_count")
          .single();
      if (conversationResult.error) throw new Error(conversationResult.error.message);

      const insertResult = await supabaseAdmin.from("inbox_messages").insert({
        company_id: pageSettings.companyId,
        conversation_id: conversationResult.data.id,
        channel: "facebook",
        whatsapp_profile_id: null,
        direction: "incoming",
        provider_message_id: event.message.mid,
        message_type: messageType,
        message_text: event.message.text || null,
        contact_external_id: contactExternalId,
        contact_name: contactName,
        contact_phone: contactExternalId,
        payload: event.message,
        status: "received",
        message_timestamp: messageTimestamp
      });
      if (insertResult.error) throw new Error(insertResult.error.message);

      await supabaseAdmin
        .from("inbox_conversations")
        .update({
          unread_count: (conversationResult.data.unread_count ?? 0) + 1,
          last_message_preview: preview,
          last_message_at: messageTimestamp,
          updated_at: new Date().toISOString()
        })
        .eq("company_id", pageSettings.companyId)
        .eq("id", conversationResult.data.id);

      savedMessages += 1;
    }
  }

  return { channel: "facebook", receivedMessages, savedMessages, skippedMessages };
}

async function saveInstagramMessages(payload: MetaPageWebhookPayload, companyId: string | null) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  let receivedMessages = 0;
  let savedMessages = 0;
  let skippedMessages = 0;

  for (const entry of payload.entry ?? []) {
    const instagramSettings = await loadInstagramSettings(entry.id, companyId);
    if (!instagramSettings.enabled || !instagramSettings.companyId) {
      skippedMessages += entry.messaging?.filter((event) => event.message?.mid).length ?? 0;
      continue;
    }

    for (const event of entry.messaging ?? []) {
      if (!event.message?.mid || !event.sender?.id) continue;
      receivedMessages += 1;

      const existingMessage = await supabaseAdmin
        .from("inbox_messages")
        .select("id")
        .eq("company_id", instagramSettings.companyId)
        .eq("provider_message_id", event.message.mid)
        .maybeSingle();
      if (existingMessage.error) throw new Error(existingMessage.error.message);
      if (existingMessage.data) {
        skippedMessages += 1;
        continue;
      }

      const senderId = event.sender.id;
      const recipientId = event.recipient?.id ?? "";
      const profileIds = new Set([entry.id, instagramSettings.businessAccountId].filter(Boolean));
      const isOutgoingEcho = Boolean(event.message.is_echo || profileIds.has(senderId));
      const contactExternalId = isOutgoingEcho ? recipientId : senderId;
      if (!contactExternalId) continue;

      const messageTimestamp = timestampToIso(event.timestamp ?? entry.time);
      const preview = pageMessagePreview(event);
      const messageType = event.message.attachments?.[0]?.type || "text";
      const messageText = pageMessageText(event);
      const direction = isOutgoingEcho ? "outgoing" : "incoming";
      const contactName = await resolveInstagramSenderName(
        instagramSettings,
        contactExternalId,
        senderNameFromPageMessage(messageText, contactExternalId)
      );

      const existingConversation = await supabaseAdmin
        .from("inbox_conversations")
        .select("id, unread_count")
        .eq("company_id", instagramSettings.companyId)
        .eq("channel", "instagram")
        .is("whatsapp_profile_id", null)
        .eq("contact_external_id", contactExternalId)
        .maybeSingle();
      if (existingConversation.error) throw new Error(existingConversation.error.message);

      const conversationPayload = {
        company_id: instagramSettings.companyId,
        channel: "instagram",
        whatsapp_profile_id: null,
        whatsapp_profile_name: instagramSettings.profileName,
        contact_external_id: contactExternalId,
        contact_name: contactName,
        contact_phone: contactExternalId,
        status: direction === "incoming" ? "open" : existingConversation.data ? undefined : "closed",
        last_message_preview: preview,
        last_message_at: messageTimestamp,
        updated_at: new Date().toISOString()
      };
      const cleanConversationPayload = Object.fromEntries(
        Object.entries(conversationPayload).filter(([, value]) => value !== undefined)
      );

      const conversationResult = existingConversation.data
        ? await supabaseAdmin
          .from("inbox_conversations")
          .update(cleanConversationPayload)
          .eq("company_id", instagramSettings.companyId)
          .eq("id", existingConversation.data.id)
          .select("id, unread_count")
          .single()
        : await supabaseAdmin
          .from("inbox_conversations")
          .insert(cleanConversationPayload)
          .select("id, unread_count")
          .single();
      if (conversationResult.error) throw new Error(conversationResult.error.message);

      const insertResult = await supabaseAdmin.from("inbox_messages").insert({
        company_id: instagramSettings.companyId,
        conversation_id: conversationResult.data.id,
        channel: "instagram",
        whatsapp_profile_id: null,
        direction,
        provider_message_id: event.message.mid,
        message_type: messageType,
        message_text: messageText,
        contact_external_id: contactExternalId,
        contact_name: contactName,
        contact_phone: contactExternalId,
        payload: event.message,
        status: direction === "incoming" ? "received" : "sent",
        message_timestamp: messageTimestamp
      });
      if (insertResult.error) throw new Error(insertResult.error.message);

      const updatePayload = {
        unread_count: direction === "incoming" ? (conversationResult.data.unread_count ?? 0) + 1 : (conversationResult.data.unread_count ?? 0),
        last_message_preview: preview,
        last_message_at: messageTimestamp,
        updated_at: new Date().toISOString()
      };
      await supabaseAdmin.from("inbox_conversations").update(updatePayload).eq("company_id", instagramSettings.companyId).eq("id", conversationResult.data.id);

      savedMessages += 1;
    }
  }

  return { channel: "instagram", receivedMessages, savedMessages, skippedMessages };
}
