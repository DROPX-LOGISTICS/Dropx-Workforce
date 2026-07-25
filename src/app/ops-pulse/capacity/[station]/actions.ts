"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadCodLocations } from "@/lib/ops-pulse/cod";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function submitCapacityRequest(formData: FormData) {
  const authorization = await requirePagePermission("cps_associates", "edit");
  const companyId = requireCompanyId(authorization);
  const stationCode = String(formData.get("station_code") ?? "").trim().toUpperCase();
  const adHocIds = Math.max(0, Number(formData.get("ad_hoc_ids") ?? 0));
  const requestedAdditional = Math.max(0, Number(formData.get("requested_additional") ?? 0));
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 1000);
  const from = String(formData.get("from") ?? "");
  const to = String(formData.get("to") ?? "");
  const locationResult = await loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess);
  if (!stationCode || !locationResult.locations.some((location) => location.station_code === stationCode) || !reason || (!adHocIds && !requestedAdditional)) {
    redirect(`/capacity/${encodeURIComponent(stationCode)}?from=${from}&to=${to}&error=${encodeURIComponent("Enter ad hoc IDs or additional headcount required, with a reason.")}`);
  }
  if (!supabaseAdmin) redirect(`/capacity/${stationCode}?error=Service+unavailable`);
  const createdAt = new Date().toISOString();
  const sourceCode = `capacity_request_${stationCode.toLowerCase()}_${createdAt.replace(/[^0-9]/g, "")}`;
  const result = await supabaseAdmin.from("report_import_master").insert({
    company_id: companyId,
    source_code: sourceCode,
    name: `${stationCode} Capacity Request`,
    description: JSON.stringify({ stationCode, adHocIds, requestedAdditional, reason, status: "pending", from, to, createdAt, createdBy: authorization.userId }),
    file_types: [],
    day_offset: 0,
    frequency: "daily",
    parser_type: "capacity_ops_request",
    dedupe_fields: ["source_code"],
    is_active: true,
    updated_at: createdAt
  });
  revalidatePath(`/ops-pulse/capacity/${stationCode}`);
  redirect(`/capacity/${stationCode}?from=${from}&to=${to}&${result.error ? `error=${encodeURIComponent(result.error.message)}` : "saved=1"}`);
}
