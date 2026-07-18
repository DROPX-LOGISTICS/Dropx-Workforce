import { NextResponse } from "next/server";
import { getAuthorization, hasPermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { WhatsAppTemplateComponent } from "@/lib/whatsapp-template";

export const replyWindowMs = 24 * 60 * 60 * 1000;

export function normalizeMobile(value: string | null | undefined) {
  return String(value ?? "").replace(/\D/g, "");
}

export async function requireInboxAccess(action: "access" | "add" | "edit" = "access") {
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

export async function loadInboxSnapshot(companyId: string, conversationId?: string | null) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const enabledProfileIds = await chatEnabledProfileIds(companyId);

  let conversationsQuery = supabaseAdmin
    .from("inbox_conversations")
    .select("id, channel, whatsapp_profile_id, whatsapp_profile_name, contact_name, contact_phone, status, last_message_preview, last_message_at, unread_count")
    .eq("company_id", companyId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(50);
  if (enabledProfileIds?.length) {
    conversationsQuery = conversationsQuery.or(`channel.neq.whatsapp,whatsapp_profile_id.in.(${enabledProfileIds.join(",")})`);
  } else if (enabledProfileIds) {
    conversationsQuery = conversationsQuery.neq("channel", "whatsapp");
  }
  const conversationsResult = await conversationsQuery;
  if (conversationsResult.error) throw new Error(conversationsResult.error.message);

  const conversations = conversationsResult.data ?? [];
  const selectedConversation = conversations.find((conversation) => conversation.id === conversationId) ?? conversations[0] ?? null;
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

export async function assertReplyWindowOpen(companyId: string, conversationId: string) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const latestIncomingResult = await supabaseAdmin
    .from("inbox_messages")
    .select("message_timestamp")
    .eq("company_id", companyId)
    .eq("conversation_id", conversationId)
    .eq("direction", "incoming")
    .order("message_timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestIncomingResult.error) throw new Error(latestIncomingResult.error.message);
  const latestIncomingAt = latestIncomingResult.data?.message_timestamp;
  if (!latestIncomingAt || Date.now() - new Date(latestIncomingAt).getTime() > replyWindowMs) {
    throw new Error("Outside 24 hrs. This message type is unavailable after the WhatsApp reply window closes.");
  }
}

export function renderTemplateText(components: WhatsAppTemplateComponent[], mappings: Record<string, string>, values: Record<string, string>, fallback: string) {
  const lines = components
    .filter((component) => ["HEADER", "BODY"].includes(String(component.type ?? "").toUpperCase()) && component.text)
    .map((component) => {
      const normalizedType = String(component.type ?? "").toLowerCase();
      return String(component.text ?? "").replace(/\{\{(\d+)\}\}/g, (_, position: string) => values[mappings[`${normalizedType}.${position}`]] ?? "");
    })
    .filter(Boolean);
  return lines.join("\n\n").trim() || `[${fallback}]`;
}
