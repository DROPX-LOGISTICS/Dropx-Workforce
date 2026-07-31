"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

type MetaGraphError = {
  error?: {
    code?: number;
    message?: string;
  };
};

type MetaSubscription = {
  callback_url?: string;
  fields?: Array<{ name?: string }>;
  object?: string;
};

type MetaPageSubscription = {
  id?: string;
  subscribed_fields?: string[];
};

type MetaLeadForm = {
  id?: string;
  name?: string;
  status?: string;
};

type MetaLeadQuestion = {
  key?: string;
  label?: string;
  options?: Array<string | { key?: string; value?: string }>;
  type?: string;
};

function clean(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function secretInput(value: FormDataEntryValue | null) {
  const text = clean(value);
  if (!text || /^\*+$/.test(text)) return null;
  return text;
}

function graphVersion(value: unknown) {
  const normalized = String(value ?? "").trim();
  return /^v\d+\.\d+$/.test(normalized) ? normalized : "v25.0";
}

function metaGraphUrl(version: string, path: string, params: Record<string, string> = {}) {
  const url = new URL(`https://graph.facebook.com/${version}/${path.replace(/^\/+/, "")}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

async function metaGraph<T>(url: URL, token: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({})) as T & MetaGraphError;
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message || `Meta Graph request failed with ${response.status}.`);
  }
  return payload;
}

function metaPostBody(values: Record<string, string>) {
  return new URLSearchParams(values).toString();
}

function questionTestValue(question: MetaLeadQuestion, testKey: string) {
  const key = String(question.key ?? question.label ?? "").toLowerCase();
  if (key.includes("full_name") || key === "name") return `DROPX META SYNC TEST ${testKey}`;
  if (key.includes("first_name")) return "DROPX META SYNC";
  if (key.includes("last_name")) return `TEST ${testKey}`;
  if (key.includes("email")) return `meta-sync-test+${testKey}@dropxlogistics.com`;
  if (key.includes("phone") || key.includes("mobile")) return "0000000000";
  if (key.includes("postal") || key.includes("post_code") || key.includes("zip")) return "000000";
  if (key.includes("city")) return "Integration Test";
  const firstOption = question.options?.[0];
  if (typeof firstOption === "string") return firstOption;
  if (firstOption && typeof firstOption === "object") return firstOption.value || firstOption.key || "Test";
  return "Test";
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

export async function connectAndTestMetaLeadSync() {
  let connectionCompleted = false;
  try {
    const authorization = await requirePagePermission("app_settings", "edit");
    const companyId = requireCompanyId(authorization);
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const [settingsResult, companyResult] = await Promise.all([
      supabaseAdmin
        .from("meta_leads_settings")
        .select("is_enabled,meta_app_id,graph_api_version,page_id,app_secret_secret_id,access_token_secret_id")
        .eq("company_id", companyId)
        .eq("id", true)
        .maybeSingle(),
      supabaseAdmin.from("companies").select("webhook_key").eq("id", companyId).maybeSingle()
    ]);
    if (settingsResult.error) throw new Error(settingsResult.error.message);
    if (companyResult.error) throw new Error(companyResult.error.message);

    const settings = settingsResult.data;
    const appId = String(settings?.meta_app_id ?? "").trim();
    const pageId = String(settings?.page_id ?? "").trim();
    const webhookKey = String(companyResult.data?.webhook_key ?? "").trim();
    const version = graphVersion(settings?.graph_api_version);
    if (!settings?.is_enabled) throw new Error("Enable Meta lead sync before running the connection test.");
    if (!appId || !pageId || !webhookKey) throw new Error("Meta App ID, Page ID, or company webhook key is missing.");
    if (!settings.app_secret_secret_id || !settings.access_token_secret_id) throw new Error("Meta app secret or access token is missing.");

    const [appSecretResult, accessTokenResult] = await Promise.all([
      supabaseAdmin.rpc("get_meta_leads_app_secret", { company_uuid: companyId }),
      supabaseAdmin.rpc("get_meta_leads_access_token", { company_uuid: companyId })
    ]);
    if (appSecretResult.error) throw new Error(appSecretResult.error.message);
    if (accessTokenResult.error) throw new Error(accessTokenResult.error.message);
    const appSecret = String(appSecretResult.data ?? "").trim();
    const accessToken = String(accessTokenResult.data ?? "").trim();
    if (!appSecret || !accessToken) throw new Error("Meta credentials could not be read from the secure vault.");

    const appToken = `${appId}|${appSecret}`;
    const pageDetails = await metaGraph<{ id?: string; name?: string; access_token?: string }>(
      metaGraphUrl(version, pageId, { fields: "id,name,access_token" }),
      accessToken
    );
    if (String(pageDetails.id ?? "") !== pageId) throw new Error("The configured token cannot access the selected Meta Page.");
    const pageToken = String(pageDetails.access_token ?? accessToken).trim();

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://dashboard.dropxlogistics.com").replace(/\/$/, "");
    const callbackUrl = `${appUrl}/api/webhooks/${webhookKey}`;
    const subscriptions = await metaGraph<{ data?: MetaSubscription[] }>(
      metaGraphUrl(version, `${appId}/subscriptions`, { fields: "object,callback_url,fields" }),
      appToken
    );
    const pageSubscription = (subscriptions.data ?? []).find((subscription) => subscription.object === "page");
    const appFields = new Set((pageSubscription?.fields ?? []).map((field) => String(field.name ?? "").trim()).filter(Boolean));
    appFields.add("leadgen");
    await metaGraph<Record<string, unknown>>(
      metaGraphUrl(version, `${appId}/subscriptions`),
      appToken,
      {
        method: "POST",
        body: metaPostBody({
          object: "page",
          callback_url: callbackUrl,
          fields: [...appFields].join(","),
          verify_token: webhookKey,
          include_values: "true"
        })
      }
    );

    const pageSubscriptions = await metaGraph<{ data?: MetaPageSubscription[] }>(
      metaGraphUrl(version, `${pageId}/subscribed_apps`, { fields: "id,subscribed_fields" }),
      pageToken
    );
    const currentPageSubscription = (pageSubscriptions.data ?? []).find((subscription) => String(subscription.id ?? "") === appId);
    const pageFields = new Set((currentPageSubscription?.subscribed_fields ?? []).map((field) => String(field).trim()).filter(Boolean));
    pageFields.add("leadgen");
    await metaGraph<Record<string, unknown>>(
      metaGraphUrl(version, `${pageId}/subscribed_apps`),
      pageToken,
      { method: "POST", body: metaPostBody({ subscribed_fields: [...pageFields].join(",") }) }
    );
    connectionCompleted = true;

    const forms = await metaGraph<{ data?: MetaLeadForm[] }>(
      metaGraphUrl(version, `${pageId}/leadgen_forms`, { fields: "id,name,status", limit: "100" }),
      pageToken
    );
    const form = (forms.data ?? []).find((item) => item.id && String(item.status ?? "").toUpperCase() === "ACTIVE")
      ?? (forms.data ?? []).find((item) => item.id);
    if (!form?.id) throw new Error("Meta Page is connected, but it has no lead form available for testing.");

    const formDetails = await metaGraph<{ questions?: MetaLeadQuestion[] }>(
      metaGraphUrl(version, form.id, { fields: "questions" }),
      pageToken
    );
    const previousTests = await metaGraph<{ data?: Array<{ id?: string }> }>(
      metaGraphUrl(version, `${form.id}/test_leads`, { fields: "id" }),
      pageToken
    ).catch(() => ({ data: [] }));
    for (const previous of previousTests.data ?? []) {
      if (!previous.id) continue;
      await metaGraph<Record<string, unknown>>(metaGraphUrl(version, previous.id), pageToken, { method: "DELETE" }).catch(() => null);
    }

    const testKey = Date.now().toString(36).toUpperCase();
    const fieldData = (formDetails.questions ?? [])
      .filter((question) => question.key || question.label)
      .map((question) => ({ name: String(question.key ?? question.label), values: [questionTestValue(question, testKey)] }));
    const testLead = await metaGraph<{ id?: string }>(
      metaGraphUrl(version, `${form.id}/test_leads`),
      pageToken,
      { method: "POST", body: metaPostBody({ field_data: JSON.stringify(fieldData) }) }
    );
    const testLeadId = String(testLead.id ?? "").trim();
    if (!testLeadId) throw new Error("Meta accepted the Page connection but did not create a test lead.");

    let received = false;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const lead = await supabaseAdmin
        .from("leads")
        .select("id")
        .eq("company_id", companyId)
        .eq("meta_lead_id", testLeadId)
        .maybeSingle();
      if (lead.error) throw new Error(lead.error.message);
      if (lead.data?.id) {
        received = true;
        break;
      }
    }
    if (!received) throw new Error("Meta Page is connected, but the test lead was not received within 24 seconds. Check the Meta webhook delivery log.");

    await metaGraph<Record<string, unknown>>(metaGraphUrl(version, testLeadId), pageToken, { method: "DELETE" }).catch(() => null);
    const now = new Date().toISOString();
    const saved = await supabaseAdmin
      .from("meta_leads_settings")
      .update({ last_synced_at: now, updated_at: now })
      .eq("company_id", companyId)
      .eq("id", true);
    if (saved.error) throw new Error(saved.error.message);

    revalidatePath("/settings/ads-leads");
    revalidatePath("/leads/all");
    redirectWithFlash({ notice: `Meta lead sync connected and verified through ${form.name || "the active lead form"}.` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to connect and test Meta lead sync.";
    redirectWithFlash({ error: connectionCompleted ? `Page subscription completed. ${message}` : message });
  }
}
