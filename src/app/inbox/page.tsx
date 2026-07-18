import { AppShell } from "@/components/app-shell";
import { InboxPanel, type InboxConversation, type InboxMessage, type InboxTemplate } from "@/components/inbox-panel";
import { NotificationPermissionButton } from "@/components/inbox-notification-listener";
import { PageHead } from "@/components/page-head";
import { hasPermission, requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

async function loadInboxData(companyId: string, selectedConversationId?: string) {
  const defaults = {
    conversations: [] as InboxConversation[],
    messages: [] as InboxMessage[],
    templates: [] as InboxTemplate[],
    selectedConversationId: null as string | null,
    error: null as string | null
  };
  if (!supabaseAdmin) return { ...defaults, error: "Supabase service role key is not configured." };

  const profileResult = await supabaseAdmin
    .from("whatsapp_profiles")
    .select("id, chat_enabled")
    .eq("company_id", companyId)
    .eq("chat_enabled", true);
  if (profileResult.error && !profileResult.error.message.includes("chat_enabled")) {
    return { ...defaults, error: profileResult.error.message };
  }
  const enabledProfileIds = profileResult.error?.message.includes("chat_enabled")
    ? null
    : (profileResult.data ?? []).map((profile) => profile.id);

  const templatesResult = await supabaseAdmin
    .from("whatsapp_template_cache")
    .select("template_id, whatsapp_profile_id, name, language, category, status, components")
    .eq("company_id", companyId)
    .eq("status", "APPROVED")
    .order("name");

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

  if (conversationsResult.error) {
    const setupHint = conversationsResult.error.message.includes("inbox_conversations")
      ? `${conversationsResult.error.message} Run scripts/omni_inbox_v1.sql in Supabase SQL Editor.`
      : conversationsResult.error.message;
    return { ...defaults, error: setupHint };
  }
  if (templatesResult.error) return { ...defaults, error: templatesResult.error.message };

  const conversations = (conversationsResult.data ?? []) as InboxConversation[];
  const selectedConversation = selectedConversationId ? conversations.find((conversation) => conversation.id === selectedConversationId) ?? null : null;
  const templates = (templatesResult.data ?? []) as InboxTemplate[];
  if (!selectedConversation) return { ...defaults, conversations, templates };

  const messagesResult = await supabaseAdmin
    .from("inbox_messages")
    .select("id, direction, message_type, message_text, status, message_timestamp, contact_name, contact_phone, payload")
    .eq("company_id", companyId)
    .eq("conversation_id", selectedConversation.id)
    .order("message_timestamp", { ascending: true })
    .limit(200);

  if (messagesResult.error) return { ...defaults, conversations, templates, selectedConversationId: selectedConversation.id, error: messagesResult.error.message };

  await supabaseAdmin
    .from("inbox_conversations")
    .update({ unread_count: 0, updated_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("id", selectedConversation.id);

  return {
    ...defaults,
    conversations: conversations.map((conversation) => ({
      ...conversation,
      unread_count: conversation.id === selectedConversation.id ? 0 : conversation.unread_count
    })),
    messages: (messagesResult.data ?? []) as InboxMessage[],
    templates,
    selectedConversationId: selectedConversation.id
  };
}

export default async function InboxPage({
  searchParams
}: {
  searchParams?: { conversation?: string };
}) {
  const authorization = await requirePagePermission("inbox", "access");
  const companyId = requireCompanyId(authorization);
  const data = await loadInboxData(companyId, searchParams?.conversation);
  const canReply = hasPermission(authorization, "inbox", "add") || hasPermission(authorization, "inbox", "edit");

  return (
    <AppShell active="Inbox" pageCode="inbox">
      <PageHead
        title="Inbox"
        action={<NotificationPermissionButton />}
      />

      {data.error ? (
        <section className="panel message-panel error">
          <div className="panel-body">
            <strong>Inbox setup needed</strong>
            <p className="subtle" style={{ marginTop: 6 }}>{data.error}</p>
          </div>
        </section>
      ) : (
        <InboxPanel
          canReply={canReply}
          initialConversations={data.conversations}
          initialMessages={data.messages}
          initialSelectedConversationId={data.selectedConversationId}
          templates={data.templates}
        />
      )}
    </AppShell>
  );
}
