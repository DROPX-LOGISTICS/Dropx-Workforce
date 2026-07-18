import { NextResponse, type NextRequest } from "next/server";
import { waitUntil } from "@vercel/functions";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { uploadWhatsAppMedia } from "@/lib/whatsapp-media";
import { extractWhatsAppTemplateVariables, getWhatsAppTemplateHeaderMediaType, type WhatsAppTemplateComponent, type WhatsAppTemplateHeaderMediaType } from "@/lib/whatsapp-template";

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

type CampaignRecipient = {
  id?: string;
  source?: string;
  name?: string;
  mobile?: string;
  email?: string;
  location?: string;
  role?: string;
  country_code?: string;
  [key: string]: unknown;
};

const maxCampaignRecipients = 10000;
const recipientInsertBatchSize = 1000;

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(request: NextRequest) {
  const authorization = await requirePagePermission("notifications_whatsapp", "add");
  const companyId = requireCompanyId(authorization);
  if (!supabaseAdmin) return NextResponse.json({ error: "Supabase service role key is not configured." }, { status: 500 });

  try {
    const contentType = request.headers.get("content-type") ?? "";
    let sourceMode = "database";
    let templateId = "";
    let whatsappProfileId = "";
    let mappings: CampaignMappings = {};
    let recipients: CampaignRecipient[] = [];
    let headerMediaFile: File | null = null;
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      sourceMode = clean(formData.get("sourceMode")) || "database";
      templateId = clean(formData.get("templateId"));
      whatsappProfileId = clean(formData.get("whatsappProfileId"));
      mappings = JSON.parse(clean(formData.get("mappings")) || "{}") as CampaignMappings;
      recipients = JSON.parse(clean(formData.get("recipients")) || "[]") as CampaignRecipient[];
      const file = formData.get("headerMediaFile");
      headerMediaFile = file instanceof File && file.size ? file : null;
    } else {
      const body = await request.json() as {
        sourceMode?: string;
        templateId?: string;
        whatsappProfileId?: string;
        mappings?: Record<string, MappingRule>;
        recipients?: CampaignRecipient[];
      };
      templateId = clean(body.templateId);
      whatsappProfileId = clean(body.whatsappProfileId);
      sourceMode = clean(body.sourceMode) || "database";
      mappings = body.mappings ?? {};
      recipients = body.recipients ?? [];
    }
    recipients = recipients.filter((recipient) => clean(recipient.mobile));

    if (!templateId) throw new Error("Select a WhatsApp template.");
    if (!whatsappProfileId) throw new Error("Select a WhatsApp profile.");
    if (!recipients.length) throw new Error("No valid mobile numbers found.");
    if (recipients.length > maxCampaignRecipients) {
      throw new Error(`Maximum ${maxCampaignRecipients.toLocaleString("en-IN")} recipients allowed per campaign.`);
    }

    const [settingsResult, profileResult, templateResult] = await Promise.all([
      supabaseAdmin.from("whatsapp_settings").select("is_enabled").eq("company_id", companyId).eq("id", true).maybeSingle(),
      supabaseAdmin.from("whatsapp_profiles").select("id, profile_name, phone_number_id, graph_api_version, is_active, token_secret_id").eq("company_id", companyId).eq("id", whatsappProfileId).single(),
      supabaseAdmin.from("whatsapp_template_cache").select("template_id, whatsapp_profile_id, name, language, status, components").eq("company_id", companyId).eq("template_id", templateId).single()
    ]);
    if (settingsResult.error) throw new Error(settingsResult.error.message);
    if (profileResult.error) throw new Error(profileResult.error.message);
    if (templateResult.error) throw new Error(templateResult.error.message);
    if (!settingsResult.data?.is_enabled) throw new Error("WhatsApp notifications are disabled in Settings.");
    if (!profileResult.data?.is_active) throw new Error("Selected WhatsApp profile is inactive.");
    if (!profileResult.data?.token_secret_id) throw new Error("Selected WhatsApp profile does not have an access token.");
    if (templateResult.data.whatsapp_profile_id !== profileResult.data.id) throw new Error("Selected template does not belong to the selected WhatsApp profile.");
    if (templateResult.data.status !== "APPROVED") throw new Error("Only approved WhatsApp templates can be used.");

    const components = (templateResult.data.components ?? []) as WhatsAppTemplateComponent[];
    const variables = extractWhatsAppTemplateVariables(components);
    const headerMediaType = getWhatsAppTemplateHeaderMediaType(components);
    if (headerMediaType && !headerMediaFile) throw new Error(`Upload the ${headerMediaType} required by the selected template header.`);
    const missing = variables.filter((variable) => !mappings[variable.key]?.value);
    if (missing.length) throw new Error(`Map all template variables: ${missing.map((item) => item.label).join(", ")}.`);

    if (headerMediaType && headerMediaFile) {
      const tokenResult = await supabaseAdmin.rpc("get_whatsapp_profile_access_token", { profile_id: profileResult.data.id });
      if (tokenResult.error) throw new Error(tokenResult.error.message);
      if (!profileResult.data.phone_number_id || !profileResult.data.graph_api_version || !tokenResult.data) throw new Error("WhatsApp profile settings are incomplete.");
      const mediaId = await uploadWhatsAppMedia({
        file: headerMediaFile,
        graphApiVersion: profileResult.data.graph_api_version,
        phoneNumberId: profileResult.data.phone_number_id,
        accessToken: tokenResult.data
      });
      mappings.__header_media = {
        type: headerMediaType,
        media_id: mediaId,
        filename: headerMediaFile.name
      };
    }

    const campaignInsert = await supabaseAdmin
      .from("whatsapp_campaigns")
      .insert({
        company_id: companyId,
        source_mode: sourceMode,
        whatsapp_profile_id: profileResult.data.id,
        whatsapp_profile_name: profileResult.data.profile_name,
        template_id: templateId,
        template_name: templateResult.data.name,
        template_language: templateResult.data.language,
        variable_mappings: mappings,
        total_count: recipients.length,
        sent_count: 0,
        failed_count: 0,
        pending_count: recipients.length,
        status: "queued",
        created_by: authorization.userId
      })
      .select("id, campaign_code")
      .single();
    if (campaignInsert.error) throw new Error(campaignInsert.error.message);

    const recipientRows = recipients.map((recipient, index) => ({
      campaign_id: campaignInsert.data.id,
      company_id: companyId,
      row_no: index + 1,
      recipient_name: clean(recipient.name) || clean(recipient.email) || clean(recipient.mobile),
      recipient_mobile: clean(recipient.mobile),
      country_code: clean(recipient.country_code),
      source: clean(recipient.source),
      source_id: clean(recipient.id),
      recipient_payload: recipient,
      status: "pending"
    }));
    for (let start = 0; start < recipientRows.length; start += recipientInsertBatchSize) {
      const batch = recipientRows.slice(start, start + recipientInsertBatchSize);
      const recipientInsert = await supabaseAdmin.from("whatsapp_campaign_recipients").insert(batch);
      if (recipientInsert.error) throw new Error(recipientInsert.error.message);
    }

    waitUntil(fetch(new URL("/api/whatsapp/process-campaigns", request.url), { method: "POST" }));

    return NextResponse.json({
      campaignId: campaignInsert.data.id,
      campaignCode: campaignInsert.data.campaign_code,
      total: recipients.length
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create WhatsApp campaign." }, { status: 500 });
  }
}
