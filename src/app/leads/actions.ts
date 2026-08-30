"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAuthorization, hasPermission } from "@/lib/authorization";
import { requireCompanyId, withCompany } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

type MetaPaging = {
  next?: string;
};

type MetaAdCreative = {
  thumbnail_url?: string;
  image_url?: string;
};

type MetaAdRow = {
  id: string;
  adset_id?: string;
  campaign_id?: string;
  name?: string;
  status?: string;
  effective_status?: string;
  configured_status?: string;
  created_time?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  budget_remaining?: string;
  campaign?: {
    daily_budget?: string;
    lifetime_budget?: string;
  };
  adset?: {
    daily_budget?: string;
    lifetime_budget?: string;
  };
  adcreatives?: {
    data?: MetaAdCreative[];
  };
  insights?: {
    data?: Array<{
      spend?: string;
      actions?: Array<{ action_type?: string; value?: string }>;
    }>;
  };
};

type MetaParentRow = {
  id?: string;
  adset_id?: string;
  campaign_id?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  error?: {
    message?: string;
  };
};

type MetaAdsResponse = {
  data?: MetaAdRow[];
  paging?: MetaPaging;
  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
};

function setLeadsFlash(params: { error?: string; notice?: string }) {
  cookies().set("dropx_leads_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 20,
    path: "/leads",
    sameSite: "lax"
  });
}

function isNextRedirectError(error: unknown) {
  return typeof (error as { digest?: unknown })?.digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT");
}

function isMissingConflictConstraint(error: unknown) {
  const message = String((error as { message?: unknown })?.message ?? "").toLowerCase();
  return message.includes("no unique or exclusion constraint matching the on conflict specification");
}

function normalizeAdAccountId(value: string | null | undefined) {
  const clean = String(value ?? "").trim();
  if (!clean) return "";
  return clean.startsWith("act_") ? clean : `act_${clean}`;
}

function normalizeGraphVersion(value: string | null | undefined) {
  const clean = String(value ?? "").trim();
  if (!clean) return "v25.0";
  return clean.startsWith("v") ? clean : `v${clean}`;
}

function mapMetaStatus(value: string | null | undefined) {
  const status = String(value ?? "").toUpperCase();
  if (status === "ACTIVE") return "active";
  if (status === "PAUSED" || status.endsWith("_PAUSED")) return "paused";
  if (status === "ARCHIVED") return "archived";
  if (status === "DELETED" || status === "DISAPPROVED" || status === "WITH_ISSUES") return "stopped";
  return "unknown";
}

function parseAdName(name: string) {
  const match = name.match(/\b([A-Z0-9]{2,})_([A-Z0-9]{2,})\b/i);
  return {
    stationCode: match?.[1]?.toUpperCase() ?? null,
    jobCode: match?.[2]?.toUpperCase() ?? null
  };
}

function clean(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

function required(value: FormDataEntryValue | null, field: string) {
  const text = clean(value);
  if (!text) throw new Error(`${field} is required.`);
  return text;
}

function parseLeadFields(formData: FormData) {
  const values = formData.getAll("required_fields")
    .flatMap((value) => String(value ?? "").split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  const unique = Array.from(new Set(values));
  return unique.length ? unique : ["full_name", "phone", "city", "post_code"];
}

async function syncDesignationFromSop(code: string, name: string, companyId: string) {
  if (!supabaseAdmin) return;

  const existing = await supabaseAdmin
    .from("designations")
    .select("id")
    .eq("company_id", companyId)
    .eq("code", code)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);

  if (existing.data?.id) {
    const result = await supabaseAdmin
      .from("designations")
      .update({ name, updated_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .eq("id", existing.data.id);
    if (result.error) throw new Error(result.error.message);
    return;
  }

  const result = await supabaseAdmin
    .from("designations")
    .insert(withCompany({ code, name, provider_ids: [], is_active: true }, companyId));
  if (result.error) throw new Error(result.error.message);
}

function moneyFromMinorUnit(value: string | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return null;
  return Math.round((amount / 100) * 100) / 100;
}

function money(value: string | null | undefined) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

function leadCountFromInsights(ad: MetaAdRow) {
  const actions = ad.insights?.data?.[0]?.actions ?? [];
  const leadTypes = new Set([
    "lead",
    "onsite_conversion.lead_grouped",
    "onsite_conversion.lead",
    "offsite_conversion.fb_pixel_lead",
    "leadgen_grouped",
    "onsite_conversion.messaging_conversation_started_7d"
  ]);
  return actions.reduce((total, action) => {
    if (!action.action_type || !leadTypes.has(action.action_type)) return total;
    const value = Number(action.value ?? 0);
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);
}

function metaBudget(ad: MetaAdRow) {
  return moneyFromMinorUnit(
    ad.daily_budget ||
    ad.lifetime_budget ||
    ad.adset?.daily_budget ||
    ad.adset?.lifetime_budget ||
    ad.campaign?.daily_budget ||
    ad.campaign?.lifetime_budget
  );
}

async function saveLeadAdRows(payload: Array<Record<string, unknown>>, companyId: string) {
  if (!supabaseAdmin || !payload.length) return;

  const saved = await supabaseAdmin
    .from("lead_ads")
    .upsert(payload, { onConflict: "company_id,meta_ad_id" });
  if (!saved.error) return;
  if (!isMissingConflictConstraint(saved.error)) throw new Error(saved.error.message);

  for (const row of payload) {
    const metaAdId = String(row.meta_ad_id ?? "").trim();
    if (!metaAdId) continue;

    const existing = await supabaseAdmin
      .from("lead_ads")
      .select("id")
      .eq("company_id", companyId)
      .eq("meta_ad_id", metaAdId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);

    if (existing.data?.id) {
      const updated = await supabaseAdmin
        .from("lead_ads")
        .update(row)
        .eq("company_id", companyId)
        .eq("id", existing.data.id);
      if (updated.error) throw new Error(updated.error.message);
      continue;
    }

    const inserted = await supabaseAdmin.from("lead_ads").insert(row);
    if (inserted.error) throw new Error(inserted.error.message);
  }
}

async function fetchMetaBudgetMap({
  accessToken,
  graphVersion,
  ids
}: {
  accessToken: string;
  graphVersion: string;
  ids: string[];
}) {
  const uniqueIds = [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))];
  const result = new Map<string, number>();

  await Promise.all(uniqueIds.map(async (id) => {
    const params = new URLSearchParams({
      fields: "daily_budget,lifetime_budget",
      access_token: accessToken
    });
    const response = await fetch(`https://graph.facebook.com/${graphVersion}/${id}?${params.toString()}`, {
      cache: "no-store"
    });
    const payload = await response.json() as MetaParentRow;
    if (!response.ok || payload.error) return;
    const budget = moneyFromMinorUnit(payload.daily_budget || payload.lifetime_budget);
    if (budget != null && budget > 0) result.set(id, budget);
  }));

  return result;
}

async function fetchMetaAdParents({
  accessToken,
  adId,
  graphVersion
}: {
  accessToken: string;
  adId: string;
  graphVersion: string;
}) {
  const params = new URLSearchParams({
    fields: "adset_id,campaign_id",
    access_token: accessToken
  });
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${adId}?${params.toString()}`, {
    cache: "no-store"
  });
  const payload = await response.json() as MetaParentRow;
  if (!response.ok || payload.error) throw new Error(payload.error?.message || `Meta Ads Manager request failed with ${response.status}.`);
  return {
    adsetId: String(payload.adset_id ?? "").trim(),
    campaignId: String(payload.campaign_id ?? "").trim()
  };
}

async function fetchMetaAds({
  adAccountId,
  accessToken,
  graphVersion
}: {
  adAccountId: string;
  accessToken: string;
  graphVersion: string;
}) {
  const fields = [
    "id",
    "adset_id",
    "campaign_id",
    "name",
    "status",
    "effective_status",
    "configured_status",
    "created_time",
    "daily_budget",
    "lifetime_budget",
    "campaign{daily_budget,lifetime_budget}",
    "adset{daily_budget,lifetime_budget}",
    "adcreatives.limit(1){thumbnail_url,image_url}",
    "insights.date_preset(maximum){spend,actions}"
  ].join(",");
  const params = new URLSearchParams({
    fields,
    limit: "100",
    access_token: accessToken
  });
  let url: string | undefined = `https://graph.facebook.com/${graphVersion}/${adAccountId}/ads?${params.toString()}`;
  const rows: MetaAdRow[] = [];

  for (let page = 0; url && page < 10; page += 1) {
    const response = await fetch(url, { cache: "no-store" });
    const payload = (await response.json()) as MetaAdsResponse;
    if (!response.ok || payload.error) {
      const message = payload.error?.message || `Meta Ads Manager request failed with ${response.status}.`;
      if (/date_preset/i.test(message)) {
        return fetchMetaAdsWithoutInsights({ adAccountId, accessToken, graphVersion });
      }
      throw new Error(message);
    }
    rows.push(...(payload.data ?? []));
    url = payload.paging?.next;
  }

  return rows;
}

async function fetchMetaAdsWithoutInsights({
  adAccountId,
  accessToken,
  graphVersion
}: {
  adAccountId: string;
  accessToken: string;
  graphVersion: string;
}) {
  const fields = [
    "id",
    "adset_id",
    "campaign_id",
    "name",
    "status",
    "effective_status",
    "configured_status",
    "created_time",
    "daily_budget",
    "lifetime_budget",
    "campaign{daily_budget,lifetime_budget}",
    "adset{daily_budget,lifetime_budget}",
    "adcreatives.limit(1){thumbnail_url,image_url}"
  ].join(",");
  const params = new URLSearchParams({
    fields,
    limit: "100",
    access_token: accessToken
  });
  let url: string | undefined = `https://graph.facebook.com/${graphVersion}/${adAccountId}/ads?${params.toString()}`;
  const rows: MetaAdRow[] = [];

  for (let page = 0; url && page < 10; page += 1) {
    const response = await fetch(url, { cache: "no-store" });
    const payload = (await response.json()) as MetaAdsResponse;
    if (!response.ok || payload.error) {
      throw new Error(payload.error?.message || `Meta Ads Manager request failed with ${response.status}.`);
    }
    rows.push(...(payload.data ?? []));
    url = payload.paging?.next;
  }

  return rows;
}

export async function syncMetaLeadAds() {
  try {
    const authorization = await getAuthorization();
    if (!authorization) redirect("/login");
    const companyId = requireCompanyId(authorization);
    if (!hasPermission(authorization, "leads_ads", "access")) {
      redirect("/unauthorized?page=leads_ads&action=access");
    }
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const settings = await supabaseAdmin
      .from("meta_leads_settings")
      .select("is_enabled, graph_api_version, ad_account_id, access_token_secret_id")
      .eq("id", true)
      .eq("company_id", companyId)
      .maybeSingle();
    if (settings.error) throw new Error(settings.error.message);
    if (!settings.data?.is_enabled) throw new Error("Enable Meta Leads & Ads settings before syncing Ads Manager.");
    if (!settings.data?.ad_account_id) throw new Error("Ad Account ID is missing in Meta Leads & Ads settings.");
    if (!settings.data?.access_token_secret_id) throw new Error("Access token is missing in Meta Leads & Ads settings.");

    const tokenResult = await supabaseAdmin.rpc("get_meta_leads_access_token", { company_uuid: companyId });
    if (tokenResult.error) throw new Error(tokenResult.error.message);
    const accessToken = String(tokenResult.data ?? "").trim();
    if (!accessToken) throw new Error("Access token could not be read from Supabase vault.");

    const graphVersion = normalizeGraphVersion(settings.data.graph_api_version);
    const adAccountId = normalizeAdAccountId(settings.data.ad_account_id);
    const ads = await fetchMetaAds({ adAccountId, accessToken, graphVersion });
    const [adsetBudgetById, campaignBudgetById] = await Promise.all([
      fetchMetaBudgetMap({ accessToken, graphVersion, ids: ads.map((ad) => ad.adset_id ?? "") }),
      fetchMetaBudgetMap({ accessToken, graphVersion, ids: ads.map((ad) => ad.campaign_id ?? "") })
    ]);

    const [roles, existingAds, leadRows] = await Promise.all([
      supabaseAdmin.from("lead_job_roles").select("id, code").eq("company_id", companyId),
      supabaseAdmin.from("lead_ads").select("id, meta_ad_id, leads_count").eq("company_id", companyId),
      supabaseAdmin.from("leads").select("lead_ad_id").eq("company_id", companyId).not("lead_ad_id", "is", null).limit(10000)
    ]);
    if (roles.error) throw new Error(roles.error.message);
    if (existingAds.error) throw new Error(existingAds.error.message);
    if (leadRows.error) throw new Error(leadRows.error.message);

    const roleByCode = new Map((roles.data ?? []).map((role) => [String(role.code).toUpperCase(), role.id]));
    const existingByMetaId = new Map((existingAds.data ?? []).map((ad) => [ad.meta_ad_id, ad]));
    const leadCountByAdId = new Map<string, number>();
    (leadRows.data ?? []).forEach((lead) => {
      if (!lead.lead_ad_id) return;
      leadCountByAdId.set(lead.lead_ad_id, (leadCountByAdId.get(lead.lead_ad_id) ?? 0) + 1);
    });

    const now = new Date().toISOString();
    const payload = ads
      .filter((ad) => ad.id)
      .map((ad) => {
        const adName = String(ad.name || ad.id).trim();
        const parsed = parseAdName(adName);
        const existing = existingByMetaId.get(ad.id);
        const localLeadCount = existing?.id ? leadCountByAdId.get(existing.id) : undefined;
        const creative = ad.adcreatives?.data?.[0];
        return {
          company_id: companyId,
          meta_ad_id: ad.id,
          ad_name: adName,
          station_code: parsed.stationCode,
          job_code: parsed.jobCode,
          role_id: parsed.jobCode ? roleByCode.get(parsed.jobCode) ?? null : null,
          daily_budget: metaBudget(ad) ?? adsetBudgetById.get(ad.adset_id ?? "") ?? campaignBudgetById.get(ad.campaign_id ?? "") ?? null,
          total_spend: money(ad.insights?.data?.[0]?.spend),
          leads_count: localLeadCount ?? (leadCountFromInsights(ad) || (existing?.leads_count ?? 0)),
          status: mapMetaStatus(ad.effective_status || ad.configured_status || ad.status),
          poster_url: creative?.image_url || creative?.thumbnail_url || null,
          created_on: ad.created_time ? ad.created_time.slice(0, 10) : null,
          last_synced_at: now,
          updated_at: now
        };
      });

    if (payload.length) {
      await saveLeadAdRows(payload, companyId);
    }

    const settingsSaved = await supabaseAdmin
      .from("meta_leads_settings")
      .update({ last_synced_at: now, updated_at: now })
      .eq("id", true)
      .eq("company_id", companyId);
    if (settingsSaved.error) throw new Error(settingsSaved.error.message);

    revalidatePath("/leads");
    revalidatePath("/leads/ads");
    revalidatePath("/settings/meta-leads");
    revalidatePath("/settings/ads-leads");
    setLeadsFlash({ notice: `${payload.length.toLocaleString("en-IN")} ads synced from Ads Manager.` });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    setLeadsFlash({ error: error instanceof Error ? error.message : "Unable to sync Ads Manager." });
  }

  redirect("/leads/ads");
}

async function getMetaLeadSettings(companyId: string) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const settings = await supabaseAdmin
    .from("meta_leads_settings")
    .select("is_enabled, graph_api_version, access_token_secret_id")
    .eq("id", true)
    .eq("company_id", companyId)
    .maybeSingle();
  if (settings.error) throw new Error(settings.error.message);
  if (!settings.data?.is_enabled) throw new Error("Enable Meta Leads & Ads settings first.");
  if (!settings.data?.access_token_secret_id) throw new Error("Access token is missing in Meta Leads & Ads settings.");
  const tokenResult = await supabaseAdmin.rpc("get_meta_leads_access_token", { company_uuid: companyId });
  if (tokenResult.error) throw new Error(tokenResult.error.message);
  const accessToken = String(tokenResult.data ?? "").trim();
  if (!accessToken) throw new Error("Access token could not be read from Supabase vault.");
  return {
    accessToken,
    graphVersion: normalizeGraphVersion(settings.data.graph_api_version)
  };
}

export async function changeMetaLeadAdStatus(formData: FormData) {
  try {
    const authorization = await getAuthorization();
    if (!authorization) redirect("/login");
    const companyId = requireCompanyId(authorization);
    if (!hasPermission(authorization, "leads_ads", "edit")) redirect("/unauthorized?page=leads_ads&action=edit");
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const adId = String(formData.get("adId") ?? "").trim();
    const nextStatus = String(formData.get("nextStatus") ?? "").trim().toUpperCase();
    if (!adId) throw new Error("Ad ID is missing.");
    if (!["ACTIVE", "PAUSED", "ARCHIVED"].includes(nextStatus)) throw new Error("Invalid ad status.");

    const settings = await getMetaLeadSettings(companyId);
    const params = new URLSearchParams({ status: nextStatus, access_token: settings.accessToken });
    const response = await fetch(`https://graph.facebook.com/${settings.graphVersion}/${adId}`, {
      method: "POST",
      body: params,
      cache: "no-store"
    });
    const payload = await response.json() as { error?: { message?: string } };
    if (!response.ok || payload.error) throw new Error(payload.error?.message || `Meta Ads Manager request failed with ${response.status}.`);

    const status = nextStatus === "ACTIVE" ? "active" : nextStatus === "PAUSED" ? "paused" : "stopped";
    const saved = await supabaseAdmin
      .from("lead_ads")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .eq("meta_ad_id", adId);
    if (saved.error) throw new Error(saved.error.message);

    revalidatePath("/leads/ads");
    setLeadsFlash({ notice: `Ad ${status === "stopped" ? "stopped" : status}.` });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    setLeadsFlash({ error: error instanceof Error ? error.message : "Unable to update ad." });
  }

  redirect("/leads/ads");
}

async function changeOneMetaAdStatus({
  accessToken,
  adId,
  graphVersion,
  nextStatus
}: {
  accessToken: string;
  adId: string;
  graphVersion: string;
  nextStatus: string;
}) {
  const params = new URLSearchParams({ status: nextStatus, access_token: accessToken });
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${adId}`, {
    method: "POST",
    body: params,
    cache: "no-store"
  });
  const payload = await response.json() as { error?: { message?: string } };
  if (!response.ok || payload.error) throw new Error(payload.error?.message || `Meta Ads Manager request failed with ${response.status}.`);
}

async function deleteOneMetaAd({
  accessToken,
  adId,
  graphVersion
}: {
  accessToken: string;
  adId: string;
  graphVersion: string;
}) {
  const params = new URLSearchParams({ access_token: accessToken });
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${adId}?${params.toString()}`, {
    method: "DELETE",
    cache: "no-store"
  });
  const payload = await response.json() as { error?: { message?: string } };
  if (!response.ok || payload.error) throw new Error(payload.error?.message || `Meta Ads Manager request failed with ${response.status}.`);
}

async function deleteOneMetaObject({
  accessToken,
  graphVersion,
  objectId
}: {
  accessToken: string;
  graphVersion: string;
  objectId: string;
}) {
  const cleanId = String(objectId).trim();
  if (!cleanId) return;
  const params = new URLSearchParams({ access_token: accessToken });
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${cleanId}?${params.toString()}`, {
    method: "DELETE",
    cache: "no-store"
  });
  const payload = await response.json() as { error?: { message?: string } };
  if (!response.ok || payload.error) throw new Error(payload.error?.message || `Meta Ads Manager request failed with ${response.status}.`);
}

async function deleteMetaAdWithParents({
  accessToken,
  adId,
  deleteAdSet,
  deleteCampaign,
  graphVersion
}: {
  accessToken: string;
  adId: string;
  deleteAdSet: boolean;
  deleteCampaign: boolean;
  graphVersion: string;
}) {
  const parents = deleteAdSet || deleteCampaign
    ? await fetchMetaAdParents({ accessToken, adId, graphVersion })
    : { adsetId: "", campaignId: "" };
  await deleteOneMetaAd({ accessToken, adId, graphVersion });
  if (deleteAdSet) await deleteOneMetaObject({ accessToken, graphVersion, objectId: parents.adsetId });
  if (deleteCampaign) await deleteOneMetaObject({ accessToken, graphVersion, objectId: parents.campaignId });
}

export async function bulkMetaLeadAdAction(formData: FormData) {
  try {
    const authorization = await getAuthorization();
    if (!authorization) redirect("/login");
    const companyId = requireCompanyId(authorization);
    if (!hasPermission(authorization, "leads_ads", "edit")) redirect("/unauthorized?page=leads_ads&action=edit");
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const adIds = formData.getAll("adIds").map((value) => String(value).trim()).filter(Boolean);
    const bulkAction = String(formData.get("bulkAction") ?? "").trim().toUpperCase();
    const deleteAdSet = formData.get("deleteAdSet") === "true";
    const deleteCampaign = formData.get("deleteCampaign") === "true";
    if (!adIds.length) throw new Error("Select at least one ad.");
    if (!["ACTIVE", "PAUSED", "ARCHIVED", "DELETE"].includes(bulkAction)) throw new Error("Select a valid bulk action.");

    const settings = await getMetaLeadSettings(companyId);
    let success = 0;
    let failed = 0;
    let lastError = "";

    for (const adId of adIds) {
      try {
        if (bulkAction === "DELETE") {
          await deleteMetaAdWithParents({
            accessToken: settings.accessToken,
            adId,
            deleteAdSet,
            deleteCampaign,
            graphVersion: settings.graphVersion
          });
        } else {
          await changeOneMetaAdStatus({ accessToken: settings.accessToken, adId, graphVersion: settings.graphVersion, nextStatus: bulkAction });
        }
        success += 1;
      } catch (error) {
        failed += 1;
        lastError = error instanceof Error ? error.message : "Unknown Meta error.";
      }
    }

    if (success) {
      const status = bulkAction === "ACTIVE" ? "active" : bulkAction === "PAUSED" ? "paused" : bulkAction === "DELETE" ? "archived" : "stopped";
      const saved = await supabaseAdmin
        .from("lead_ads")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("company_id", companyId)
        .in("meta_ad_id", adIds);
      if (saved.error) throw new Error(saved.error.message);
    }

    revalidatePath("/leads/ads");
    setLeadsFlash({
      notice: failed
        ? `${success.toLocaleString("en-IN")} ads updated, ${failed.toLocaleString("en-IN")} failed. ${lastError}`
        : `${success.toLocaleString("en-IN")} ads updated.`
    });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    setLeadsFlash({ error: error instanceof Error ? error.message : "Unable to apply bulk action." });
  }

  redirect("/leads/ads");
}

export async function deleteMetaLeadAd(formData: FormData) {
  try {
    const authorization = await getAuthorization();
    if (!authorization) redirect("/login");
    const companyId = requireCompanyId(authorization);
    if (!hasPermission(authorization, "leads_ads", "edit")) redirect("/unauthorized?page=leads_ads&action=edit");
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const adId = String(formData.get("adId") ?? "").trim();
    const deleteAdSet = formData.get("deleteAdSet") === "true";
    const deleteCampaign = formData.get("deleteCampaign") === "true";
    if (!adId) throw new Error("Ad ID is missing.");
    const settings = await getMetaLeadSettings(companyId);
    await deleteMetaAdWithParents({
      accessToken: settings.accessToken,
      adId,
      deleteAdSet,
      deleteCampaign,
      graphVersion: settings.graphVersion
    });

    const saved = await supabaseAdmin
      .from("lead_ads")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .eq("meta_ad_id", adId);
    if (saved.error) throw new Error(saved.error.message);

    revalidatePath("/leads/ads");
    setLeadsFlash({ notice: "Ad deleted in Meta and archived here." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    setLeadsFlash({ error: error instanceof Error ? error.message : "Unable to delete ad." });
  }

  redirect("/leads/ads");
}

export async function removeLocalLeadAd(formData: FormData) {
  try {
    const authorization = await getAuthorization();
    if (!authorization) redirect("/login");
    const companyId = requireCompanyId(authorization);
    if (!hasPermission(authorization, "leads_ads", "edit")) redirect("/unauthorized?page=leads_ads&action=edit");
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const adRowId = String(formData.get("adRowId") ?? "").trim();
    if (!adRowId) throw new Error("Ad row ID is missing.");

    const adRow = await supabaseAdmin
      .from("lead_ads")
      .select("id, ad_name, leads_count, status")
      .eq("company_id", companyId)
      .eq("id", adRowId)
      .maybeSingle();
    if (adRow.error) throw new Error(adRow.error.message);
    if (!adRow.data) throw new Error("Ad row not found.");
    if (String(adRow.data.status ?? "").toLowerCase() !== "archived") {
      throw new Error("Only archived ads can be removed from the list.");
    }

    const linkedLeads = await supabaseAdmin
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("lead_ad_id", adRowId);
    if (linkedLeads.error) throw new Error(linkedLeads.error.message);

    const leadCount = Math.max(Number(adRow.data.leads_count ?? 0), linkedLeads.count ?? 0);
    if (leadCount > 0) {
      throw new Error(`This ad has ${leadCount.toLocaleString("en-IN")} leads and cannot be removed from the list.`);
    }

    const removed = await supabaseAdmin
      .from("lead_ads")
      .delete()
      .eq("company_id", companyId)
      .eq("id", adRowId);
    if (removed.error) throw new Error(removed.error.message);

    revalidatePath("/leads/ads");
    setLeadsFlash({ notice: "Archived ad removed from the dashboard list." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    setLeadsFlash({ error: error instanceof Error ? error.message : "Unable to remove ad from the list." });
  }

  redirect("/leads/ads");
}

export async function createLeadSop(formData: FormData) {
  try {
    const authorization = await getAuthorization();
    if (!authorization) redirect("/login");
    const companyId = requireCompanyId(authorization);
    if (!hasPermission(authorization, "leads_sop", "add")) redirect("/unauthorized?page=leads_sop&action=add");
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const code = required(formData.get("code"), "Role code").toUpperCase();
    const name = required(formData.get("name"), "Role name");
    const requiredFields = parseLeadFields(formData);

    const { error } = await supabaseAdmin.from("lead_job_roles").insert(withCompany({
      code,
      name,
      required_fields: requiredFields,
      is_active: true
    }, companyId));
    if (error) throw new Error(error.message);

    await syncDesignationFromSop(code, name, companyId);
    revalidatePath("/leads/ad-sop");
    revalidatePath("/delivery-network/designations");
    setLeadsFlash({ notice: "Ad SOP added." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    setLeadsFlash({ error: error instanceof Error ? error.message : "Unable to add Ad SOP." });
  }

  redirect("/leads/ad-sop");
}

export async function updateLeadSop(formData: FormData) {
  try {
    const authorization = await getAuthorization();
    if (!authorization) redirect("/login");
    const companyId = requireCompanyId(authorization);
    if (!hasPermission(authorization, "leads_sop", "edit")) redirect("/unauthorized?page=leads_sop&action=edit");
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const id = required(formData.get("id"), "Ad SOP");
    const code = required(formData.get("code"), "Role code").toUpperCase();
    const name = required(formData.get("name"), "Role name");
    const requiredFields = parseLeadFields(formData);

    const { error } = await supabaseAdmin
      .from("lead_job_roles")
      .update({
        code,
        name,
        required_fields: requiredFields,
        updated_at: new Date().toISOString()
      })
      .eq("company_id", companyId)
      .eq("id", id);
    if (error) throw new Error(error.message);

    await syncDesignationFromSop(code, name, companyId);
    revalidatePath("/leads/ad-sop");
    revalidatePath("/delivery-network/designations");
    setLeadsFlash({ notice: "Ad SOP updated." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    setLeadsFlash({ error: error instanceof Error ? error.message : "Unable to update Ad SOP." });
  }

  redirect("/leads/ad-sop");
}
