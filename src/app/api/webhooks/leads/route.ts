import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { webhookCompanyId } from "@/lib/webhook-company";
import { sendWorkforceApplicantWhatsApp } from "@/lib/workforce-applicant-whatsapp";

export const dynamic = "force-dynamic";

type LeadgenValue = {
  ad_id?: string;
  form_id?: string;
  leadgen_id?: string;
  page_id?: string;
  created_time?: number;
};

type MetaLeadWebhookPayload = {
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: LeadgenValue;
    }>;
  }>;
};

type MetaLeadField = {
  name?: string;
  values?: string[];
};

type MetaLeadDetails = {
  id?: string;
  created_time?: string;
  ad_id?: string;
  form_id?: string;
  field_data?: MetaLeadField[];
  error?: { message?: string };
};

function clean(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeFieldName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function fieldValue(fields: Record<string, string>, names: string[]) {
  for (const name of names) {
    const normalized = normalizeFieldName(name);
    if (fields[normalized]) return fields[normalized];
  }
  return null;
}

function parseAdName(adName: string | null | undefined) {
  const text = clean(adName);
  if (!text) return { stationCode: null, jobCode: null };
  const [stationCode, ...rest] = text.split("_");
  return {
    stationCode: clean(stationCode)?.toUpperCase() ?? null,
    jobCode: clean(rest.join("_"))?.toUpperCase() ?? null
  };
}

async function configuredVerifyToken(companyId: string | null) {
  if (!supabaseAdmin) return "";
  if (!companyId) return "";
  let query = supabaseAdmin
    .from("meta_leads_settings")
    .select("webhook_verify_token")
    .eq("id", true);
  if (companyId) query = query.eq("company_id", companyId);
  const result = await query.maybeSingle();
  if (result.error) return "";
  return result.data?.webhook_verify_token ?? "";
}

async function loadLeadSettings(companyId: string | null) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  if (!companyId) throw new Error("Webhook company is missing. Use the company-specific webhook URL.");
  let settingsQuery = supabaseAdmin
    .from("meta_leads_settings")
    .select("is_enabled, graph_api_version, access_token_secret_id")
    .eq("id", true);
  if (companyId) settingsQuery = settingsQuery.eq("company_id", companyId);
  const settings = await settingsQuery.maybeSingle();
  if (settings.error) throw new Error(settings.error.message);
  if (!settings.data?.is_enabled) throw new Error("Meta lead capture is disabled.");
  if (!settings.data.access_token_secret_id) throw new Error("Meta lead access token is missing.");
  const tokenResult = await supabaseAdmin.rpc("get_meta_leads_access_token", { company_uuid: companyId });
  if (tokenResult.error) throw new Error(tokenResult.error.message);
  if (!tokenResult.data) throw new Error("Meta lead access token is missing.");
  return {
    graphVersion: settings.data.graph_api_version || "v25.0",
    accessToken: String(tokenResult.data)
  };
}

async function fetchLeadDetails(leadgenId: string, graphVersion: string, accessToken: string) {
  const url = new URL(`https://graph.facebook.com/${graphVersion}/${leadgenId}`);
  url.searchParams.set("fields", "id,created_time,ad_id,form_id,field_data");
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url);
  const payload = await response.json() as MetaLeadDetails;
  if (!response.ok || payload.error) throw new Error(payload.error?.message || `Meta lead request failed with ${response.status}.`);
  return payload;
}

async function fetchAdName(adId: string | null, graphVersion: string, accessToken: string) {
  if (!adId) return null;
  const url = new URL(`https://graph.facebook.com/${graphVersion}/${adId}`);
  url.searchParams.set("fields", "name");
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url);
  const payload = await response.json() as { name?: string; error?: { message?: string } };
  if (!response.ok || payload.error) return null;
  return payload.name ?? null;
}

async function resolveAd(adId: string | null, adName: string | null, graphVersion: string, accessToken: string, companyId: string | null) {
  if (!supabaseAdmin || !adId) return { leadAdId: null as string | null, stationCode: null as string | null, jobCode: null as string | null };
  let existingQuery = supabaseAdmin
    .from("lead_ads")
    .select("id, ad_name, station_code, job_code")
    .eq("meta_ad_id", adId);
  if (companyId) existingQuery = existingQuery.eq("company_id", companyId);
  const existing = await existingQuery.maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) {
    return {
      leadAdId: existing.data.id as string,
      stationCode: existing.data.station_code as string | null,
      jobCode: existing.data.job_code as string | null
    };
  }

  const fetchedName = adName ?? await fetchAdName(adId, graphVersion, accessToken);
  const parsed = parseAdName(fetchedName ?? adId);
  const role = parsed.jobCode
    ? await (companyId
      ? supabaseAdmin.from("lead_job_roles").select("id").eq("company_id", companyId).eq("code", parsed.jobCode).maybeSingle()
      : supabaseAdmin.from("lead_job_roles").select("id").eq("code", parsed.jobCode).maybeSingle())
    : { data: null, error: null };
  if (role.error) throw new Error(role.error.message);

  const saved = await supabaseAdmin
    .from("lead_ads")
    .upsert({
      company_id: companyId,
      meta_ad_id: adId,
      ad_name: fetchedName ?? adId,
      station_code: parsed.stationCode,
      job_code: parsed.jobCode,
      role_id: role.data?.id ?? null,
      status: "unknown",
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: "company_id,meta_ad_id" })
    .select("id")
    .single();
  if (saved.error) throw new Error(saved.error.message);
  return {
    leadAdId: saved.data.id as string,
    stationCode: parsed.stationCode,
    jobCode: parsed.jobCode
  };
}

async function saveLead(value: LeadgenValue, graphVersion: string, accessToken: string, companyId: string | null) {
  if (!supabaseAdmin || !value.leadgen_id) return { saved: false, reason: "missing_leadgen_id" };
  const details = await fetchLeadDetails(value.leadgen_id, graphVersion, accessToken);
  const normalizedFields = Object.fromEntries((details.field_data ?? []).map((field) => [
    normalizeFieldName(field.name ?? ""),
    field.values?.join(", ") ?? ""
  ]));
  const adId = clean(details.ad_id) ?? clean(value.ad_id);
  const ad = await resolveAd(adId, null, graphVersion, accessToken, companyId);
  const now = new Date().toISOString();
  const metaLeadId = clean(details.id) ?? value.leadgen_id;
  const saved = await supabaseAdmin
    .from("leads")
    .upsert({
      company_id: companyId,
      meta_lead_id: metaLeadId,
      lead_ad_id: ad.leadAdId,
      full_name: fieldValue(normalizedFields, ["full_name", "full name", "name"]),
      phone: fieldValue(normalizedFields, ["phone", "phone_number", "mobile", "mobile_number"]),
      email: fieldValue(normalizedFields, ["email", "email_address"]),
      city: fieldValue(normalizedFields, ["city"]),
      postal_code: fieldValue(normalizedFields, ["post_code", "postal_code", "zip_code"]),
      station_code: ad.stationCode,
      job_code: ad.jobCode,
      source: "meta",
      raw_payload: { webhook: value, lead: details, fields: normalizedFields },
      lead_created_at: details.created_time ? new Date(details.created_time).toISOString() : (value.created_time ? new Date(value.created_time * 1000).toISOString() : now),
      updated_at: now
    }, { onConflict: "company_id,meta_lead_id" })
    .select("id,company_id,full_name,phone,station_code,job_code,wa_new_sent_at")
    .single();
  if (saved.error) throw new Error(saved.error.message);
  if (!saved.data.wa_new_sent_at) waitUntil(sendWorkforceApplicantWhatsApp(saved.data));

  if (ad.leadAdId) {
    const count = await supabaseAdmin
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("lead_ad_id", ad.leadAdId);
    if (!count.error) {
      let leadAdUpdate = supabaseAdmin
        .from("lead_ads")
        .update({ leads_count: count.count ?? 0, updated_at: now })
        .eq("id", ad.leadAdId);
      if (companyId) leadAdUpdate = leadAdUpdate.eq("company_id", companyId);
      await leadAdUpdate;
    }
  }

  return { saved: true, reason: "saved" };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expectedToken = await configuredVerifyToken(webhookCompanyId(request));

  if (mode === "subscribe" && challenge && expectedToken && token === expectedToken) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Webhook verification failed", { status: 403 });
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as MetaLeadWebhookPayload;
    const changes = (payload.entry ?? [])
      .flatMap((entry) => entry.changes ?? [])
      .filter((change) => change.field === "leadgen" && change.value?.leadgen_id);
    if (!changes.length) return NextResponse.json({ received: true, saved: 0 });

    const companyId = webhookCompanyId(request);
    const settings = await loadLeadSettings(companyId);
    let saved = 0;
    const errors: string[] = [];
    for (const change of changes) {
      try {
        const result = await saveLead(change.value!, settings.graphVersion, settings.accessToken, companyId);
        if (result.saved) saved += 1;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Unable to save lead.");
      }
    }

    if (errors.length) console.error("Meta lead webhook processed with errors", { saved, errors });
    return NextResponse.json({ received: true, leadgenEvents: changes.length, saved, errors });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to process lead webhook." }, { status: 500 });
  }
}
