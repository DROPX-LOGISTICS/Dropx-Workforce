export const dynamic = "force-dynamic";

import { getAuthorization, hasPermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

type AdSpendRequest = {
  from?: string;
  to?: string;
  station?: string;
  status?: string;
};

type LeadAdRecord = {
  ad_name: string | null;
  job_code: string | null;
  meta_ad_id: string | null;
  station_code: string | null;
  status: string | null;
};

type MetaInsightRow = {
  ad_id?: string;
  spend?: string;
};

type MetaInsightsResponse = {
  data?: MetaInsightRow[];
  paging?: {
    next?: string;
  };
  error?: {
    message?: string;
  };
};

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

function cleanDate(value: string | null | undefined) {
  const clean = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean : "";
}

function currentMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const format = (date: Date) => date.toISOString().slice(0, 10);
  return {
    from: format(start),
    to: format(now)
  };
}

function money(value: string | number | null | undefined) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

async function fetchMetaAdSpend({
  accessToken,
  adAccountId,
  from,
  graphVersion,
  to
}: {
  accessToken: string;
  adAccountId: string;
  from: string;
  graphVersion: string;
  to: string;
}) {
  const params = new URLSearchParams({
    access_token: accessToken,
    fields: "ad_id,spend",
    level: "ad",
    limit: "500"
  });
  params.set("time_range[since]", from);
  params.set("time_range[until]", to);

  let url: string | undefined = `https://graph.facebook.com/${graphVersion}/${adAccountId}/insights?${params.toString()}`;
  const rows: MetaInsightRow[] = [];

  for (let page = 0; url && page < 25; page += 1) {
    const response = await fetch(url, { cache: "no-store" });
    const payload = (await response.json()) as MetaInsightsResponse;
    if (!response.ok || payload.error) {
      throw new Error(payload.error?.message || `Meta Insights request failed with ${response.status}.`);
    }
    rows.push(...(payload.data ?? []));
    url = payload.paging?.next;
  }

  return rows;
}

export async function POST(request: Request) {
  try {
    const authorization = await getAuthorization();
    if (!authorization) return Response.json({ error: "Login required." }, { status: 401 });
    if (!hasPermission(authorization, "leads_reports", "access")) {
      return Response.json({ error: "Permission required." }, { status: 403 });
    }
    if (!supabaseAdmin) return Response.json({ error: "Supabase service role key is not configured." }, { status: 500 });

    const companyId = requireCompanyId(authorization);
    const body = (await request.json().catch(() => ({}))) as AdSpendRequest;
    const defaultRange = currentMonthRange();
    const from = cleanDate(body.from) || defaultRange.from;
    const to = cleanDate(body.to) || defaultRange.to;
    const station = String(body.station ?? "").trim();
    const status = String(body.status ?? "").trim();

    if (from > to) return Response.json({ error: "From date cannot be after To date." }, { status: 400 });

    const settings = await supabaseAdmin
      .from("meta_leads_settings")
      .select("is_enabled, graph_api_version, ad_account_id, access_token_secret_id")
      .eq("id", true)
      .eq("company_id", companyId)
      .maybeSingle();
    if (settings.error) throw new Error(settings.error.message);
    if (!settings.data?.is_enabled) {
      return Response.json({ error: "Enable Meta Leads & Ads settings before fetching live spend." }, { status: 400 });
    }
    if (!settings.data.ad_account_id) return Response.json({ error: "Ad Account ID is missing in Meta Leads & Ads settings." }, { status: 400 });
    if (!settings.data.access_token_secret_id) return Response.json({ error: "Access token is missing in Meta Leads & Ads settings." }, { status: 400 });

    const tokenResult = await supabaseAdmin.rpc("get_meta_leads_access_token", { company_uuid: companyId });
    if (tokenResult.error) throw new Error(tokenResult.error.message);
    const accessToken = String(tokenResult.data ?? "").trim();
    if (!accessToken) return Response.json({ error: "Access token could not be read from Supabase vault." }, { status: 400 });

    let adQuery = supabaseAdmin
      .from("lead_ads")
      .select("ad_name, job_code, meta_ad_id, station_code, status")
      .eq("company_id", companyId)
      .not("meta_ad_id", "is", null);

    if (station) adQuery = adQuery.eq("station_code", station);
    if (status) adQuery = adQuery.eq("status", status);

    if (!authorization.hasAllLocationAccess) {
      if (!authorization.locationScopeIds.length) {
        return Response.json({ rows: [], from, to });
      }
      const locations = await supabaseAdmin
        .from("stations")
        .select("station_code")
        .eq("company_id", companyId)
        .in("id", authorization.locationScopeIds);
      if (locations.error) throw new Error(locations.error.message);
      const allowedStations = (locations.data ?? [])
        .map((row) => row.station_code)
        .filter((value): value is string => Boolean(value));
      if (!allowedStations.length || (station && !allowedStations.includes(station))) {
        return Response.json({ rows: [], from, to });
      }
      adQuery = adQuery.in("station_code", allowedStations);
    }

    const ads = await adQuery;
    if (ads.error) throw new Error(ads.error.message);
    const adRows = (ads.data ?? []) as LeadAdRecord[];
    if (!adRows.length) return Response.json({ rows: [], from, to });

    const insights = await fetchMetaAdSpend({
      accessToken,
      adAccountId: normalizeAdAccountId(settings.data.ad_account_id),
      from,
      graphVersion: normalizeGraphVersion(settings.data.graph_api_version),
      to
    });
    const spendByAdId = new Map(insights.map((row) => [String(row.ad_id ?? ""), money(row.spend)]));

    return Response.json({
      from,
      to,
      rows: adRows
        .map((ad) => ({
          adName: ad.ad_name || "-",
          location: ad.station_code || "-",
          role: ad.job_code || "-",
          spend: spendByAdId.get(String(ad.meta_ad_id ?? "")) ?? 0
        }))
        .filter((row) => row.spend > 0)
        .sort((left, right) => right.spend - left.spend || left.adName.localeCompare(right.adName))
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to fetch live ad spend." }, { status: 500 });
  }
}
