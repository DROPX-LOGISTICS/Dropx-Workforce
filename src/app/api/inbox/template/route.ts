import { NextResponse } from "next/server";
import { extractWhatsAppTemplateVariables, type WhatsAppTemplateComponent } from "@/lib/whatsapp-template";
import { loadInboxSnapshot, normalizeMobile, requireInboxAccess } from "@/lib/inbox-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getWhatsAppTemplateHeaderMediaType } from "@/lib/whatsapp-template";
import { templateHeaderMediaComponent, uploadWhatsAppMedia } from "@/lib/whatsapp-media";

export const dynamic = "force-dynamic";

type MappingRule = {
  mode?: "field" | "constant";
  value?: string;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function mappedValue(rule: MappingRule | undefined, values: Record<string, string>) {
  if (!rule?.value) return "";
  return rule.mode === "constant" ? rule.value : values[rule.value] ?? "";
}

function renderMessageText(components: WhatsAppTemplateComponent[], mappings: Record<string, MappingRule>, values: Record<string, string>, fallback: string) {
  const lines = components
    .filter((component) => ["HEADER", "BODY"].includes(String(component.type ?? "").toUpperCase()) && component.text)
    .map((component) => {
      const normalizedType = String(component.type ?? "").toLowerCase();
      return String(component.text ?? "").replace(/\{\{(\d+)\}\}/g, (_, position: string) => mappedValue(mappings[`${normalizedType}.${position}`], values));
    })
    .filter(Boolean);
  return lines.join("\n\n").trim() || `[${fallback}]`;
}

export async function POST(request: Request) {
  try {
    const guard = await requireInboxAccess("add");
    if (guard.response) return guard.response;
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const contentType = request.headers.get("content-type") ?? "";
    let conversationId = "";
    let templateId = "";
    let mappings: Record<string, MappingRule> = {};
    let headerMediaFile: File | null = null;
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      conversationId = clean(formData.get("conversationId"));
      templateId = clean(formData.get("templateId"));
      mappings = JSON.parse(clean(formData.get("mappings")) || "{}") as Record<string, MappingRule>;
      const file = formData.get("headerMediaFile");
      headerMediaFile = file instanceof File && file.size ? file : null;
    } else {
      const body = await request.json() as { conversationId?: string; templateId?: string; mappings?: Record<string, MappingRule> };
      conversationId = clean(body.conversationId);
      templateId = clean(body.templateId);
      mappings = body.mappings ?? {};
    }
    if (!conversationId) throw new Error("Select a conversation.");
    if (!templateId) throw new Error("Select a WhatsApp template.");

    const conversationResult = await supabaseAdmin
      .from("inbox_conversations")
      .select("id, channel, whatsapp_profile_id, whatsapp_profile_name, contact_external_id, contact_name, contact_phone, status")
      .eq("company_id", guard.companyId!)
      .eq("id", conversationId)
      .single();
    if (conversationResult.error) throw new Error(conversationResult.error.message);
    const conversation = conversationResult.data;
    if (!conversation.whatsapp_profile_id) throw new Error("This conversation is not linked to a WhatsApp sender profile.");

    const [profileResult, tokenResult, templateResult] = await Promise.all([
      supabaseAdmin
        .from("whatsapp_profiles")
        .select("id, profile_name, phone_number_id, graph_api_version, is_active")
        .eq("company_id", guard.companyId!)
        .eq("id", conversation.whatsapp_profile_id)
        .single(),
      supabaseAdmin.rpc("get_whatsapp_profile_access_token", { profile_id: conversation.whatsapp_profile_id }),
      supabaseAdmin
        .from("whatsapp_template_cache")
        .select("template_id, whatsapp_profile_id, name, language, status, components")
        .eq("company_id", guard.companyId!)
        .eq("template_id", templateId)
        .eq("whatsapp_profile_id", conversation.whatsapp_profile_id)
        .single()
    ]);
    if (profileResult.error) throw new Error(profileResult.error.message);
    if (tokenResult.error) throw new Error(tokenResult.error.message);
    if (templateResult.error) throw new Error(templateResult.error.message);
    const profile = profileResult.data;
    const template = templateResult.data;
    if (!profile.is_active) throw new Error("Selected WhatsApp profile is inactive.");
    if (!tokenResult.data) throw new Error("WhatsApp profile access token is missing.");
    if (template.status !== "APPROVED") throw new Error("Only approved WhatsApp templates can be sent.");

    const to = normalizeMobile(conversation.contact_external_id || conversation.contact_phone);
    if (!to) throw new Error("Contact mobile number is missing.");

    const values: Record<string, string> = {
      contact_name: conversation.contact_name ?? "",
      contact_phone: conversation.contact_phone ?? "",
      profile_name: profile.profile_name ?? conversation.whatsapp_profile_name ?? "",
      phone_number_id: profile.phone_number_id ?? "",
      channel: conversation.channel ?? "whatsapp"
    };
    const components = (template.components ?? []) as WhatsAppTemplateComponent[];
    const variables = extractWhatsAppTemplateVariables(components);
    const headerMediaType = getWhatsAppTemplateHeaderMediaType(components);
    if (headerMediaType && !headerMediaFile) throw new Error(`Upload the ${headerMediaType} required by this template header.`);
    const missing = variables.filter((variable) => !mappedValue(mappings[variable.key], values));
    if (missing.length) throw new Error(`Map all template variables: ${missing.map((variable) => variable.label).join(", ")}.`);

    const messageComponents: Array<Record<string, unknown>> = [];
    let headerMediaId: string | null = null;
    if (headerMediaType && headerMediaFile) {
      headerMediaId = await uploadWhatsAppMedia({
        file: headerMediaFile,
        graphApiVersion: profile.graph_api_version,
        phoneNumberId: profile.phone_number_id,
        accessToken: tokenResult.data
      });
      messageComponents.push(templateHeaderMediaComponent(headerMediaType, headerMediaId, headerMediaFile.name));
    }
    (["header", "body"] as const).forEach((componentType) => {
      const componentVariables = variables.filter((variable) => variable.component === componentType).sort((first, second) => first.position - second.position);
      if (!componentVariables.length) return;
      messageComponents.push({
        type: componentType,
        parameters: componentVariables.map((variable) => ({ type: "text", text: mappedValue(mappings[variable.key], values) }))
      });
    });
    variables.filter((variable) => variable.component === "button").forEach((variable) => {
      messageComponents.push({
        type: "button",
        sub_type: "url",
        index: String(variable.buttonIndex ?? 0),
        parameters: [{ type: "text", text: mappedValue(mappings[variable.key], values) }]
      });
    });

    const requestPayload = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: template.name,
        language: { code: template.language },
        components: messageComponents
      }
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
    if (!response.ok) throw new Error(responsePayload.error?.message || "Meta rejected the WhatsApp template.");
    const providerMessageId = responsePayload.messages?.[0]?.id ?? null;
    const now = new Date().toISOString();
    const messageText = renderMessageText(components, mappings, values, template.name);

    const insertResult = await supabaseAdmin
      .from("inbox_messages")
      .insert({
        company_id: guard.companyId!,
        conversation_id: conversation.id,
        channel: "whatsapp",
        whatsapp_profile_id: profile.id,
        direction: "outgoing",
        provider_message_id: providerMessageId,
        message_type: "template",
        message_text: messageText,
        contact_external_id: conversation.contact_external_id,
        contact_name: conversation.contact_name,
        contact_phone: conversation.contact_phone,
        payload: {
          request: requestPayload,
          response: responsePayload,
          template_id: template.template_id,
          template_name: template.name,
          header_media_type: headerMediaType,
          header_media_id: headerMediaId,
          header_media_filename: headerMediaFile?.name ?? null,
          sender_name: guard.authorization?.fullName || guard.authorization?.email || "Dashboard user",
          sender_email: guard.authorization?.email ?? null,
          sender_user_id: guard.authorization?.userId ?? null
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
        last_message_preview: messageText,
        last_message_at: now,
        status: "open",
        updated_at: now
      })
      .eq("company_id", guard.companyId!)
      .eq("id", conversation.id);

    await supabaseAdmin.from("whatsapp_message_logs").insert({
      company_id: guard.companyId!,
      event_code: "inbox_template",
      whatsapp_profile_id: profile.id,
      whatsapp_profile_name: profile.profile_name,
      recipient: to,
      template_name: template.name,
      status: "sent",
      provider_message_id: providerMessageId,
      request_payload: requestPayload,
      response_payload: responsePayload
    });

    return NextResponse.json({ snapshot: await loadInboxSnapshot(guard.companyId!, conversation.id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to send template." }, { status: 500 });
  }
}
