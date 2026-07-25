"use server";

import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadCodLocations } from "@/lib/ops-pulse/cod";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function updateOnboardingStatus(formData: FormData) {
  const authorization = await requirePagePermission("cod_reports", "edit");
  const companyId = requireCompanyId(authorization);
  const { locations } = await loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess);
  const id = String(formData.get("id") ?? "");
  const stationCode = String(formData.get("station_code") ?? "").trim().toUpperCase();
  const status = String(formData.get("status") ?? "");
  const actionItem = String(formData.get("action_item") ?? "").trim().slice(0, 500);
  if (!id || !locations.some((location) => location.station_code === stationCode) || !["pending", "cleared"].includes(status)) {
    redirect("/executive-id-onboarding?error=Invalid+update");
  }
  if (!supabaseAdmin) redirect("/executive-id-onboarding?error=Service+unavailable");
  const existing = await supabaseAdmin.from("report_import_rows").select("normalized_data").eq("company_id", companyId).eq("id", id).single();
  if (existing.error) redirect(`/executive-id-onboarding?error=${encodeURIComponent(existing.error.message)}`);
  const normalized = existing.data?.normalized_data && typeof existing.data.normalized_data === "object" ? existing.data.normalized_data : {};
  const { error } = await supabaseAdmin.from("report_import_rows").update({
    normalized_data: {
      ...normalized,
      ops_action_item: actionItem || null,
      ops_clearance_status: status,
      ops_cleared_at: status === "cleared" ? new Date().toISOString() : null,
      ops_updated_by: authorization.userId
    }
  }).eq("company_id", companyId).eq("id", id);
  redirect(`/executive-id-onboarding?${error ? `error=${encodeURIComponent(error.message)}` : "saved=1"}`);
}
