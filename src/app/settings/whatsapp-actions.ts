"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { extractWhatsAppTemplateVariables, type WhatsAppTemplateComponent } from "@/lib/whatsapp-template";

function clean(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function required(value: FormDataEntryValue | null, label: string) {
  const text = clean(value);
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function settingsRedirect(params: { error?: string; notice?: string }): never {
  cookies().set("dropx_whatsapp_settings_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 20,
    path: "/settings",
    sameSite: "lax"
  });
  redirect("/settings/meta?platform=whatsapp");
}

async function accessToken(profileId?: string, companyId?: string) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  if (!companyId) throw new Error("Company scope is required for WhatsApp access token lookup.");
  let resolvedProfileId = profileId;
  if (!resolvedProfileId) {
    const profileQuery = supabaseAdmin.from("whatsapp_profiles").select("id").eq("is_default", true).eq("company_id", companyId);
    const profile = await profileQuery.maybeSingle();
    if (profile.error) throw new Error(profile.error.message);
    resolvedProfileId = profile.data?.id;
  }
  if (!resolvedProfileId) throw new Error("Create a WhatsApp profile first.");
  const { data, error } = await supabaseAdmin.rpc("get_whatsapp_profile_access_token", { profile_id: resolvedProfileId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("WhatsApp API token is not configured.");
  return String(data);
}

export async function saveWhatsAppGeneralSettings(formData: FormData) {
  const authorization = await requirePagePermission("app_settings", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const isEnabled = formData.get("is_enabled") === "on";

    const current = await supabaseAdmin
      .from("whatsapp_settings")
      .select("webhook_verify_token")
      .eq("id", true)
      .eq("company_id", companyId)
      .maybeSingle();
    if (current.error) throw new Error(current.error.message);
    const webhookVerifyToken = clean(formData.get("webhook_verify_token")) ?? current.data?.webhook_verify_token ?? null;
    if (isEnabled) {
      const profile = await supabaseAdmin.from("whatsapp_profiles").select("id").eq("company_id", companyId).eq("is_active", true).limit(1).maybeSingle();
      if (profile.error) throw new Error(profile.error.message);
      if (!profile.data?.id) throw new Error("Create at least one active WhatsApp profile before enabling WhatsApp.");
    }

    const { error } = await supabaseAdmin.from("whatsapp_settings").upsert({
      id: true,
      company_id: companyId,
      is_enabled: isEnabled,
      webhook_verify_token: webhookVerifyToken,
      updated_by: authorization.userId,
      updated_at: new Date().toISOString()
    }, { onConflict: "company_id,id" });
    if (error) throw new Error(error.message);
    revalidatePath("/settings/whatsapp");
    revalidatePath("/settings/meta");
    revalidatePath("/settings/meta-messaging");
  } catch (error) {
    settingsRedirect({ error: error instanceof Error ? error.message : "Unable to save WhatsApp settings." });
  }
  settingsRedirect({ notice: "WhatsApp general settings saved." });
}

export async function saveWhatsAppProfile(formData: FormData) {
  const authorization = await requirePagePermission("app_settings", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const profileId = clean(formData.get("profile_id"));
    const profileName = required(formData.get("profile_name"), "WhatsApp profile name");
    const businessAccountId = required(formData.get("business_account_id"), "WhatsApp Business Account ID");
    const phoneNumberId = required(formData.get("phone_number_id"), "Phone Number ID");
    const graphApiVersion = required(formData.get("graph_api_version"), "Graph API version");
    const countryCode = required(formData.get("default_country_code"), "Default country code").replace(/\D/g, "");
    const isActive = formData.get("is_active") === "on";
    const isDefault = formData.get("is_default") === "on";
    const tokenInput = clean(formData.get("access_token"));
    const token = tokenInput && /^\*+$/.test(tokenInput) ? null : tokenInput;
    if (!/^v\d+\.\d+$/.test(graphApiVersion)) throw new Error("Graph API version must look like v25.0.");
    if (!countryCode) throw new Error("Default country code is required.");

    let savedId = profileId;
    if (profileId) {
      const current = await supabaseAdmin.from("whatsapp_profiles").select("token_secret_id").eq("id", profileId).eq("company_id", companyId).single();
      if (current.error) throw new Error(current.error.message);
      const { error } = await supabaseAdmin.from("whatsapp_profiles").update({
        profile_name: profileName,
        business_account_id: businessAccountId,
        phone_number_id: phoneNumberId,
        graph_api_version: graphApiVersion,
        default_country_code: countryCode,
        is_active: isActive,
        updated_by: authorization.userId,
        updated_at: new Date().toISOString()
      }).eq("id", profileId).eq("company_id", companyId);
      if (error) throw new Error(error.message);
    } else {
      const { data, error } = await supabaseAdmin.from("whatsapp_profiles").insert({
        company_id: companyId,
        profile_name: profileName,
        business_account_id: businessAccountId,
        phone_number_id: phoneNumberId,
        graph_api_version: graphApiVersion,
        default_country_code: countryCode,
        is_active: isActive,
        is_default: false,
        updated_by: authorization.userId
      }).select("id").single();
      if (error) throw new Error(error.message);
      savedId = data.id;
    }

    if (!savedId) throw new Error("Unable to save WhatsApp profile.");
    if (token) {
      const tokenResult = await supabaseAdmin.rpc("set_whatsapp_profile_access_token", { profile_id: savedId, secret_value: token });
      if (tokenResult.error) throw new Error(tokenResult.error.message);
    }
    const saved = await supabaseAdmin.from("whatsapp_profiles").select("token_secret_id").eq("id", savedId).eq("company_id", companyId).single();
    if (saved.error) throw new Error(saved.error.message);
    if (!saved.data?.token_secret_id) throw new Error("Permanent access token is required.");
    if (isDefault) {
      await supabaseAdmin.from("whatsapp_profiles").update({ is_default: false }).eq("company_id", companyId).neq("id", savedId);
      const { error } = await supabaseAdmin.from("whatsapp_profiles").update({ is_default: true }).eq("id", savedId).eq("company_id", companyId);
      if (error) throw new Error(error.message);
    } else {
      const existingDefault = await supabaseAdmin.from("whatsapp_profiles").select("id").eq("company_id", companyId).eq("is_default", true).neq("id", savedId).limit(1).maybeSingle();
      if (existingDefault.error) throw new Error(existingDefault.error.message);
      if (!existingDefault.data?.id) {
        await supabaseAdmin.from("whatsapp_profiles").update({ is_default: true }).eq("id", savedId).eq("company_id", companyId);
      }
    }
    revalidatePath("/settings/whatsapp");
    revalidatePath("/settings/meta");
    revalidatePath("/settings/meta-messaging");
  } catch (error) {
    settingsRedirect({ error: error instanceof Error ? error.message : "Unable to save WhatsApp profile." });
  }
  settingsRedirect({ notice: "WhatsApp profile saved." });
}

export async function deleteWhatsAppProfile(formData: FormData) {
  const authorization = await requirePagePermission("app_settings", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const profileId = required(formData.get("profile_id"), "WhatsApp profile");
    const usedConfig = await supabaseAdmin.from("whatsapp_notification_configs").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("whatsapp_profile_id", profileId);
    if (usedConfig.error) throw new Error(usedConfig.error.message);
    const usedCampaign = await supabaseAdmin.from("whatsapp_campaigns").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("whatsapp_profile_id", profileId);
    if (usedCampaign.error) throw new Error(usedCampaign.error.message);
    const usedCount = (usedConfig.count ?? 0) + (usedCampaign.count ?? 0);
    if (usedCount > 0) throw new Error(`This WhatsApp profile is used in ${usedCount} configuration/campaign records and cannot be deleted.`);
    const { error } = await supabaseAdmin.from("whatsapp_profiles").delete().eq("id", profileId).eq("company_id", companyId);
    if (error) throw new Error(error.message);
    revalidatePath("/settings/whatsapp");
    revalidatePath("/settings/meta");
    revalidatePath("/settings/meta-messaging");
  } catch (error) {
    settingsRedirect({ error: error instanceof Error ? error.message : "Unable to delete WhatsApp profile." });
  }
  settingsRedirect({ notice: "WhatsApp profile deleted." });
}

export async function saveWhatsAppProfileGreeting(formData: FormData) {
  const authorization = await requirePagePermission("app_settings", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const profileId = required(formData.get("profile_id"), "WhatsApp profile");
    const greetingEnabled = formData.get("greeting_enabled") === "on";
    const chatEnabled = formData.get("chat_enabled") === "on";
    const greetingMessage = clean(formData.get("greeting_message"));
    if (greetingEnabled && !greetingMessage) throw new Error("Greeting message is required when enabled.");

    const { error } = await supabaseAdmin.from("whatsapp_profiles").update({
      chat_enabled: chatEnabled,
      greeting_enabled: greetingEnabled,
      greeting_message: greetingMessage,
      updated_by: authorization.userId,
      updated_at: new Date().toISOString()
    }).eq("id", profileId).eq("company_id", companyId);
    if (error) throw new Error(error.message);
    revalidatePath("/settings/whatsapp");
    revalidatePath("/settings/meta");
    revalidatePath("/settings/meta-messaging");
  } catch (error) {
    settingsRedirect({ error: error instanceof Error ? error.message : "Unable to save greeting settings." });
  }
  settingsRedirect({ notice: "WhatsApp greeting settings saved." });
}

export async function syncWhatsAppTemplates() {
  const authorization = await requirePagePermission("app_settings", "edit");
  const companyId = requireCompanyId(authorization);
  let syncedCount = 0;
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const profiles = await supabaseAdmin
      .from("whatsapp_profiles")
      .select("id, profile_name, business_account_id, graph_api_version")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("profile_name");
    if (profiles.error) throw new Error(profiles.error.message);
    const activeProfiles = profiles.data ?? [];
    if (!activeProfiles.length) throw new Error("Create an active WhatsApp profile first.");

    for (const profile of activeProfiles) {
      if (!profile.business_account_id) continue;
      const token = await accessToken(profile.id, companyId);
      const version = profile.graph_api_version ?? "v25.0";
      let nextUrl: string | null = `https://graph.facebook.com/${version}/${profile.business_account_id}/message_templates?fields=id,name,status,language,category,components&limit=100`;
      const templates: Array<Record<string, unknown>> = [];

      while (nextUrl && templates.length < 500) {
        const response: Response = await fetch(nextUrl, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const payload = await response.json() as { data?: Array<Record<string, unknown>>; paging?: { next?: string }; error?: { message?: string } };
        if (!response.ok) throw new Error(`${profile.profile_name}: ${payload.error?.message || "Meta rejected the template request."}`);
        templates.push(...(payload.data ?? []));
        nextUrl = payload.paging?.next ?? null;
      }

      if (templates.length) {
        const { error } = await supabaseAdmin.from("whatsapp_template_cache").upsert(templates.map((template) => ({
          company_id: companyId,
          whatsapp_profile_id: profile.id,
          template_id: String(template.id ?? ""),
          name: String(template.name ?? ""),
          status: String(template.status ?? "UNKNOWN"),
          language: String(template.language ?? ""),
          category: template.category ? String(template.category) : null,
          components: Array.isArray(template.components) ? template.components : [],
          synced_at: new Date().toISOString()
        })), { onConflict: "company_id,template_id" });
        if (error) throw new Error(error.message);
      }
      syncedCount += templates.length;
    }
    revalidatePath("/settings/whatsapp");
    revalidatePath("/settings/meta");
    revalidatePath("/settings/meta-messaging");
  } catch (error) {
    settingsRedirect({ error: error instanceof Error ? error.message : "Unable to sync WhatsApp templates." });
  }
  settingsRedirect({ notice: `${syncedCount} WhatsApp template${syncedCount === 1 ? "" : "s"} synced.` });
}

const whatsappNotificationEvents: Record<string, { label: string; templateLabel: string }> = {
  employee_onboarding: {
    label: "Employee onboarding notification saved.",
    templateLabel: "employee onboarding"
  },
  field_executive_onboarding: {
    label: "Field Executive onboarding notification saved.",
    templateLabel: "field executive onboarding"
  },
  vendor_onboarding: {
    label: "Vendor onboarding notification saved.",
    templateLabel: "vendor onboarding"
  },
  onboarding_otp_verification: {
    label: "Onboarding OTP verification notification saved.",
    templateLabel: "OTP verification"
  }
};

export async function saveWhatsAppNotificationConfig(formData: FormData) {
  const authorization = await requirePagePermission("app_settings", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const eventCode = required(formData.get("event_code"), "Notification item");
    const eventConfig = whatsappNotificationEvents[eventCode];
    if (!eventConfig) throw new Error("Unsupported WhatsApp notification item.");
    const isEnabled = formData.get("is_enabled") === "on";
    const templateId = clean(formData.get("template_id"));
    const profileId = clean(formData.get("whatsapp_profile_id"));
    const rawMappings = clean(formData.get("variable_mappings_json")) ?? "{}";
    const otpExpiryMinutes = clean(formData.get("otp_expiry_minutes")) ?? "10";
    if (isEnabled && !templateId) throw new Error(`Select a ${eventConfig.templateLabel} template.`);
    if (isEnabled && !profileId) throw new Error(`Select the WhatsApp profile for ${eventConfig.templateLabel} messages.`);
    if (eventCode === "onboarding_otp_verification") {
      const expiryNumber = Number(otpExpiryMinutes);
      if (!Number.isInteger(expiryNumber) || expiryNumber < 1 || expiryNumber > 30) {
        throw new Error("OTP expiry time must be between 1 and 30 minutes.");
      }
    }

    let templateName: string | null = null;
    let templateLanguage: string | null = null;
    let mappings: Record<string, string> = {};
    try { mappings = JSON.parse(rawMappings) as Record<string, string>; } catch { throw new Error("Template variable mapping is invalid."); }

    if (templateId) {
      const template = await supabaseAdmin.from("whatsapp_template_cache").select("name, language, status, components, whatsapp_profile_id").eq("company_id", companyId).eq("template_id", templateId).single();
      if (template.error) throw new Error(template.error.message);
      if (isEnabled && template.data.whatsapp_profile_id !== profileId) throw new Error("Selected template does not belong to the selected WhatsApp profile.");
      if (isEnabled && template.data.status !== "APPROVED") throw new Error("Only an approved WhatsApp template can be enabled.");
      templateName = template.data.name;
      templateLanguage = template.data.language;
      const variables = extractWhatsAppTemplateVariables((template.data.components ?? []) as WhatsAppTemplateComponent[]);
      variables.forEach((variable) => {
        const fieldValue = clean(formData.get(`mapping_${variable.key.replaceAll(".", "_")}`));
        if (fieldValue) mappings[variable.key] = fieldValue;
      });
      const missing = variables.filter((variable) => !mappings[variable.key]);
      if (isEnabled && missing.length) throw new Error(`Map all template variables: ${missing.map((item) => item.label).join(", ")}.`);
      mappings = Object.fromEntries(Object.entries(mappings).filter(([key]) => variables.some((variable) => variable.key === key)));
    }
    if (eventCode === "onboarding_otp_verification") {
      mappings.__otp_expiry_minutes = otpExpiryMinutes;
    }

    const { error } = await supabaseAdmin.from("whatsapp_notification_configs").upsert({
      company_id: companyId,
      event_code: eventCode,
      is_enabled: isEnabled,
      whatsapp_profile_id: profileId,
      template_id: templateId,
      template_name: templateName,
      template_language: templateLanguage,
      variable_mappings: mappings,
      updated_by: authorization.userId,
      updated_at: new Date().toISOString()
    }, { onConflict: "company_id,event_code" });
    if (error) throw new Error(error.message);
    revalidatePath("/settings/whatsapp");
    revalidatePath("/settings/meta");
    revalidatePath("/settings/meta-messaging");
  } catch (error) {
    settingsRedirect({ error: error instanceof Error ? error.message : "Unable to save WhatsApp notification configuration." });
  }
  const savedEventCode = String(formData.get("event_code") ?? "");
  settingsRedirect({ notice: whatsappNotificationEvents[savedEventCode]?.label ?? "WhatsApp notification configuration saved." });
}

export const saveOnboardingWhatsAppNotification = saveWhatsAppNotificationConfig;
