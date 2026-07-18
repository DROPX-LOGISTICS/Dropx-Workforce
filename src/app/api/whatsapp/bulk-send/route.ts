import { NextResponse, type NextRequest } from "next/server";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { extractWhatsAppTemplateVariables, type WhatsAppTemplateComponent } from "@/lib/whatsapp-template";

type BulkRecipient = {
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

type MappingRule = {
  mode: "field" | "constant";
  value: string;
};

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

function recipientValues(recipient: BulkRecipient) {
  const values: Record<string, string> = {
    name: clean(recipient.name),
    full_name: clean(recipient.name),
    mobile: clean(recipient.mobile),
    email: clean(recipient.email),
    source: clean(recipient.source),
    location: clean(recipient.location),
    role: clean(recipient.role),
    country_code: clean(recipient.country_code)
  };
  Object.entries(recipient).forEach(([key, value]) => {
    values[key] = clean(value);
  });
  return values;
}

function mappedValue(rule: MappingRule | undefined, values: Record<string, string>) {
  if (!rule) return "";
  if (rule.mode === "constant") return rule.value;
  return values[rule.value] ?? "";
}

export async function POST(request: NextRequest) {
  const authorization = await requirePagePermission("notifications_whatsapp", "add");
  const companyId = requireCompanyId(authorization);
  if (!supabaseAdmin) return NextResponse.json({ error: "Supabase service role key is not configured." }, { status: 500 });

  try {
    const body = await request.json() as {
      templateId?: string;
      whatsappProfileId?: string;
      mappings?: Record<string, MappingRule>;
      recipient?: BulkRecipient;
      sourceMode?: string;
    };
    const templateId = clean(body.templateId);
    const requestedProfileId = clean(body.whatsappProfileId);
    const recipient = body.recipient ?? {};
    const mappings = body.mappings ?? {};
    if (!templateId) return NextResponse.json({ error: "Select a WhatsApp template." }, { status: 400 });
    if (!clean(recipient.mobile)) return NextResponse.json({ error: "Recipient mobile number is missing." }, { status: 400 });

    const profileQuery = supabaseAdmin
      .from("whatsapp_profiles")
      .select("id, profile_name, phone_number_id, graph_api_version, default_country_code, is_active")
      .eq("company_id", companyId)
      .eq(requestedProfileId ? "id" : "is_default", requestedProfileId || true)
      .maybeSingle();
    const [settingsResult, profileResult, templateResult] = await Promise.all([
      supabaseAdmin.from("whatsapp_settings").select("is_enabled").eq("company_id", companyId).eq("id", true).maybeSingle(),
      profileQuery,
      supabaseAdmin
        .from("whatsapp_template_cache")
        .select("template_id, whatsapp_profile_id, name, language, status, components")
        .eq("company_id", companyId)
        .eq("template_id", templateId)
        .single()
    ]);
    if (settingsResult.error) throw new Error(settingsResult.error.message);
    if (profileResult.error) throw new Error(profileResult.error.message);
    if (templateResult.error) throw new Error(templateResult.error.message);

    const settings = settingsResult.data;
    const profile = profileResult.data;
    const template = templateResult.data;
    if (!settings?.is_enabled) throw new Error("WhatsApp notifications are disabled in Settings.");
    if (!profile?.is_active) throw new Error("Selected WhatsApp profile is inactive.");
    const tokenResult = await supabaseAdmin.rpc("get_whatsapp_profile_access_token", { profile_id: profile.id });
    if (tokenResult.error) throw new Error(tokenResult.error.message);
    if (!profile.phone_number_id || !profile.graph_api_version || !tokenResult.data) throw new Error("WhatsApp profile settings are incomplete.");
    if (template.whatsapp_profile_id !== profile.id) throw new Error("Selected template does not belong to the selected WhatsApp profile.");
    if (template.status !== "APPROVED") throw new Error("Only approved WhatsApp templates can be used.");

    const variables = extractWhatsAppTemplateVariables((template.components ?? []) as WhatsAppTemplateComponent[]);
    const missing = variables.filter((variable) => !mappings[variable.key]?.value);
    if (missing.length) throw new Error(`Map all template variables: ${missing.map((item) => item.label).join(", ")}.`);

    const values = recipientValues(recipient);
    const recipientCountry = clean(recipient.country_code) || profile.default_country_code || "91";
    const to = normalizeMobile(values.mobile, recipientCountry);
    if (!to) return NextResponse.json({ error: "Recipient mobile number is invalid." }, { status: 400 });

    const messageComponents: Array<Record<string, unknown>> = [];
    (["header", "body"] as const).forEach((componentType) => {
      const componentVariables = variables
        .filter((variable) => variable.component === componentType)
        .sort((first, second) => first.position - second.position);
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

    let providerMessageId: string | null = null;
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
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unable to send WhatsApp message.";
      await supabaseAdmin.from("whatsapp_message_logs").insert({
        company_id: companyId,
        event_code: "bulk_whatsapp",
        whatsapp_profile_id: profile.id,
        whatsapp_profile_name: profile.profile_name,
        recipient: to,
        template_name: template.name,
        status: "failed",
        provider_message_id: null,
        error_message: errorMessage,
        request_payload: {
          source_mode: body.sourceMode ?? null,
          source: recipient.source ?? null,
          source_id: recipient.id ?? null,
          recipient_name: recipient.name ?? null,
          mapped_variables: Object.keys(mappings),
          triggered_by: authorization.userId
        },
        response_payload: responsePayload
      });
      return NextResponse.json({ error: errorMessage }, { status: 502 });
    }

    await supabaseAdmin.from("whatsapp_message_logs").insert({
      company_id: companyId,
      event_code: "bulk_whatsapp",
      whatsapp_profile_id: profile.id,
      whatsapp_profile_name: profile.profile_name,
      recipient: to,
      template_name: template.name,
      status: "sent",
      provider_message_id: providerMessageId,
      error_message: null,
      request_payload: {
        source_mode: body.sourceMode ?? null,
        source: recipient.source ?? null,
        source_id: recipient.id ?? null,
        recipient_name: recipient.name ?? null,
        mapped_variables: Object.keys(mappings),
        triggered_by: authorization.userId
      },
      response_payload: responsePayload
    });

    return NextResponse.json({ sent: true, providerMessageId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to send WhatsApp message." }, { status: 500 });
  }
}
