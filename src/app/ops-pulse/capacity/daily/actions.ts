"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isCompanyOwner, requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { loadCapacityStationDays } from "@/lib/ops-pulse/capacity-shipments";
import { loadCodLocations } from "@/lib/ops-pulse/cod";
import { isAmazonEdspXptLocation } from "@/lib/ops-pulse/operating-context";
import { supabaseAdmin } from "@/lib/supabase-admin";

function integer(formData: FormData, name: string) {
  const raw = String(formData.get(name) ?? "").trim();
  if (!raw) return { valid: true, value: null };
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0
    ? { valid: true, value }
    : { valid: false, value: null };
}

function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()); }
function shift(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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
  if (workDate < shift(today(), -1) && !isCompanyOwner(authorization)) {
    redirect(`${back}&error=${encodeURIComponent("This date is locked. Only the company owner can correct records after the next-day review.")}`);
  }
  const sourceResult = await loadCapacityStationDays(companyId, stationCodes, workDate, workDate);
  if (sourceResult.error) redirect(`${back}&error=${encodeURIComponent(sourceResult.error.message)}`);
  const sourceMap = new Map((sourceResult.data ?? []).map((row) => [row.station_code, row]));
  const now = new Date().toISOString();
  const records = stationCodes.map((stationCode) => {
    const parsed = [
      integer(formData, `assigned_${stationCode}`),
      integer(formData, `regular_bike_${stationCode}`),
      integer(formData, `regular_van_${stationCode}`),
      integer(formData, `regular_van_vehicle_${stationCode}`),
      integer(formData, `adhoc_bike_${stationCode}`),
      integer(formData, `adhoc_van_vehicle_${stationCode}`),
      integer(formData, `adhoc_van_${stationCode}`),
    ];
    if (parsed.some((item) => !item.valid)) return null;
    const [assignedPackages, regularBike, regularVan, regularVanVehicle, adHocBike, adHocVanVehicle, adHocVan] =
      parsed.map((item) => item.value);
    const source = sourceMap.get(stationCode);
    const sourceReady = Boolean(source && (Number(source.detail_active_ids) > 0 || Number(source.daily_count_active_ids) > 0 || Number(source.delivered) > 0));
    const systemIdsAtSave = sourceReady ? Number(source?.active_ids ?? 0) : null;
    const hasGroundHeadcount = [regularBike, regularVan, adHocBike, adHocVan].some((value) => value != null && value > 0);
    const classifiedIds = hasGroundHeadcount
      ? (regularBike ?? 0) + (regularVan ?? 0) + (adHocBike ?? 0) + (adHocVan ?? 0)
      : null;
    const payload = {
      stationCode, workDate, assignedPackages, regularBike, regularVan, regularVanVehicle,
      adHocBike, adHocVanVehicle, adHocVan, classifiedIds, systemIdsAtSave,
      inboundAtSave: Number(source?.inbound ?? 0), updatedAt: now, updatedBy: authorization.userId
    };
    const remove = [assignedPackages, regularBike, regularVan, regularVanVehicle, adHocBike, adHocVanVehicle, adHocVan]
      .every((value) => value == null);
    return {
      remove,
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
    redirect(`${back}&error=${encodeURIComponent("Counts must be blank or whole numbers of zero or more.")}`);
  }
  const validRecords = records as NonNullable<(typeof records)[number]>[];
  const removals = validRecords.filter((record) => record.remove).map((record) => record.source_code);
  const updates = validRecords.filter((record) => !record.remove).map(({ remove: _remove, ...record }) => record);
  const removalResult = removals.length
    ? await supabaseAdmin.from("report_import_master").delete().eq("company_id", companyId).in("source_code", removals)
    : { error: null };
  const updateResult = updates.length
    ? await supabaseAdmin.from("report_import_master").upsert(updates, { onConflict: "company_id,source_code" })
    : { error: null };
  const error = removalResult.error || updateResult.error;
  revalidatePath("/ops-pulse/capacity/daily");
  revalidatePath("/ops-pulse/capacity");
  redirect(`${back}&${error ? `error=${encodeURIComponent(error.message)}` : `saved=${records.length}`}`);
}
