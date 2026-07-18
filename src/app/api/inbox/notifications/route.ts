import { NextResponse } from "next/server";
import { getAuthorization, hasPermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

function safeSince(value: string | null) {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return new Date(Date.now() - 30_000).toISOString();
  }
  return parsed.toISOString();
}

export async function GET(request: Request) {
  try {
    const authorization = await getAuthorization();
    if (!authorization || !hasPermission(authorization, "inbox", "access")) {
      return NextResponse.json({ messages: [] }, { status: authorization ? 403 : 401 });
    }
    const companyId = requireCompanyId(authorization);
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const url = new URL(request.url);
    const since = safeSince(url.searchParams.get("since"));
    const profileResult = await supabaseAdmin
      .from("whatsapp_profiles")
      .select("id, chat_enabled")
      .eq("company_id", companyId)
      .eq("chat_enabled", true);
    if (profileResult.error && !profileResult.error.message.includes("chat_enabled")) throw new Error(profileResult.error.message);
    const enabledProfileIds = profileResult.error?.message.includes("chat_enabled")
      ? null
      : (profileResult.data ?? []).map((profile) => profile.id);

    let query = supabaseAdmin
      .from("inbox_messages")
      .select(`
        id,
        whatsapp_profile_id,
        message_text,
        message_type,
        contact_name,
        contact_phone,
        created_at,
        inbox_conversations (
          id,
          whatsapp_profile_name
        )
      `)
      .eq("company_id", companyId)
      .eq("direction", "incoming")
      .gt("created_at", since)
      .order("created_at", { ascending: true })
      .limit(10);
    if (enabledProfileIds?.length) {
      query = query.or(`channel.neq.whatsapp,whatsapp_profile_id.in.(${enabledProfileIds.join(",")})`);
    } else if (enabledProfileIds) {
      query = query.neq("channel", "whatsapp");
    }
    const { data, error } = await query;

    if (error) throw new Error(error.message);
    return NextResponse.json({
      messages: (data ?? []).map((message) => {
        const conversation = (Array.isArray(message.inbox_conversations)
          ? message.inbox_conversations[0]
          : message.inbox_conversations) as { id?: string; whatsapp_profile_name?: string | null } | null;
        return {
        id: message.id,
        contactName: message.contact_name,
        contactPhone: message.contact_phone,
        text: message.message_text,
        type: message.message_type,
        createdAt: message.created_at,
        conversationId: conversation?.id ?? null,
        profileName: conversation?.whatsapp_profile_name ?? null
        };
      })
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load inbox notifications." }, { status: 500 });
  }
}
