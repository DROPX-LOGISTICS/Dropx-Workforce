"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { deleteCapacityRegionMap, deleteCapacityRule, deleteCapacityServiceRoute, saveCapacityMapLayerSnapshots, saveCapacityRegionMap, saveCapacityRule, saveCapacityServiceRoute, saveShipmentSizeRule } from "@/lib/ops-pulse/capacity";
import { loadCodLocations } from "@/lib/ops-pulse/cod";
import { isAmazonEdspXptLocation } from "@/lib/ops-pulse/operating-context";

export async function upsertCapacityRule(formData: FormData) {
  const authorization = await requirePagePermission("cod_master", "edit");
  const companyId = requireCompanyId(authorization);
  const stationCode = String(formData.get("station_code") ?? "").trim().toUpperCase();
  const targetSpr = Number(formData.get("target_spr"));
  const maxSafeSpr = Number(formData.get("max_safe_spr"));
  const bufferPercent = Number(formData.get("buffer_percent"));
  const recentDays = Number(formData.get("recent_days"));
  const minimumSourceDays = Number(formData.get("minimum_source_days"));
  const associateDropPercent = Number(formData.get("associate_drop_percent"));
  const volumeSpikePercent = Number(formData.get("volume_spike_percent"));
  const locationResult = await loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess);
  const eligible = locationResult.locations.some((location) => location.station_code === stationCode && isAmazonEdspXptLocation(location));
  const invalid = !stationCode || targetSpr <= 0 || maxSafeSpr <= 0 || bufferPercent < 0
    || recentDays < 14 || recentDays > 31 || minimumSourceDays < 1 || minimumSourceDays > recentDays
    || associateDropPercent < 1 || associateDropPercent > 100 || volumeSpikePercent < 1 || volumeSpikePercent > 300;
  const error = locationResult.error
    ? locationResult.error
    : !eligible
      ? "Capacity rules are available only for Amazon EDSP and XPT stations in your scope."
      : invalid
        ? "Enter valid positive planning values."
        : await saveCapacityRule(companyId, {
          stationCode, targetSpr, maxSafeSpr, bufferPercent, recentDays, minimumSourceDays,
          associateDropPercent, volumeSpikePercent, isActive: true
        });
  revalidatePath("/master/capacity");
  revalidatePath("/ops-pulse/capacity");
  redirect(`/master/capacity?${error ? `error=${encodeURIComponent(error)}` : "saved=1"}`);
}

export async function removeCapacityRule(formData: FormData) {
  const authorization = await requirePagePermission("cod_master", "edit");
  const companyId = requireCompanyId(authorization);
  const error = await deleteCapacityRule(companyId, String(formData.get("id") ?? ""));
  revalidatePath("/master/capacity");
  revalidatePath("/ops-pulse/capacity");
  redirect(`/master/capacity?${error ? `error=${encodeURIComponent(error)}` : "deleted=1"}`);
}

export async function bulkInitializeCapacityRules(formData: FormData) {
  const authorization = await requirePagePermission("cod_master", "edit");
  const companyId = requireCompanyId(authorization);
  const targetSpr = Number(formData.get("target_spr"));
  const maxSafeSpr = Number(formData.get("max_safe_spr"));
  const bufferPercent = Number(formData.get("buffer_percent"));
  const recentDays = Number(formData.get("recent_days"));
  const minimumSourceDays = Number(formData.get("minimum_source_days"));
  const associateDropPercent = Number(formData.get("associate_drop_percent"));
  const volumeSpikePercent = Number(formData.get("volume_spike_percent"));
  if (targetSpr <= 0 || maxSafeSpr <= 0 || bufferPercent < 0
    || recentDays < 14 || recentDays > 31 || minimumSourceDays < 1 || minimumSourceDays > recentDays
    || associateDropPercent < 1 || associateDropPercent > 100 || volumeSpikePercent < 1 || volumeSpikePercent > 300) {
    redirect("/master/capacity?error=Enter+valid+bulk+planning+values.");
  }
  const locationResult = await loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess);
  if (locationResult.error) {
    redirect(`/master/capacity?error=${encodeURIComponent(locationResult.error)}`);
  }
  const eligibleLocations = locationResult.locations.filter(isAmazonEdspXptLocation);
  const errors = (await Promise.all(eligibleLocations.map((location) => saveCapacityRule(companyId, {
    stationCode: location.station_code, targetSpr, maxSafeSpr, bufferPercent, recentDays,
    minimumSourceDays, associateDropPercent, volumeSpikePercent, isActive: true
  })))).filter(Boolean);
  revalidatePath("/master/capacity");
  revalidatePath("/ops-pulse/capacity");
  redirect(`/master/capacity?${errors.length ? `error=${encodeURIComponent(errors[0] ?? "Bulk setup failed.")}` : `initialized=${eligibleLocations.length}`}`);
}

export async function upsertCapacityRegionMap(formData: FormData) {
  const authorization = await requirePagePermission("cod_master", "edit");
  const companyId = requireCompanyId(authorization);
  const name = String(formData.get("name") ?? "").trim();
  const matchField = String(formData.get("match_field") ?? "");
  const matchValue = String(formData.get("match_value") ?? "").trim();
  const mapUrl = String(formData.get("map_url") ?? "").trim();
  let validUrl = false;
  try {
    const parsed = new URL(mapUrl);
    validUrl = parsed.protocol === "https:" && (parsed.hostname === "google.com" || parsed.hostname.endsWith(".google.com")) && Boolean(parsed.searchParams.get("mid"));
  } catch {}
  const validField = matchField === "station" || matchField === "region" || matchField === "state";
  const error = !name || !matchValue || !validField || !validUrl
    ? "Enter a name, matching field/value, and a valid Google My Maps sharing URL."
    : await saveCapacityRegionMap(companyId, {
      name,
      matchField: matchField as "station" | "region" | "state",
      matchValue,
      mapUrl,
      isActive: true
    });
  revalidatePath("/master/capacity");
  revalidatePath("/ops-pulse/capacity");
  redirect(`/master/capacity?${error ? `error=${encodeURIComponent(error)}` : "map_saved=1"}`);
}

export async function removeCapacityRegionMap(formData: FormData) {
  const authorization = await requirePagePermission("cod_master", "edit");
  const companyId = requireCompanyId(authorization);
  const error = await deleteCapacityRegionMap(companyId, String(formData.get("id") ?? ""));
  revalidatePath("/master/capacity");
  revalidatePath("/ops-pulse/capacity");
  redirect(`/master/capacity?${error ? `error=${encodeURIComponent(error)}` : "map_deleted=1"}`);
}

export async function importCapacityMapKml(formData: FormData) {
  const authorization = await requirePagePermission("cod_master", "edit");
  const companyId = requireCompanyId(authorization);
  const mapUrl = String(formData.get("map_url") ?? "").trim();
  const file = formData.get("kml_file");
  const error = !(file instanceof File) || !file.name.toLowerCase().endsWith(".kml")
    ? "Choose a Google My Maps KML export."
    : await saveCapacityMapLayerSnapshots(companyId, mapUrl, await file.text());
  revalidatePath("/master/capacity");
  revalidatePath("/ops-pulse/capacity");
  redirect(`/master/capacity?${error ? `error=${encodeURIComponent(error)}` : "map_layers_saved=1"}`);
}

export async function upsertShipmentSizeRule(formData: FormData) {
  const authorization = await requirePagePermission("cod_master", "edit");
  const companyId = requireCompanyId(authorization);
  const rule = {
    maxLengthCm: Number(formData.get("max_length_cm")),
    maxWidthCm: Number(formData.get("max_width_cm")),
    maxHeightCm: Number(formData.get("max_height_cm")),
    maxWeightKg: Number(formData.get("max_weight_kg")),
    dimensionalDivisor: Number(formData.get("dimensional_divisor")),
    maxDimensionalWeightKg: Number(formData.get("max_dimensional_weight_kg")),
    minActiveShipments: Number(formData.get("min_active_shipments"))
  };
  const invalid = Object.values(rule).some((value) => !Number.isFinite(value) || value <= 0);
  const error = invalid ? "Enter valid positive shipment-size limits." : await saveShipmentSizeRule(companyId, rule);
  revalidatePath("/master/capacity");
  revalidatePath("/ops-pulse/capacity");
  redirect(`/master/capacity?${error ? `error=${encodeURIComponent(error)}` : "size_saved=1"}`);
}

export async function upsertCapacityServiceRoute(formData: FormData) {
  const authorization = await requirePagePermission("cod_master", "edit");
  const companyId = requireCompanyId(authorization);
  const stationCode = String(formData.get("station_code") ?? "").trim().toUpperCase();
  const routeName = String(formData.get("route_name") ?? "").trim();
  const vehicleType = String(formData.get("vehicle_type") ?? "");
  const pincode = String(formData.get("pincode") ?? "").replace(/\D/g, "");
  const daId = String(formData.get("da_id") ?? "").trim();
  const daName = String(formData.get("da_name") ?? "").trim();
  const color = String(formData.get("color") ?? "").trim();
  const coordinates = String(formData.get("coordinates") ?? "").split(/[\n;]/).map((line) => {
    const [lat, lng] = line.trim().split(",").map(Number);
    return { lat, lng };
  }).filter((point) => Number.isFinite(point.lat) && point.lat >= -90 && point.lat <= 90 && Number.isFinite(point.lng) && point.lng >= -180 && point.lng <= 180);
  const validVehicle = vehicleType === "bike" || vehicleType === "van";
  const error = !stationCode || !routeName || !validVehicle || !/^\d{6}$/.test(pincode) || !daId || coordinates.length < 2
    ? "Enter station, route, vehicle, six-digit pincode, DA ID and at least two valid latitude,longitude points."
    : await saveCapacityServiceRoute(companyId, {
      stationCode, routeName, vehicleType: vehicleType as "bike" | "van", pincode, daId, daName,
      color: /^#[0-9a-f]{6}$/i.test(color) ? color : vehicleType === "van" ? "#7c3aed" : "#ea580c",
      coordinates, isActive: true
    });
  revalidatePath("/master/capacity");
  revalidatePath(`/ops-pulse/capacity/${stationCode}`);
  redirect(`/master/capacity?${error ? `error=${encodeURIComponent(error)}` : "route_saved=1"}`);
}

export async function removeCapacityServiceRoute(formData: FormData) {
  const authorization = await requirePagePermission("cod_master", "edit");
  const companyId = requireCompanyId(authorization);
  const error = await deleteCapacityServiceRoute(companyId, String(formData.get("id") ?? ""));
  revalidatePath("/master/capacity");
  revalidatePath("/ops-pulse/capacity");
  redirect(`/master/capacity?${error ? `error=${encodeURIComponent(error)}` : "route_deleted=1"}`);
}
