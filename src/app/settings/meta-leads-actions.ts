"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

function clean(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function secretInput(value: FormDataEntryValue | null) {
  const text = clean(value);
  if (!text || /^\*+$/.test(text)) return null;
  return text;
}

function redirectWithFlash(params: { error?: string; notice?: string }): never {
  cookies().set("dropx_meta_leads_settings_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 20,
    path: "/settings",
    sameSite: "lax"
  });
  redirect("/settings/ads-leads");
}

async function saveMetaLeadsSecret(kind: "app_secret" | "access_token", secretValue: string, companyId: string) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

  const directRpc = kind === "app_secret" ? "set_meta_leads_app_secret" : "set_meta_leads_access_token";
  const direct = await supabaseAdmin.rpc(directRpc, { secret_value: secretValue, company_uuid: companyId });
  if (!direct.error) return;

  const isLegacyVaultError = /_crypto_aead_det_noncegen|permission denied/i.test(direct.error.message);
  if (!isLegacyVaultError) throw new Error(direct.error.message);

  const existingMeta = await supabaseAdmin
    .from("meta_messaging_settings")
    .select("app_secret_secret_id, page_access_token_secret_id")
    .eq("id", true)
    .eq("company_id", companyId)
    .maybeSingle();
  if (existingMeta.error) throw new Error(existingMeta.error.message);

  const bridgeRpc = kind === "app_secret" ? "set_meta_app_secret" : "set_meta_page_access_token";
  const bridge = await supabaseAdmin.rpc(bridgeRpc, { secret_value: secretValue, company_uuid: companyId });
  if (bridge.error) throw new Error(bridge.error.message);

  const secretId = typeof bridge.data === "string" ? bridge.data : null;
  if (!secretId) throw new Error("Meta Leads secret was not created.");

  const restorePayload =
    kind === "app_secret"
      ? { app_secret_secret_id: existingMeta.data?.app_secret_secret_id ?? null, updated_at: new Date().toISOString() }
      : { page_access_token_secret_id: existingMeta.data?.page_access_token_secret_id ?? null, updated_at: new Date().toISOString() };

  const restore = await supabaseAdmin.from("meta_messaging_settings").update(restorePayload).eq("id", true).eq("company_id", companyId);
  if (restore.error) throw new Error(restore.error.message);

  const leadPayload =
    kind === "app_secret"
      ? { app_secret_secret_id: secretId, updated_at: new Date().toISOString() }
      : { access_token_secret_id: secretId, updated_at: new Date().toISOString() };

  const attach = await supabaseAdmin.from("meta_leads_settings").update(leadPayload).eq("id", true).eq("company_id", companyId);
  if (attach.error) throw new Error(attach.error.message);
}

export async function saveMetaLeadsSettings(formData: FormData) {
  try {
    const authorization = await requirePagePermission("app_settings", "edit");
    const companyId = requireCompanyId(authorization);
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const isEnabled = formData.get("is_enabled") === "on";
    const appSecret = secretInput(formData.get("app_secret"));
    const accessToken = secretInput(formData.get("access_token"));

    const current = await supabaseAdmin
      .from("meta_leads_settings")
      .select("app_secret_secret_id, access_token_secret_id")
      .eq("id", true)
      .eq("company_id", companyId)
      .maybeSingle();
    if (current.error) throw new Error(current.error.message);

    const payload = {
      id: true,
      company_id: companyId,
      is_enabled: isEnabled,
      meta_app_id: clean(formData.get("meta_app_id")),
      graph_api_version: clean(formData.get("graph_api_version")) ?? "v25.0",
      ad_account_id: clean(formData.get("ad_account_id")),
      page_id: clean(formData.get("page_id")),
      page_name: clean(formData.get("page_name")),
      updated_at: new Date().toISOString()
    };

    if (isEnabled && !payload.meta_app_id) throw new Error("Meta App ID is required before enabling lead sync.");
    if (isEnabled && !payload.ad_account_id) throw new Error("Ad Account ID is required before enabling lead sync.");
    if (isEnabled && !payload.page_id) throw new Error("Page ID is required before enabling lead sync.");
    if (isEnabled && !accessToken && !current.data?.access_token_secret_id) throw new Error("Access token is required before enabling lead sync.");

    const saved = await supabaseAdmin
      .from("meta_leads_settings")
      .upsert(payload, { onConflict: "company_id,id" });
    if (saved.error) throw new Error(saved.error.message);

    if (appSecret) {
      await saveMetaLeadsSecret("app_secret", appSecret, companyId);
    }

    if (accessToken) {
      await saveMetaLeadsSecret("access_token", accessToken, companyId);
    }

    revalidatePath("/settings");
    revalidatePath("/settings/meta-leads");
    revalidatePath("/settings/ads-leads");
  } catch (error) {
    redirectWithFlash({ error: error instanceof Error ? error.message : "Unable to save Meta Leads settings." });
  }

  redirectWithFlash({ notice: "Meta Leads settings saved." });
}

export async function saveAdsLeadsWebhookSettings(formData: FormData) {
  try {
    const authorization = await requirePagePermission("app_settings", "edit");
    const companyId = requireCompanyId(authorization);
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const saved = await supabaseAdmin
      .from("meta_leads_settings")
      .upsert({
        id: true,
        company_id: companyId,
        webhook_verify_token: clean(formData.get("webhook_verify_token")),
        updated_at: new Date().toISOString()
      }, { onConflict: "company_id,id" });
    if (saved.error) throw new Error(saved.error.message);

    revalidatePath("/settings");
    revalidatePath("/settings/ads-leads");
    revalidatePath("/settings/meta-leads");
  } catch (error) {
    redirectWithFlash({ error: error instanceof Error ? error.message : "Unable to save webhook settings." });
  }

  redirectWithFlash({ notice: "Webhook settings saved." });
}
