"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { deleteCapacityRegionMap, deleteCapacityRule, saveCapacityRegionMap, saveCapacityRule } from "@/lib/ops-pulse/capacity";
import { loadCodLocations } from "@/lib/ops-pulse/cod";
import { operatingModeForLocation } from "@/lib/ops-pulse/operating-context";

export async function upsertCapacityRule(formData: FormData) {
  const authorization = await requirePagePermission("cod_master", "edit");
  const companyId = requireCompanyId(authorization);
  const stationCode = String(formData.get("station_code") ?? "").trim().toUpperCase();
  const targetSpr = Number(formData.get("target_spr"));
  const maxSafeSpr = Number(formData.get("max_safe_spr"));
  const bufferPercent = Number(formData.get("buffer_percent"));
  const recentDays = Number(formData.get("recent_days"));
  const invalid = !stationCode || targetSpr <= 0 || maxSafeSpr <= 0 || bufferPercent < 0 || recentDays < 1 || recentDays > 31;
  const error = invalid ? "Enter valid positive planning values." : await saveCapacityRule(companyId, {
    stationCode, targetSpr, maxSafeSpr, bufferPercent, recentDays, isActive: true
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
  if (targetSpr <= 0 || maxSafeSpr <= 0 || bufferPercent < 0 || recentDays < 1 || recentDays > 31) {
    redirect("/master/capacity?error=Enter+valid+bulk+planning+values.");
  }
  const locationResult = await loadCodLocations(companyId, authorization.locationScopeIds, authorization.hasAllLocationAccess);
  const eligibleLocations = locationResult.locations.filter((location) => operatingModeForLocation(location) !== "amazon_now");
  const errors = (await Promise.all(eligibleLocations.map((location) => saveCapacityRule(companyId, {
    stationCode: location.station_code,
    targetSpr,
    maxSafeSpr,
    bufferPercent,
    recentDays,
    isActive: true
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
