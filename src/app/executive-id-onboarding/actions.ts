"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadCodLocations } from "@/lib/ops-pulse/cod";
import { supabaseAdmin } from "@/lib/supabase-admin";

function returnPath() {
  try {
    return new URL(headers().get("referer") ?? "http://localhost").pathname.startsWith("/delivery-network/")
      ? "/delivery-network/id-onboarding"
      : "/executive-id-onboarding";
  } catch {
    return "/executive-id-onboarding";
  }
}

export async function updateOnboardingStatus(formData: FormData) {
  const targetPath = returnPath();
  const authorization = await requirePagePermission("executive_id_onboarding", "edit");
  const companyId = requireCompanyId(authorization);
  const { locations } = await loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess);
  const id = String(formData.get("id") ?? "");
  const stationCode = String(formData.get("station_code") ?? "").trim().toUpperCase();
  const status = String(formData.get("status") ?? "");
  const actionItem = String(formData.get("action_item") ?? "").trim().slice(0, 500);
  if (!id || !locations.some((location) => location.station_code === stationCode) || !["pending", "cleared"].includes(status)) {
    redirect(`${targetPath}?error=Invalid+update`);
  }
  if (!supabaseAdmin) redirect(`${targetPath}?error=Service+unavailable`);
  const existing = await supabaseAdmin.from("report_import_rows").select("station_code,raw_data,normalized_data").eq("company_id", companyId).eq("id", id).single();
  if (existing.error) redirect(`${targetPath}?error=${encodeURIComponent(existing.error.message)}`);
  const normalized = existing.data?.normalized_data && typeof existing.data.normalized_data === "object" ? existing.data.normalized_data : {};
  const stored = { ...(existing.data?.raw_data ?? {}), ...normalized };
  const stationField = Object.entries(stored).find(([label]) => ["stationcode", "station", "locationcode"].includes(label.toLowerCase().replace(/[^a-z0-9]/g, "")));
  const storedStation = String(existing.data?.station_code || stationField?.[1] || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!storedStation || !locations.some((location) => location.station_code === storedStation)) {
    redirect(`${targetPath}?error=Record+is+outside+your+station+access`);
  }
  const { error } = await supabaseAdmin.from("report_import_rows").update({
    normalized_data: {
      ...normalized,
      ops_action_item: actionItem || null,
      ops_clearance_status: status,
      ops_cleared_at: status === "cleared" ? new Date().toISOString() : null,
      ops_updated_by: authorization.userId
    }
  }).eq("company_id", companyId).eq("id", id);
  redirect(`${targetPath}?${error ? `error=${encodeURIComponent(error.message)}` : "saved=1"}`);
}
