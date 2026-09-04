import { authorizeCampaignWorker, campaignWorkerHeaders } from "@/lib/workforce-campaign-worker";
import { readAllRows } from "@/lib/supabase-pagination";
import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { templateHeaderMediaComponent } from "@/lib/whatsapp-media";
import { extractWhatsAppTemplateVariables, type WhatsAppTemplateComponent, type WhatsAppTemplateHeaderMediaType } from "@/lib/whatsapp-template";

type MappingRule = {
  mode: "field" | "constant";
  value: string;
};

type CampaignMappings = Record<string, MappingRule> & {
  __header_media?: {
    type: WhatsAppTemplateHeaderMediaType;
    media_id: string;
    filename?: string;
  };
};

type CampaignRow = {
  id: string;
  company_id: string;
  campaign_code: string;
  source_mode: string;
  whatsapp_profile_id: string | null;
  whatsapp_profile_name: string | null;
  template_id: string | null;
  template_name: string;
  template_language: string;
  variable_mappings: CampaignMappings;
  status: string;
  created_by: string | null;
};

type RecipientRow = {
  id: string;
  row_no: number;
  recipient_name: string | null;
  recipient_mobile: string;
  country_code: string | null;
  source: string | null;
  source_id: string | null;
  recipient_payload: Record<string, unknown>;
};

const batchSize = 25;
const staleProcessingMs = 10 * 60 * 1000;

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeMobile(mobile: string, countryCode: string) {
  const digits = mobile.replace(/\D/g, "");
  const normalizedCountry = countryCode.replace(/\D/g, "") || "91";
  if (!digits) return "";
  if (digits.startsWith(normalizedCountry) && digits.length > 10) return digits;
  if (digits.length === 10) return `${normalizedCountry}${digits}`;
  return digits;
}

function recipientValues(recipient: RecipientRow) {
  const payload = recipient.recipient_payload ?? {};
  const values: Record<string, string> = {
    name: clean(recipient.recipient_name ?? payload.name),
    full_name: clean(recipient.recipient_name ?? payload.name),
    mobile: clean(recipient.recipient_mobile),
    email: clean(payload.email),
    source: clean(recipient.source ?? payload.source),
    location: clean(payload.location),
    role: clean(payload.role),
    country_code: clean(recipient.country_code ?? payload.country_code)
  };
  Object.entries(payload).forEach(([key, value]) => {
    values[key] = clean(value);
  });
  return values;
}

function mappedValue(rule: MappingRule | undefined, values: Record<string, string>) {
  if (!rule) return "";
  if (rule.mode === "constant") return rule.value;
  return values[rule.value] ?? "";
}

function renderTemplateText(components: WhatsAppTemplateComponent[], mappings: Record<string, MappingRule>, values: Record<string, string>, fallback: string) {
  const lines = components
    .filter((component) => ["HEADER", "BODY"].includes(String(component.type ?? "").toUpperCase()) && component.text)
    .map((component) => {
      const normalizedType = String(component.type ?? "").toLowerCase();
      return String(component.text ?? "").replace(/\{\{(\d+)\}\}/g, (_, position: string) => {
        return mappedValue(mappings[`${normalizedType}.${position}`], values);
      });
    })
    .filter(Boolean);
  return lines.join("\n\n").trim() || `[${fallback}]`;
}

async function syncCampaignMessageToInbox({
  campaign,
  profile,
  recipient,
  to,
  messageText,
  providerMessageId,
  status,
  requestPayload,
  responsePayload,
  senderName,
  errorMessage
}: {
  campaign: CampaignRow;
  profile: { id: string; profile_name: string | null };
  recipient: RecipientRow;
  to: string;
  messageText: string;
  providerMessageId: string | null;
  status: "sent" | "failed";
  requestPayload: Record<string, unknown>;
  responsePayload: unknown;
  senderName: string;
  errorMessage: string | null;
}) {
  if (!supabaseAdmin || !to) return;
  const now = new Date().toISOString();
  const contactName = clean(recipient.recipient_name) || clean(recipient.recipient_payload?.name) || clean(recipient.recipient_payload?.full_name) || null;
  const existingConversation = await supabaseAdmin
    .from("inbox_conversations")
    .select("id, status")
    .eq("company_id", campaign.company_id)
    .eq("channel", "whatsapp")
    .eq("whatsapp_profile_id", profile.id)
    .eq("contact_external_id", to)
    .maybeSingle();
  if (existingConversation.error) throw new Error(existingConversation.error.message);

  const conversationPayload = {
      company_id: campaign.company_id,
      channel: "whatsapp",
      whatsapp_profile_id: profile.id,
      whatsapp_profile_name: profile.profile_name,
      contact_external_id: to,
      contact_name: contactName,
      contact_phone: to,
      last_message_preview: messageText,
      last_message_at: now,
      updated_at: now
  };
  const conversationResult = existingConversation.data
    ? await supabaseAdmin
      .from("inbox_conversations")
      .update(conversationPayload)
      .eq("id", existingConversation.data.id)
      .eq("company_id", campaign.company_id)
      .select("id")
      .single()
    : await supabaseAdmin
      .from("inbox_conversations")
      .insert({ ...conversationPayload, status: "closed" })
    .select("id")
    .single();
  if (conversationResult.error) throw new Error(conversationResult.error.message);

  const messagePayload = {
    request: requestPayload,
    response: responsePayload,
    campaign_id: campaign.id,
    campaign_code: campaign.campaign_code,
    sender_name: senderName,
    sender_user_id: campaign.created_by,
    error_message: errorMessage
  };

  if (providerMessageId) {
    const existing = await supabaseAdmin
      .from("inbox_messages")
      .select("id")
      .eq("company_id", campaign.company_id)
      .eq("provider_message_id", providerMessageId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data) {
      await supabaseAdmin
        .from("inbox_messages")
        .update({ status, payload: messagePayload })
        .eq("company_id", campaign.company_id)
        .eq("id", existing.data.id);
      return;
    }
  }

  const insertResult = await supabaseAdmin.from("inbox_messages").insert({
    company_id: campaign.company_id,
    conversation_id: conversationResult.data.id,
    channel: "whatsapp",
    whatsapp_profile_id: profile.id,
    direction: "outgoing",
    provider_message_id: providerMessageId,
    message_type: "template",
    message_text: messageText,
    contact_external_id: to,
    contact_name: contactName,
    contact_phone: to,
    payload: messagePayload,
    status,
    message_timestamp: now
  });
  if (insertResult.error) throw new Error(insertResult.error.message);
}

async function updateCampaignCounts(campaignId: string) {
  if (!supabaseAdmin) return 0;
  const { data, error } = await readAllRows(supabaseAdmin
    .from("whatsapp_campaign_recipients")
    .select("status")
    .eq("campaign_id", campaignId).order("id"));
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const sent = rows.filter((row) => ["sent", "delivered", "read"].includes(row.status)).length;
  const failed = rows.filter((row) => row.status === "failed").length;
  const pending = rows.filter((row) => row.status === "pending" || row.status === "processing").length;
  const updated = await supabaseAdmin
    .from("whatsapp_campaigns")
    .update({
      sent_count: sent,
      failed_count: failed,
      pending_count: pending,
      status: pending === 0 ? "completed" : "processing",
      completed_at: pending === 0 ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    })
    .eq("id", campaignId);
  if (updated.error) throw new Error(updated.error.message);
  return pending;
}

async function reclaimStaleProcessingRecipients(campaignId: string) {
  if (!supabaseAdmin) return;
  const staleBefore = new Date(Date.now() - staleProcessingMs).toISOString();
  await supabaseAdmin
    .from("whatsapp_campaign_recipients")
    .update({ status: "failed", error_message: "Delivery outcome unknown after worker timeout. Reconcile with the provider before resending.", updated_at: new Date().toISOString() })
    .eq("campaign_id", campaignId)
    .eq("status", "processing")
    .or(`updated_at.is.null,updated_at.lt.${staleBefore}`);
}

async function processBatch(campaignId: string | null) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

  let campaignQuery = supabaseAdmin
    .from("whatsapp_campaigns")
    .select("id, company_id, campaign_code, source_mode, whatsapp_profile_id, whatsapp_profile_name, template_id, template_name, template_language, variable_mappings, status, created_by")
    .in("status", ["queued", "processing"])
    .gt("pending_count", 0)
    .order("created_at", { ascending: true })
    .limit(1);
  if (campaignId) campaignQuery = campaignQuery.eq("id", campaignId);
  const campaignResult = await campaignQuery.maybeSingle();
  if (campaignResult.error) throw new Error(campaignResult.error.message);
  const campaign = campaignResult.data as CampaignRow | null;
  if (!campaign) return { processed: 0, sent: 0, failed: 0, pending: 0, campaignCode: null, campaignId: null };

  await supabaseAdmin
    .from("whatsapp_campaigns")
    .update({ status: "processing", started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", campaign.id)
    .is("started_at", null);

  await reclaimStaleProcessingRecipients(campaign.id);

  const recipientsResult = await supabaseAdmin
    .from("whatsapp_campaign_recipients")
    .select("id, row_no, recipient_name, recipient_mobile, country_code, source, source_id, recipient_payload")
    .eq("campaign_id", campaign.id)
    .eq("status", "pending")
    .order("row_no", { ascending: true })
    .limit(batchSize);
  if (recipientsResult.error) throw new Error(recipientsResult.error.message);
  const recipients = (recipientsResult.data ?? []) as RecipientRow[];
  if (!recipients.length) {
    const pending = await updateCampaignCounts(campaign.id);
    return { processed: 0, sent: 0, failed: 0, pending, campaignCode: campaign.campaign_code, campaignId: campaign.id };
  }

  if (!campaign.whatsapp_profile_id) throw new Error(`Campaign ${campaign.campaign_code} does not have a WhatsApp profile.`);

  const [settingsResult, profileResult, tokenResult, templateResult, creatorResult] = await Promise.all([
    supabaseAdmin.from("whatsapp_settings").select("is_enabled").eq("company_id", campaign.company_id).eq("id", true).maybeSingle(),
    supabaseAdmin.from("whatsapp_profiles").select("id, profile_name, phone_number_id, graph_api_version, default_country_code, is_active").eq("company_id", campaign.company_id).eq("id", campaign.whatsapp_profile_id).single(),
    supabaseAdmin.rpc("get_whatsapp_profile_access_token", { profile_id: campaign.whatsapp_profile_id }),
    supabaseAdmin.from("whatsapp_template_cache").select("components").eq("company_id", campaign.company_id).eq("template_id", campaign.template_id).single(),
    campaign.created_by
      ? supabaseAdmin.from("profiles").select("full_name, email").eq("id", campaign.created_by).maybeSingle()
      : Promise.resolve({ data: null, error: null })
  ]);
  if (settingsResult.error) throw new Error(settingsResult.error.message);
  if (profileResult.error) throw new Error(profileResult.error.message);
  if (tokenResult.error) throw new Error(tokenResult.error.message);
  if (templateResult.error) throw new Error(templateResult.error.message);
  if (creatorResult.error) throw new Error(creatorResult.error.message);
  const settings = settingsResult.data;
  const profile = profileResult.data;
  const senderName = clean(creatorResult.data?.full_name) || clean(creatorResult.data?.email) || "Bulk WhatsApp";
  if (!settings?.is_enabled) throw new Error("WhatsApp notifications are disabled in Settings.");
  if (!profile?.is_active) throw new Error("WhatsApp profile is inactive.");
  if (!profile.phone_number_id || !profile.graph_api_version || !tokenResult.data) throw new Error("WhatsApp profile settings are incomplete.");

  const variables = extractWhatsAppTemplateVariables((templateResult.data.components ?? []) as WhatsAppTemplateComponent[]);
  let sent = 0;
  let failed = 0;

  for (const recipient of recipients) {
    const claim = await supabaseAdmin
      .from("whatsapp_campaign_recipients")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", recipient.id).eq("company_id", campaign.company_id)
      .eq("status", "pending").select("id").maybeSingle();
    if (claim.error) throw new Error(claim.error.message);
    if (!claim.data) continue;

    const values = recipientValues(recipient);
    const to = normalizeMobile(values.mobile, values.country_code || profile.default_country_code || "91");
    const messageComponents: Array<Record<string, unknown>> = [];
    const headerMedia = campaign.variable_mappings.__header_media;
    if (headerMedia?.type && headerMedia.media_id) {
      messageComponents.push(templateHeaderMediaComponent(headerMedia.type, headerMedia.media_id, headerMedia.filename));
    }
    (["header", "body"] as const).forEach((componentType) => {
      const componentVariables = variables
        .filter((variable) => variable.component === componentType)
        .sort((first, second) => first.position - second.position);
      if (!componentVariables.length) return;
      messageComponents.push({
        type: componentType,
        parameters: componentVariables.map((variable) => ({ type: "text", text: mappedValue(campaign.variable_mappings[variable.key], values) }))
      });
    });
    variables.filter((variable) => variable.component === "button").forEach((variable) => {
      messageComponents.push({
        type: "button",
        sub_type: "url",
        index: String(variable.buttonIndex ?? 0),
        parameters: [{ type: "text", text: mappedValue(campaign.variable_mappings[variable.key], values) }]
      });
    });

    const requestPayload = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: campaign.template_name,
        language: { code: campaign.template_language },
        components: messageComponents
      }
    };
    const messageText = renderTemplateText((templateResult.data.components ?? []) as WhatsAppTemplateComponent[], campaign.variable_mappings, values, campaign.template_name);

    let status: "sent" | "failed" = "failed";
    let providerMessageId: string | null = null;
    let errorMessage: string | null = null;
    let responsePayload: unknown = null;
    try {
      const response = await fetch(`https://graph.facebook.com/${profile.graph_api_version}/${profile.phone_number_id}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenResult.data}`, "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload)
      });
      responsePayload = await response.json();
      if (!response.ok) {
        const payload = responsePayload as { error?: { message?: string } };
        throw new Error(payload.error?.message || "Meta rejected the WhatsApp message.");
      }
      const payload = responsePayload as { messages?: Array<{ id?: string }> };
      providerMessageId = payload.messages?.[0]?.id ?? null;
      status = "sent";
      sent += 1;
    } catch (error) {
      failed += 1;
      errorMessage = error instanceof Error ? error.message : "Unable to send WhatsApp message.";
    }

    await supabaseAdmin.from("whatsapp_campaign_recipients").update({
      status,
      provider_message_id: providerMessageId,
      error_message: errorMessage,
      request_payload: requestPayload,
      response_payload: responsePayload,
      sent_at: status === "sent" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    }).eq("id", recipient.id);

    await syncCampaignMessageToInbox({
      campaign,
      profile,
      recipient,
      to,
      messageText,
      providerMessageId,
      status,
      requestPayload,
      responsePayload,
      senderName,
      errorMessage
    });

    await supabaseAdmin.from("whatsapp_message_logs").insert({
      company_id: campaign.company_id,
      event_code: "bulk_whatsapp",
      whatsapp_profile_id: profile.id,
      whatsapp_profile_name: profile.profile_name,
      recipient: to,
      template_name: campaign.template_name,
      status,
      provider_message_id: providerMessageId,
      error_message: errorMessage,
      request_payload: {
        campaign_id: campaign.id,
        campaign_code: campaign.campaign_code,
        source_mode: campaign.source_mode,
        source: recipient.source,
        source_id: recipient.source_id,
        recipient_name: recipient.recipient_name,
        mapped_variables: Object.keys(campaign.variable_mappings)
      },
      response_payload: responsePayload
    });
  }

  const pending = await updateCampaignCounts(campaign.id);
  return { processed: recipients.length, sent, failed, pending, campaignCode: campaign.campaign_code, campaignId: campaign.id };
}

function continueIfNeeded(origin: string, result: { pending: number; processed: number; campaignId: string | null }) {
  if (result.pending > 0 && result.processed > 0 && result.campaignId) {
    waitUntil(fetch(new URL("/api/whatsapp/process-campaigns", origin), { method: "POST", headers: campaignWorkerHeaders(result.campaignId!) }));
  }
}

export async function POST(request: Request) {
  try {
    const authorization = authorizeCampaignWorker(request);
    if (!authorization) return NextResponse.json({ error: "Unauthorized campaign worker." }, { status: 401 });
    const result = await processBatch(authorization.campaignId);
    continueIfNeeded(request.url, result);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to process WhatsApp campaigns." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const authorization = authorizeCampaignWorker(request);
    if (!authorization) return NextResponse.json({ error: "Unauthorized campaign worker." }, { status: 401 });
    const result = await processBatch(authorization.campaignId);
    continueIfNeeded(request.url, result);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to process WhatsApp campaigns." }, { status: 500 });
  }
}
