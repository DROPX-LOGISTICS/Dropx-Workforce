import { supabaseAdmin } from "@/lib/supabase-admin";

export type LeadRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  postal_code: string | null;
  station_code: string | null;
  job_code: string | null;
  source: string;
  status: string;
  follow_up_at: string | null;
  interview_at: string | null;
  final_status: string | null;
  remarks: string | null;
  final_remarks: string | null;
  work_email: string | null;
  lead_created_at: string | null;
  updated_at: string;
};

export type LeadAdRow = {
  id: string;
  meta_ad_id: string | null;
  ad_name: string;
  station_code: string | null;
  job_code: string | null;
  daily_budget: number | null;
  total_spend: number;
  leads_count: number;
  status: string;
  poster_url: string | null;
  created_on: string | null;
  updated_at: string | null;
};

export type LeadJobRoleRow = {
  id: string;
  code: string;
  name: string;
  required_fields: string[];
};

export type LeadWorkspaceData = {
  error: string | null;
  counts: {
    total: number;
    noStatus: number;
    noResponse: number;
    callBack: number;
    interviews: number;
    joined: number;
    overdue: number;
  };
  recentLeads: LeadRow[];
  followups: LeadRow[];
  interviews: LeadRow[];
  ads: LeadAdRow[];
  roles: LeadJobRoleRow[];
  stationSummary: Array<{
    stationCode: string;
    total: number;
    noStatus: number;
    noResponse: number;
    callBack: number;
    interview: number;
    joined: number;
  }>;
};

const emptyData: LeadWorkspaceData = {
  error: null,
  counts: {
    total: 0,
    noStatus: 0,
    noResponse: 0,
    callBack: 0,
    interviews: 0,
    joined: 0,
    overdue: 0
  },
  recentLeads: [],
  followups: [],
  interviews: [],
  ads: [],
  roles: [],
  stationSummary: []
};

async function countByStatus(companyId: string, status?: string) {
  if (!supabaseAdmin) return { count: 0, error: null as string | null };
  let query = supabaseAdmin.from("leads").select("id", { count: "exact", head: true }).eq("company_id", companyId);
  if (status) query = query.eq("status", status);
  const result = await query;
  return { count: result.count ?? 0, error: result.error?.message ?? null };
}

export async function loadLeadWorkspaceData(companyId: string): Promise<LeadWorkspaceData> {
  if (!supabaseAdmin) return { ...emptyData, error: "Supabase service role key is not configured." };

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [
    total,
    noStatus,
    noResponse,
    callBack,
    joined,
    overdue,
    recentLeads,
    followups,
    interviews,
    ads,
    roles,
    summaryRows
  ] = await Promise.all([
    countByStatus(companyId),
    countByStatus(companyId, "no_status"),
    countByStatus(companyId, "no_response"),
    countByStatus(companyId, "call_back"),
    countByStatus(companyId, "joined"),
    supabaseAdmin.from("leads").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "no_status").lt("lead_created_at", yesterday),
    supabaseAdmin.from("leads").select("id, full_name, phone, email, city, postal_code, station_code, job_code, source, status, follow_up_at, interview_at, final_status, remarks, final_remarks, work_email, lead_created_at, updated_at").eq("company_id", companyId).order("lead_created_at", { ascending: false, nullsFirst: false }).limit(50),
    supabaseAdmin.from("leads").select("id, full_name, phone, email, city, postal_code, station_code, job_code, source, status, follow_up_at, interview_at, final_status, remarks, final_remarks, work_email, lead_created_at, updated_at").eq("company_id", companyId).in("status", ["no_response", "call_back"]).order("follow_up_at", { ascending: true, nullsFirst: false }).limit(50),
    supabaseAdmin.from("leads").select("id, full_name, phone, email, city, postal_code, station_code, job_code, source, status, follow_up_at, interview_at, final_status, remarks, final_remarks, work_email, lead_created_at, updated_at").eq("company_id", companyId).eq("status", "interview_scheduled").order("interview_at", { ascending: true, nullsFirst: false }).limit(50),
    supabaseAdmin.from("lead_ads").select("id, meta_ad_id, ad_name, station_code, job_code, daily_budget, total_spend, leads_count, status, poster_url, created_on, updated_at").eq("company_id", companyId).order("created_on", { ascending: false, nullsFirst: false }).limit(1000),
    supabaseAdmin.from("lead_job_roles").select("id, code, name, required_fields").eq("company_id", companyId).eq("is_active", true).order("code"),
    supabaseAdmin.from("leads").select("station_code, status").eq("company_id", companyId).limit(5000)
  ]);

  const error =
    total.error ||
    noStatus.error ||
    noResponse.error ||
    callBack.error ||
    joined.error ||
    overdue.error?.message ||
    recentLeads.error?.message ||
    followups.error?.message ||
    interviews.error?.message ||
    ads.error?.message ||
    roles.error?.message ||
    summaryRows.error?.message ||
    null;

  if (error) return { ...emptyData, error };

  const stationMap = new Map<string, LeadWorkspaceData["stationSummary"][number]>();
  ((summaryRows.data ?? []) as Array<{ station_code: string | null; status: string }>).forEach((row) => {
    const stationCode = row.station_code || "-";
    const current = stationMap.get(stationCode) ?? {
      stationCode,
      total: 0,
      noStatus: 0,
      noResponse: 0,
      callBack: 0,
      interview: 0,
      joined: 0
    };
    current.total += 1;
    if (row.status === "no_status") current.noStatus += 1;
    if (row.status === "no_response") current.noResponse += 1;
    if (row.status === "call_back") current.callBack += 1;
    if (row.status === "interview_scheduled") current.interview += 1;
    if (row.status === "joined") current.joined += 1;
    stationMap.set(stationCode, current);
  });

  const interviewCount = await countByStatus(companyId, "interview_scheduled");

  return {
    error: null,
    counts: {
      total: total.count,
      noStatus: noStatus.count,
      noResponse: noResponse.count,
      callBack: callBack.count,
      interviews: interviewCount.count,
      joined: joined.count,
      overdue: overdue.count ?? 0
    },
    recentLeads: (recentLeads.data ?? []) as LeadRow[],
    followups: (followups.data ?? []) as LeadRow[],
    interviews: (interviews.data ?? []) as LeadRow[],
    ads: (ads.data ?? []) as LeadAdRow[],
    roles: (roles.data ?? []) as LeadJobRoleRow[],
    stationSummary: [...stationMap.values()].sort((left, right) => right.noStatus + right.noResponse - (left.noStatus + left.noResponse)).slice(0, 20)
  };
}
