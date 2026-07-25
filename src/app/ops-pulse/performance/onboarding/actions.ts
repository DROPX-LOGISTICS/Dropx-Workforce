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
  const locationId = String(formData.get("location_id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !locations.some((location) => location.id === locationId) || !["pending", "active"].includes(status)) {
    redirect("/ops-pulse/performance/onboarding?error=Invalid+update");
  }
  if (!supabaseAdmin) redirect("/ops-pulse/performance/onboarding?error=Service+unavailable");
  const { error } = await supabaseAdmin.from("field_executives").update({
    onboarding_status: status,
    updated_at: new Date().toISOString()
  }).eq("id", id).eq("location_id", locationId);
  redirect(`/ops-pulse/performance/onboarding?${error ? `error=${encodeURIComponent(error.message)}` : "saved=1"}`);
}
