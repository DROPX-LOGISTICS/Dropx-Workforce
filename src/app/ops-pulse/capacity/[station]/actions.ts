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

export async function saveDailyCapacityReview(formData: FormData) {
  const authorization = await requirePagePermission("cps_associates", "edit");
  const companyId = requireCompanyId(authorization);
  const stationCode = String(formData.get("station_code") ?? "").trim().toUpperCase();
  const reviewDate = String(formData.get("review_date") ?? "");
  const regularStrength = Math.max(0, Number(formData.get("regular_strength") ?? 0));
  const regularPresent = Math.max(0, Number(formData.get("regular_present") ?? 0));
  const adHocPresent = Math.max(0, Number(formData.get("ad_hoc_present") ?? 0));
  const leftOrResigned = Math.max(0, Number(formData.get("left_or_resigned") ?? 0));
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000);
  const from = String(formData.get("from") ?? "");
  const to = String(formData.get("to") ?? "");
  const locationResult = await loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess);
  const validStation = locationResult.locations.some((location) => location.station_code === stationCode);
  if (!validStation || !/^\d{4}-\d{2}-\d{2}$/.test(reviewDate) || regularPresent > regularStrength || !note) {
    redirect(`/capacity/${stationCode}?from=${from}&to=${to}&review_date=${reviewDate}&error=${encodeURIComponent("Enter valid regular strength, regular present and a review note. Regular present cannot exceed strength.")}`);
  }
  if (!supabaseAdmin) redirect(`/capacity/${stationCode}?error=Service+unavailable`);
  const shipment = await supabaseAdmin.from("cps_shipment_daily").select("provider_employee_id")
    .eq("company_id", companyId).eq("station_code", stationCode).eq("work_date", reviewDate).limit(5000);
  const systemRoadIds = new Set((shipment.data ?? []).map((row) => row.provider_employee_id).filter(Boolean)).size;
  const actualActive = regularPresent + adHocPresent;
  const absent = Math.max(0, regularStrength - regularPresent);
  const reviewedAt = new Date().toISOString();
  const payload = {
    stationCode, reviewDate, systemRoadIds, regularStrength, regularPresent, adHocPresent, actualActive, absent,
    absenteeismRate: regularStrength ? absent / regularStrength * 100 : 0,
    leftOrResigned, note, reviewedAt, reviewedBy: authorization.userId
  };
  const result = await supabaseAdmin.from("report_import_master").upsert({
    company_id: companyId,
    source_code: `capacity_review_${stationCode.toLowerCase()}_${reviewDate.replace(/-/g, "")}`,
    name: `${stationCode} Capacity Review ${reviewDate}`,
    description: JSON.stringify(payload),
    file_types: [],
    day_offset: 0,
    frequency: "daily",
    parser_type: "capacity_daily_review",
    dedupe_fields: ["station_code", "review_date"],
    is_active: true,
    updated_at: reviewedAt
  }, { onConflict: "company_id,source_code" });
  revalidatePath(`/ops-pulse/capacity/${stationCode}`);
  revalidatePath("/ops-pulse/capacity");
  redirect(`/capacity/${stationCode}?from=${from}&to=${to}&review_date=${reviewDate}&${result.error ? `error=${encodeURIComponent(result.error.message)}` : "review_saved=1"}`);
}
