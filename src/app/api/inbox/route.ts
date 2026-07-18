import { NextResponse } from "next/server";
import { getAuthorization, hasPermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

function normalizeMobile(value: string | null | undefined) {
  return String(value ?? "").replace(/\D/g, "");
}

const replyWindowMs = 24 * 60 * 60 * 1000;

async function chatEnabledProfileIds(companyId: string) {
  if (!supabaseAdmin) return null;
  const result = await supabaseAdmin
    .from("whatsapp_profiles")
    .select("id, chat_enabled")
    .eq("company_id", companyId)
    .eq("chat_enabled", true);
  if (result.error) {
    if (result.error.message.includes("chat_enabled")) return null;
    throw new Error(result.error.message);
  }
  return (result.data ?? []).map((profile) => profile.id);
}

async function requireInboxAccess(action: "access" | "add" | "edit" = "access") {
  const authorization = await getAuthorization();
  if (!authorization) return { authorization: null, response: NextResponse.json({ error: "Login required." }, { status: 401 }) };
  if (action === "access" && !hasPermission(authorization, "inbox", "access")) {
    return { authorization, response: NextResponse.json({ error: "Inbox access denied." }, { status: 403 }) };
  }
  if (action !== "access" && !hasPermission(authorization, "inbox", "add") && !hasPermission(authorization, "inbox", "edit")) {
    return { authorization, response: NextResponse.json({ error: "Inbox reply permission denied." }, { status: 403 }) };
  }
  return { authorization, companyId: requireCompanyId(authorization), response: null };
}

function inboxSearchFilter(search: string) {
  const term = search.trim().replace(/[,%]/g, " ");
  return term ? `%${term}%` : "";
}

function isMaskedToken(value: string | null | undefined) {
  const text = String(value ?? "").trim().toLowerCase();
  return !text || /^[*•]+$/.test(text) || text.includes("token configured");
}

async function sendFacebookPageReply({
  conversation,
  text,
  sender,
  companyId
}: {
  conversation: {
    id: string;
    contact_external_id: string | null;
    contact_name: string | null;
    contact_phone: string | null;
    whatsapp_profile_name: string | null;
  };
  text: string;
  sender: { fullName?: string | null; email?: string | null; userId?: string | null } | null;
  companyId: string;
}) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const recipientId = String(conversation.contact_external_id || conversation.contact_phone || "").trim();
  if (!recipientId) throw new Error("Facebook sender ID is missing.");

  const settingsResult = await supabaseAdmin
    .from("meta_messaging_settings")
    .select("is_facebook_enabled, facebook_page_id, facebook_page_name, graph_api_version, page_access_token_secret_id")
    .eq("id", true)
    .eq("company_id", companyId)
    .maybeSingle();
  if (settingsResult.error) throw new Error(settingsResult.error.message);
  const settings = settingsResult.data;
  if (!settings?.is_facebook_enabled) throw new Error("Facebook Page messaging is disabled in Meta settings.");

  const profileNameLookup = String(conversation.whatsapp_profile_name ?? "").trim();
  const byProfileName = profileNameLookup ? await supabaseAdmin
    .from("meta_channel_profiles")
    .select("id, profile_name, page_name, graph_api_version, is_active")
    .eq("company_id", companyId)
    .eq("channel", "facebook")
    .eq("profile_name", profileNameLookup)
    .maybeSingle() : { data: null, error: null };
  const byPageName = !byProfileName.data && profileNameLookup ? await supabaseAdmin
    .from("meta_channel_profiles")
    .select("id, profile_name, page_name, graph_api_version, is_active")
    .eq("company_id", companyId)
    .eq("channel", "facebook")
    .eq("page_name", profileNameLookup)
    .maybeSingle() : { data: null, error: null };
  const profile = byProfileName.error || byPageName.error ? null : byProfileName.data ?? byPageName.data;
  const tokenResult = profile?.id
    ? await supabaseAdmin.rpc("get_meta_channel_profile_access_token", { profile_id: profile.id })
    : await supabaseAdmin.rpc("get_meta_page_access_token", { company_uuid: companyId });
  if (tokenResult.error) throw new Error(tokenResult.error.message);
  if (!tokenResult.data) throw new Error("Facebook Page access token is missing.");
  if (profile && !profile.is_active) throw new Error("Selected Facebook profile is inactive.");

  const graphVersion = profile?.graph_api_version || settings.graph_api_version || "v25.0";
  const profileName = profile?.profile_name || settings.facebook_page_name || conversation.whatsapp_profile_name || "Facebook Page";
  const requestPayload = {
    recipient: { id: recipientId },
    messaging_type: "RESPONSE",
    message: { text }
  };
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/me/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenResult.data}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestPayload)
  });
  const responsePayload = await response.json() as { message_id?: string; recipient_id?: string; error?: { message?: string } };
  if (!response.ok) throw new Error(responsePayload.error?.message || "Meta rejected the Facebook reply.");
  const now = new Date().toISOString();

  const insertResult = await supabaseAdmin
    .from("inbox_messages")
    .insert({
      conversation_id: conversation.id,
      company_id: companyId,
      channel: "facebook",
      whatsapp_profile_id: null,
      direction: "outgoing",
      provider_message_id: responsePayload.message_id ?? null,
      message_type: "text",
      message_text: text,
      contact_external_id: recipientId,
      contact_name: conversation.contact_name,
      contact_phone: conversation.contact_phone,
      payload: {
        request: requestPayload,
        response: responsePayload,
        sender_name: sender?.fullName || sender?.email || "Dashboard user",
        sender_email: sender?.email ?? null,
        sender_user_id: sender?.userId ?? null
      },
      status: "sent",
      message_timestamp: now
    })
    .select("id, direction, message_type, message_text, status, message_timestamp, contact_name, contact_phone, payload")
    .single();
  if (insertResult.error) throw new Error(insertResult.error.message);

  await supabaseAdmin
    .from("inbox_conversations")
    .update({
      whatsapp_profile_name: profileName,
      last_message_preview: text,
      last_message_at: now,
      status: "open",
      updated_at: now
    })
    .eq("company_id", companyId)
    .eq("id", conversation.id);

  return insertResult.data;
}

async function sendInstagramReply({
  conversation,
  text,
  sender,
  companyId
}: {
  conversation: {
    id: string;
    contact_external_id: string | null;
    contact_name: string | null;
    contact_phone: string | null;
    whatsapp_profile_name: string | null;
  };
  text: string;
  sender: { fullName?: string | null; email?: string | null; userId?: string | null } | null;
  companyId: string;
}) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const recipientId = String(conversation.contact_external_id || conversation.contact_phone || "").trim();
  if (!recipientId) throw new Error("Instagram sender ID is missing.");

  const settingsResult = await supabaseAdmin
    .from("meta_messaging_settings")
    .select("is_instagram_enabled, instagram_business_account_id, graph_api_version")
    .eq("id", true)
    .eq("company_id", companyId)
    .maybeSingle();
  if (settingsResult.error) throw new Error(settingsResult.error.message);
  const settings = settingsResult.data;
  if (!settings?.is_instagram_enabled) throw new Error("Instagram messaging is disabled in Meta settings.");

  const profileNameLookup = String(conversation.whatsapp_profile_name ?? "").trim();
  const profileColumns = "id, profile_name, page_name, instagram_business_account_id, graph_api_version, is_active, chat_enabled";
  const byProfileName = profileNameLookup ? await supabaseAdmin
    .from("meta_channel_profiles")
    .select(profileColumns)
    .eq("company_id", companyId)
    .eq("channel", "instagram")
    .eq("profile_name", profileNameLookup)
    .maybeSingle() : { data: null, error: null };
  const byPageName = !byProfileName.data && profileNameLookup ? await supabaseAdmin
    .from("meta_channel_profiles")
    .select(profileColumns)
    .eq("company_id", companyId)
    .eq("channel", "instagram")
    .eq("page_name", profileNameLookup)
    .maybeSingle() : { data: null, error: null };
  let profile = byProfileName.error || byPageName.error ? null : byProfileName.data ?? byPageName.data;
  if (!profile) {
    const profiles = await supabaseAdmin
      .from("meta_channel_profiles")
      .select(profileColumns)
      .eq("company_id", companyId)
      .eq("channel", "instagram")
      .eq("is_active", true)
      .eq("chat_enabled", true);
    if (profiles.error) throw new Error(profiles.error.message);
    if ((profiles.data ?? []).length === 1) profile = profiles.data![0];
  }
  if (!profile) {
    throw new Error("Instagram profile is not linked to this conversation. Open Settings > Meta > Instagram and configure the profile.");
  }
  const tokenResult = await supabaseAdmin.rpc("get_meta_channel_profile_access_token", { profile_id: profile.id });
  if (tokenResult.error) throw new Error(tokenResult.error.message);
  if (isMaskedToken(tokenResult.data)) {
    throw new Error("Instagram profile access token is missing or invalid. Open Settings > Meta > Instagram, edit this profile, and paste a fresh Instagram access token.");
  }
  if (!profile.is_active) throw new Error("Selected Instagram profile is inactive.");
  if (!profile.chat_enabled) throw new Error("Chat is disabled for the selected Instagram profile.");

  const instagramBusinessAccountId = profile?.instagram_business_account_id || settings.instagram_business_account_id;
  if (!instagramBusinessAccountId) throw new Error("Instagram Business Account ID is missing.");

  const graphVersion = profile?.graph_api_version || settings.graph_api_version || "v25.0";
  const profileName = profile?.profile_name || profile?.page_name || conversation.whatsapp_profile_name || "Instagram";
  const requestPayload = {
    recipient: { id: recipientId },
    message: { text }
  };
  const response = await fetch(`https://graph.instagram.com/${graphVersion}/${instagramBusinessAccountId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenResult.data}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestPayload)
  });
  const responsePayload = await response.json() as { message_id?: string; recipient_id?: string; error?: { message?: string } };
  if (!response.ok) {
    const message = responsePayload.error?.message || "Meta rejected the Instagram reply.";
    if (message.toLowerCase().includes("access token")) {
      throw new Error("Instagram profile access token is invalid. Open Settings > Meta > Instagram, edit this profile, and paste a fresh Instagram access token.");
    }
    throw new Error(message);
  }
  const now = new Date().toISOString();

  const insertResult = await supabaseAdmin
    .from("inbox_messages")
    .insert({
      conversation_id: conversation.id,
      company_id: companyId,
      channel: "instagram",
      whatsapp_profile_id: null,
      direction: "outgoing",
      provider_message_id: responsePayload.message_id ?? null,
      message_type: "text",
      message_text: text,
      contact_external_id: recipientId,
      contact_name: conversation.contact_name,
      contact_phone: conversation.contact_phone,
      payload: {
        request: requestPayload,
        response: responsePayload,
        sender_name: sender?.fullName || sender?.email || "Dashboard user",
        sender_email: sender?.email ?? null,
        sender_user_id: sender?.userId ?? null
      },
      status: "sent",
      message_timestamp: now
    })
    .select("id, direction, message_type, message_text, status, message_timestamp, contact_name, contact_phone, payload")
    .single();
  if (insertResult.error) throw new Error(insertResult.error.message);

  await supabaseAdmin
    .from("inbox_conversations")
    .update({
      whatsapp_profile_name: profileName,
      last_message_preview: text,
      last_message_at: now,
      status: "open",
      updated_at: now
    })
    .eq("company_id", companyId)
    .eq("id", conversation.id);

  return insertResult.data;
}

async function loadInboxSnapshot(companyId: string, conversationId?: string | null, search = "") {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const enabledProfileIds = await chatEnabledProfileIds(companyId);
  const searchTerm = inboxSearchFilter(search);

  let conversationsQuery = supabaseAdmin
    .from("inbox_conversations")
    .select("id, channel, whatsapp_profile_id, whatsapp_profile_name, contact_name, contact_phone, status, last_message_preview, last_message_at, unread_count")
    .eq("company_id", companyId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(searchTerm ? 200 : 50);
  if (enabledProfileIds?.length) {
    conversationsQuery = conversationsQuery.or(`channel.neq.whatsapp,whatsapp_profile_id.in.(${enabledProfileIds.join(",")})`);
  } else if (enabledProfileIds) {
    conversationsQuery = conversationsQuery.neq("channel", "whatsapp");
  }
  if (searchTerm) {
    conversationsQuery = conversationsQuery.or([
      `contact_name.ilike.${searchTerm}`,
      `contact_phone.ilike.${searchTerm}`,
      `whatsapp_profile_name.ilike.${searchTerm}`,
      `last_message_preview.ilike.${searchTerm}`
    ].join(","));
  }
  const conversationsResult = await conversationsQuery;
  if (conversationsResult.error) throw new Error(conversationsResult.error.message);

  let conversations = conversationsResult.data ?? [];
  let selectedConversation = conversationId ? conversations.find((conversation) => conversation.id === conversationId) ?? null : null;
  if (conversationId && !selectedConversation) {
    const selectedResult = await supabaseAdmin
      .from("inbox_conversations")
      .select("id, channel, whatsapp_profile_id, whatsapp_profile_name, contact_name, contact_phone, status, last_message_preview, last_message_at, unread_count")
      .eq("company_id", companyId)
      .eq("id", conversationId)
      .maybeSingle();
    if (selectedResult.error) throw new Error(selectedResult.error.message);
    if (selectedResult.data) {
      selectedConversation = selectedResult.data;
      conversations = [selectedResult.data, ...conversations];
    }
  }
  const selectedConversationId = selectedConversation?.id ?? null;
  const messages = selectedConversationId ? await supabaseAdmin
    .from("inbox_messages")
    .select("id, direction, message_type, message_text, status, message_timestamp, contact_name, contact_phone, payload")
    .eq("company_id", companyId)
    .eq("conversation_id", selectedConversationId)
    .order("message_timestamp", { ascending: true })
    .limit(200) : { data: [], error: null };

  if (messages.error) throw new Error(messages.error.message);
  if (selectedConversationId) {
    await supabaseAdmin
      .from("inbox_conversations")
      .update({ unread_count: 0, updated_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .eq("id", selectedConversationId);
  }

  return {
    conversations: conversations.map((conversation) => ({
      ...conversation,
      unread_count: conversation.id === selectedConversationId ? 0 : conversation.unread_count
    })),
    messages: messages.data ?? [],
    selectedConversationId
  };
}

export async function GET(request: Request) {
  try {
    const guard = await requireInboxAccess("access");
    if (guard.response) return guard.response;
    const url = new URL(request.url);
    return NextResponse.json(await loadInboxSnapshot(guard.companyId!, url.searchParams.get("conversation"), url.searchParams.get("search") ?? ""));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load inbox." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const guard = await requireInboxAccess("add");
    if (guard.response) return guard.response;
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const body = await request.json() as { conversationId?: string; text?: string };
    const conversationId = String(body.conversationId ?? "").trim();
    const text = String(body.text ?? "").trim();
    if (!conversationId) throw new Error("Select a conversation.");
    if (!text) throw new Error("Enter a reply message.");

    const conversationResult = await supabaseAdmin
      .from("inbox_conversations")
      .select("id, channel, whatsapp_profile_id, whatsapp_profile_name, contact_external_id, contact_name, contact_phone, status")
      .eq("company_id", guard.companyId!)
      .eq("id", conversationId)
      .single();
    if (conversationResult.error) throw new Error(conversationResult.error.message);
    const conversation = conversationResult.data;

    const latestIncomingResult = await supabaseAdmin
      .from("inbox_messages")
      .select("message_timestamp")
      .eq("company_id", guard.companyId!)
      .eq("conversation_id", conversation.id)
      .eq("direction", "incoming")
      .order("message_timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestIncomingResult.error) throw new Error(latestIncomingResult.error.message);
    const latestIncomingAt = latestIncomingResult.data?.message_timestamp;
    if (!latestIncomingAt || Date.now() - new Date(latestIncomingAt).getTime() > replyWindowMs) {
      throw new Error("Outside 24 hrs. Free text reply is unavailable.");
    }

    if (String(conversation.channel ?? "").toLowerCase() === "facebook") {
      await sendFacebookPageReply({ conversation, text, sender: guard.authorization, companyId: guard.companyId! });
      return NextResponse.json({ snapshot: await loadInboxSnapshot(guard.companyId!, conversation.id) });
    }

    if (String(conversation.channel ?? "").toLowerCase() === "instagram") {
      await sendInstagramReply({ conversation, text, sender: guard.authorization, companyId: guard.companyId! });
      return NextResponse.json({ snapshot: await loadInboxSnapshot(guard.companyId!, conversation.id) });
    }

    if (!conversation.whatsapp_profile_id) throw new Error("This conversation is not linked to a WhatsApp sender profile.");

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

    const requestPayload = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { preview_url: false, body: text }
    };
    const response = await fetch(`https://graph.facebook.com/${profile.graph_api_version}/${profile.phone_number_id}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenResult.data}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestPayload)
    });
    const responsePayload = await response.json() as { messages?: Array<{ id?: string }>; error?: { message?: string } };
    if (!response.ok) throw new Error(responsePayload.error?.message || "Meta rejected the WhatsApp reply.");
    const providerMessageId = responsePayload.messages?.[0]?.id ?? null;
    const now = new Date().toISOString();

    const insertResult = await supabaseAdmin
      .from("inbox_messages")
      .insert({
        conversation_id: conversation.id,
        company_id: guard.companyId!,
        channel: "whatsapp",
        whatsapp_profile_id: profile.id,
        direction: "outgoing",
        provider_message_id: providerMessageId,
        message_type: "text",
        message_text: text,
        contact_external_id: conversation.contact_external_id,
        contact_name: conversation.contact_name,
        contact_phone: conversation.contact_phone,
        payload: {
          request: requestPayload,
          response: responsePayload,
          sender_name: guard.authorization?.fullName || guard.authorization?.email || "Dashboard user",
          sender_email: guard.authorization?.email ?? null,
          sender_user_id: guard.authorization?.userId ?? null
        },
        status: "sent",
        message_timestamp: now
      })
      .select("id, direction, message_type, message_text, status, message_timestamp, contact_name, contact_phone, payload")
      .single();
    if (insertResult.error) throw new Error(insertResult.error.message);

    await supabaseAdmin
      .from("inbox_conversations")
      .update({
        last_message_preview: text,
        last_message_at: now,
        status: "open",
        updated_at: now
      })
      .eq("company_id", guard.companyId!)
      .eq("id", conversation.id);

    await supabaseAdmin.from("whatsapp_message_logs").insert({
      company_id: guard.companyId!,
      event_code: "inbox_reply",
      whatsapp_profile_id: profile.id,
      whatsapp_profile_name: profile.profile_name,
      recipient: to,
      status: "sent",
      provider_message_id: providerMessageId,
      request_payload: requestPayload,
      response_payload: responsePayload
    });

    return NextResponse.json({ message: insertResult.data, snapshot: await loadInboxSnapshot(guard.companyId!, conversation.id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to send reply." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const guard = await requireInboxAccess("edit");
    if (guard.response) return guard.response;
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const body = await request.json() as { conversationId?: string; status?: string };
    const conversationId = String(body.conversationId ?? "").trim();
    const status = String(body.status ?? "").trim().toLowerCase();
    if (!conversationId) throw new Error("Select a conversation.");
    if (!["open", "pending", "closed"].includes(status)) throw new Error("Invalid chat status.");

    const { error } = await supabaseAdmin
      .from("inbox_conversations")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("company_id", guard.companyId!)
      .eq("id", conversationId);
    if (error) throw new Error(error.message);

    return NextResponse.json({ snapshot: await loadInboxSnapshot(guard.companyId!, conversationId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update chat." }, { status: 500 });
  }
}
