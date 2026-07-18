"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import * as XLSX from "xlsx";
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

const maxBulkMessages = 250;

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function flashRedirect(params: { error?: string; notice?: string }): never {
  cookies().set("dropx_bulk_whatsapp_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 30,
    path: "/notifications/whatsapp",
    sameSite: "lax"
  });
  redirect("/notifications/whatsapp");
}

function normalizeMobile(mobile: string, countryCode: string) {
  const digits = mobile.replace(/\D/g, "");
  const normalizedCountry = countryCode.replace(/\D/g, "") || "91";
  if (!digits) return "";
  if (digits.startsWith(normalizedCountry) && digits.length > 10) return digits;
  if (digits.length === 10) return `${normalizedCountry}${digits}`;
  return digits;
}

function mappedValue(rule: MappingRule | undefined, values: Record<string, string>) {
  if (!rule) return "";
  if (rule.mode === "constant") return rule.value;
  return values[rule.value] ?? "";
}

function parseMappings(formData: FormData) {
  const raw = clean(formData.get("variable_mappings_json"));
  if (!raw) return {} as Record<string, MappingRule>;
  try {
    return JSON.parse(raw) as Record<string, MappingRule>;
  } catch {
    throw new Error("Template variable mapping is invalid.");
  }
}

async function parseUpload(file: File) {
  if (!file || file.size === 0) throw new Error("Upload an Excel or CSV file.");
  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("The uploaded file does not contain a worksheet.");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  return rows.map((row, index) => {
    const normalized: BulkRecipient = { id: `excel-${index + 1}`, source: "Excel upload" };
    Object.entries(row).forEach(([key, value]) => {
      normalized[key] = value instanceof Date ? value.toISOString().slice(0, 10) : value;
    });
    return normalized;
  });
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

export async function sendBulkWhatsApp(formData: FormData) {
  const authorization = await requirePagePermission("notifications_whatsapp", "add");
  const companyId = requireCompanyId(authorization);
  let flash: { error?: string; notice?: string };
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const templateId = clean(formData.get("template_id"));
    const sourceMode = clean(formData.get("source_mode")) || "database";
    const mappings = parseMappings(formData);
    if (!templateId) throw new Error("Select a WhatsApp template.");

    const [settingsResult, tokenResult, templateResult] = await Promise.all([
      supabaseAdmin.from("whatsapp_settings").select("is_enabled, phone_number_id, graph_api_version, default_country_code").eq("company_id", companyId).eq("id", true).maybeSingle(),
      supabaseAdmin.rpc("get_whatsapp_access_token", { company_uuid: companyId }),
      supabaseAdmin.from("whatsapp_template_cache").select("template_id, name, language, status, components").eq("company_id", companyId).eq("template_id", templateId).single()
    ]);
    if (settingsResult.error) throw new Error(settingsResult.error.message);
    if (tokenResult.error) throw new Error(tokenResult.error.message);
    if (templateResult.error) throw new Error(templateResult.error.message);
    const settings = settingsResult.data;
    const template = templateResult.data;
    if (!settings?.is_enabled) throw new Error("WhatsApp notifications are disabled in Settings.");
    if (!settings.phone_number_id || !settings.graph_api_version || !tokenResult.data) throw new Error("WhatsApp Cloud API settings are incomplete.");
    if (template.status !== "APPROVED") throw new Error("Only approved WhatsApp templates can be used.");

    const variables = extractWhatsAppTemplateVariables((template.components ?? []) as WhatsAppTemplateComponent[]);
    const missing = variables.filter((variable) => !mappings[variable.key]?.value);
    if (missing.length) throw new Error(`Map all template variables: ${missing.map((item) => item.label).join(", ")}.`);

    let recipients: BulkRecipient[] = [];
    if (sourceMode === "excel") {
      const mobileHeader = clean(formData.get("excel_mobile_header"));
      const countryCodeMode = clean(formData.get("country_code_mode")) || "default";
      const countryCodeHeader = clean(formData.get("country_code_header"));
      const countryCodeConstant = clean(formData.get("country_code_constant"));
      if (!mobileHeader) throw new Error("Select the Excel column that contains mobile numbers.");
      if (countryCodeMode === "excel" && !countryCodeHeader) throw new Error("Select the Excel column that contains country codes.");
      if (countryCodeMode === "constant" && !countryCodeConstant) throw new Error("Enter the constant country code.");
      recipients = await parseUpload(formData.get("bulk_file") as File);
      recipients = recipients.map((recipient) => ({
        ...recipient,
        mobile: clean(recipient[mobileHeader]),
        country_code:
          countryCodeMode === "excel"
            ? clean(recipient[countryCodeHeader])
            : countryCodeMode === "constant"
              ? countryCodeConstant
              : clean(recipient.country_code || recipient.CountryCode || recipient["Country Code"] || recipient.countryCode)
      }));
    } else {
      const rawRecipients = clean(formData.get("selected_recipients_json"));
      if (!rawRecipients) throw new Error("Select at least one recipient.");
      recipients = JSON.parse(rawRecipients) as BulkRecipient[];
    }
    recipients = recipients
      .filter((recipient) => clean(recipient.mobile))
      .slice(0, maxBulkMessages);
    if (!recipients.length) throw new Error("No valid mobile numbers found.");

    const countryCode = settings.default_country_code || "91";
    let sent = 0;
    let failed = 0;
    for (const recipient of recipients) {
      const values = recipientValues(recipient);
      const recipientCountry = clean(recipient.country_code) || countryCode;
      const to = normalizeMobile(values.mobile, recipientCountry);
      let status: "sent" | "failed" = "failed";
      let providerMessageId: string | null = null;
      let errorMessage: string | null = null;
      let responsePayload: unknown = null;
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

      try {
        const response = await fetch(`https://graph.facebook.com/${settings.graph_api_version}/${settings.phone_number_id}/messages`, {
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

      await supabaseAdmin.from("whatsapp_message_logs").insert({
        company_id: companyId,
        event_code: "bulk_whatsapp",
        recipient: to,
        template_name: template.name,
        status,
        provider_message_id: providerMessageId,
        error_message: errorMessage,
        request_payload: {
          source_mode: sourceMode,
          source: recipient.source ?? null,
          source_id: recipient.id ?? null,
          recipient_name: recipient.name ?? null,
          mapped_variables: Object.keys(mappings),
          triggered_by: authorization.userId
        },
        response_payload: responsePayload
      });
    }

    flash = { notice: `${sent} sent, ${failed} failed.` };
  } catch (error) {
    flash = { error: error instanceof Error ? error.message : "Unable to send bulk WhatsApp messages." };
  }
  flashRedirect(flash);
}
