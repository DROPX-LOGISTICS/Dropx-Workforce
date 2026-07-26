"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadCapacityStationDays } from "@/lib/ops-pulse/capacity-shipments";
import { loadCodLocations } from "@/lib/ops-pulse/cod";
import { isAmazonEdspXptLocation } from "@/lib/ops-pulse/operating-context";
import { supabaseAdmin } from "@/lib/supabase-admin";

function integer(formData: FormData, name: string) {
  const value = Number(formData.get(name) ?? 0);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export async function saveCapacityGroundUpdates(formData: FormData) {
  const authorization = await requirePagePermission("cps_associates", "edit");
  const companyId = requireCompanyId(authorization);
  const workDate = String(formData.get("work_date") ?? "");
  const returnQuery = String(formData.get("return_query") ?? "");
  let requestedCodes: string[] = [];
  try { requestedCodes = JSON.parse(String(formData.get("station_codes") ?? "[]")); }
  catch { requestedCodes = []; }
  requestedCodes = [...new Set(requestedCodes.map((code) => String(code).trim().toUpperCase()).filter(Boolean))];
  const locationResult = await loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess);
  const allowed = new Set(locationResult.locations.filter(isAmazonEdspXptLocation).map((location) => location.station_code));
  const stationCodes = requestedCodes.filter((code) => allowed.has(code));
  const back = `/ops-pulse/capacity/daily?date=${encodeURIComponent(workDate)}${returnQuery ? `&${returnQuery}` : ""}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate) || !stationCodes.length || stationCodes.length !== requestedCodes.length) {
    redirect(`${back}&error=${encodeURIComponent("Select at least one permitted station and enter a valid date.")}`);
  }
  if (!supabaseAdmin) redirect(`${back}&error=${encodeURIComponent("Database service is unavailable.")}`);
  const sourceResult = await loadCapacityStationDays(companyId, stationCodes, workDate, workDate);
  if (sourceResult.error) redirect(`${back}&error=${encodeURIComponent(sourceResult.error.message)}`);
  const sourceMap = new Map((sourceResult.data ?? []).map((row) => [row.station_code, row]));
  const now = new Date().toISOString();
  const records = stationCodes.map((stationCode) => {
    const assignedPackages = integer(formData, `assigned_${stationCode}`);
    const regularBike = integer(formData, `regular_bike_${stationCode}`);
    const regularVan = integer(formData, `regular_van_${stationCode}`);
    const adHocBike = integer(formData, `adhoc_bike_${stationCode}`);
    const adHocVan = integer(formData, `adhoc_van_${stationCode}`);
    if ([assignedPackages, regularBike, regularVan, adHocBike, adHocVan].some((value) => value == null)) return null;
    const source = sourceMap.get(stationCode);
    const sourceReady = Boolean(source && (Number(source.detail_active_ids) > 0 || Number(source.daily_count_active_ids) > 0 || Number(source.delivered) > 0));
    const systemIdsAtSave = sourceReady ? Number(source?.active_ids ?? 0) : null;
    const classifiedIds = regularBike! + regularVan! + adHocBike! + adHocVan!;
    const payload = {
      stationCode, workDate, assignedPackages: assignedPackages!, regularBike: regularBike!, regularVan: regularVan!,
      adHocBike: adHocBike!, adHocVan: adHocVan!, classifiedIds, systemIdsAtSave,
      inboundAtSave: Number(source?.inbound ?? 0), updatedAt: now, updatedBy: authorization.userId
    };
    return {
      company_id: companyId,
      source_code: `capacity_ground_${stationCode.toLowerCase()}_${workDate.replace(/-/g, "")}`,
      name: `${stationCode} Ground Capacity ${workDate}`,
      description: JSON.stringify(payload),
      file_types: [],
      day_offset: 0,
      frequency: "daily",
      parser_type: "capacity_daily_ground",
      dedupe_fields: ["station_code", "work_date"],
      is_active: true,
      updated_at: now
    };
  });
  if (records.some((record) => !record)) {
    redirect(`${back}&error=${encodeURIComponent("Counts must be whole numbers of zero or more.")}`);
  }
  const result = await supabaseAdmin.from("report_import_master").upsert(records as NonNullable<typeof records[number]>[], { onConflict: "company_id,source_code" });
  revalidatePath("/ops-pulse/capacity/daily");
  revalidatePath("/ops-pulse/capacity");
  redirect(`${back}&${result.error ? `error=${encodeURIComponent(result.error.message)}` : `saved=${records.length}`}`);
}
