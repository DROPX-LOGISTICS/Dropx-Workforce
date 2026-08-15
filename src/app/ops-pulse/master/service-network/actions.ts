"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { deleteServiceNetworkRule, loadServiceNetworkRules, saveServiceNetworkRule } from "@/lib/ops-pulse/service-network";
import { supabaseAdmin } from "@/lib/supabase-admin";

function clean(value: FormDataEntryValue | null) { return String(value ?? "").trim(); }
function positive(value: FormDataEntryValue | null, label: string) { const number = Number(value); if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be greater than zero.`); return number; }
function pincodeCoordinates(value: FormDataEntryValue | null) {
  const coordinates: Record<string, { lat: number; lng: number }> = {};
  clean(value).split(/\r?\n/).map(line => line.trim()).filter(Boolean).forEach((line, index) => {
    const [pincode, rawLat, rawLng] = line.split(/[,\t|]+/).map(item => item.trim());
    const lat = Number(rawLat), lng = Number(rawLng);
    if (!/^\d{6}$/.test(pincode) || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new Error(`Pincode coordinate row ${index + 1} must be PINCODE, LATITUDE, LONGITUDE.`);
    }
    coordinates[pincode] = { lat, lng };
  });
  return coordinates;
}
function finish(params: { station?: string; notice?: string; error?: string }): never { const query = new URLSearchParams(Object.entries(params).filter(([,v]) => v).map(([k,v]) => [k, String(v)])); redirect(`/ops-pulse/master/service-network?${query}`); }

async function permittedStation(companyId: string, stationId: string, stationCode: string, locationScopeIds: string[], allLocations: boolean) {
  if (!supabaseAdmin) throw new Error("Database service is unavailable.");
  const result = await supabaseAdmin.from("stations").select("id,station_code").eq("company_id", companyId).eq("id", stationId).eq("station_code", stationCode).eq("is_active", true).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error("The station is not active in OpsPulse.");
  if (!allLocations && !locationScopeIds.includes(stationId)) throw new Error("Station access denied.");
  return result.data;
}

export async function saveServiceNetworkMaster(formData: FormData) {
  const authorization = await requirePagePermission("service_network_master", "edit");
  const companyId = requireCompanyId(authorization);
  const stationCode = clean(formData.get("station_code")).toUpperCase();
  try {
    if (!stationCode) throw new Error("Choose a station.");
    const pincodes = [...new Set(clean(formData.get("pincodes")).split(/[,\s]+/).map(value => value.trim()).filter(Boolean))];
    if (pincodes.some(value => !/^\d{6}$/.test(value))) throw new Error("Every service pincode must contain six digits.");
    const error = await saveServiceNetworkRule(companyId, {
      stationCode,
      serviceRadiusKm: positive(formData.get("service_radius_km"), "Service radius"),
      bikeSpr: positive(formData.get("bike_spr"), "Bike SPR"),
      vanSpr: positive(formData.get("van_spr"), "Van SPR"),
      bufferPercent: Math.max(0, Number(formData.get("buffer_percent") ?? 0)),
      pincodeOwnership: pincodes,
      pincodeCoordinates: pincodeCoordinates(formData.get("pincode_coordinates")),
      jurisdictionOwner: clean(formData.get("jurisdiction_owner")),
      effectiveFrom: clean(formData.get("effective_from")),
      effectiveTo: clean(formData.get("effective_to")),
      isActive: formData.get("is_active") === "on"
    });
    if (error) throw new Error(error);
    revalidatePath("/ops-pulse/service-network"); revalidatePath("/ops-pulse/master/service-network");
  } catch (error) { finish({ station: stationCode, error: error instanceof Error ? error.message : "Unable to save service network rule." }); }
  finish({ station: stationCode, notice: "Service network rule saved." });
}

export async function removeServiceNetworkMaster(formData: FormData) {
  const authorization = await requirePagePermission("service_network_master", "edit");
  const companyId = requireCompanyId(authorization);
  const id = clean(formData.get("id")), stationCode = clean(formData.get("station_code"));
  const error = id ? await deleteServiceNetworkRule(companyId, id) : "Rule ID is missing.";
  if (error) finish({ station: stationCode, error });
  revalidatePath("/ops-pulse/service-network"); revalidatePath("/ops-pulse/master/service-network");
  finish({ notice: "Service network rule removed." });
}

export async function saveNetworkSector(formData: FormData) {
  const authorization = await requirePagePermission("service_network_master", "edit");
  const companyId = requireCompanyId(authorization);
  const stationCode = clean(formData.get("station_code")).toUpperCase();
  try {
    if (!supabaseAdmin) throw new Error("Database service is unavailable.");
    const stationId = clean(formData.get("station_id"));
    await permittedStation(companyId, stationId, stationCode, authorization.locationScopeIds, authorization.hasAllLocationAccess);
    const code = clean(formData.get("sector_code")).toUpperCase().replace(/[^A-Z0-9_-]+/g, "_");
    const name = clean(formData.get("sector_name"));
    if (!code || !name) throw new Error("Sector code and name are required.");
    const expectedDailyVolume = Number(formData.get("expected_daily_volume"));
    const bikeVolumePercent = Number(formData.get("bike_volume_percent"));
    if (!Number.isInteger(expectedDailyVolume) || expectedDailyVolume < 0) throw new Error("Expected volume must be zero or more.");
    if (!Number.isFinite(bikeVolumePercent) || bikeVolumePercent < 0 || bikeVolumePercent > 100) throw new Error("Bike volume mix must be between 0 and 100%.");
    const values = [...new Set(clean(formData.get("pincodes")).split(/[,\s]+/).filter(Boolean))];
    if (values.some(value => !/^\d{6}$/.test(value))) throw new Error("Every sector pincode must contain six digits.");
    const rules = await loadServiceNetworkRules(companyId);
    const rule = rules.rows.find(row => row.stationCode === stationCode && row.isActive);
    const outsideApproved = values.filter(value => rule?.pincodeOwnership?.length && !rule.pincodeOwnership.includes(value));
    if (outsideApproved.length && formData.get("manual_override") !== "on") throw new Error(`${outsideApproved.join(", ")} ${outsideApproved.length === 1 ? "is" : "are"} outside the approved station pincodes. Confirm manual override to continue.`);
    const tlUserId = clean(formData.get("tl_user_id")) || null;
    const ssaUserId = clean(formData.get("ssa_user_id")) || null;
    const ownerIds = [tlUserId, ssaUserId].filter(Boolean) as string[];
    if (ownerIds.length) {
      const owners = await supabaseAdmin.from("profiles").select("id,location_scope_ids,user_roles(code,location_access_mode)").eq("company_id", companyId).eq("is_active", true).in("id", ownerIds);
      if (owners.error) throw new Error(owners.error.message);
      if ((owners.data ?? []).length !== new Set(ownerIds).size) throw new Error("One of the selected sector owners is not an active OpsPulse user.");
      for (const owner of owners.data ?? []) {
        const role = Array.isArray(owner.user_roles) ? owner.user_roles[0] : owner.user_roles;
        const roleCode = String(role?.code ?? "").toUpperCase();
        const inScope = role?.location_access_mode === "all_locations" || (Array.isArray(owner.location_scope_ids) && owner.location_scope_ids.includes(stationId));
        if (!inScope) throw new Error("A selected sector owner does not have access to this station.");
        if (owner.id === ssaUserId && roleCode !== "SSA") throw new Error("The SSA owner must have the Station Support Associate role.");
        if (owner.id === tlUserId && !["TEAM_LEADER", "STATION_MANAGER", "ADMIN", "OWNER"].includes(roleCode)) throw new Error("The TL owner must have a Team Leader or higher ops role.");
      }
    }

    const existingId = clean(formData.get("sector_id"));
    const conflictResult = values.length ? await supabaseAdmin.from("ops_network_sector_pincodes").select("pincode,sector_id").eq("company_id", companyId).eq("station_id", stationId).in("pincode", values).in("service_state", ["active", "temporary", "split"]) : { data: [], error: null };
    if (conflictResult.error) throw new Error(conflictResult.error.message);
    const conflictRows = (conflictResult.data ?? []).filter(row => row.sector_id !== existingId);
    if (conflictRows.length && formData.get("shared_pincode_override") !== "on") throw new Error(`${[...new Set(conflictRows.map(row => row.pincode))].join(", ")} already belongs to another sector. Confirm split/shared pincode override to continue.`);
    const payload = {
      company_id: companyId,
      station_id: stationId,
      code,
      name,
      color: clean(formData.get("color")) || "#2563eb",
      expected_daily_volume: expectedDailyVolume,
      bike_volume_percent: bikeVolumePercent,
      tl_user_id: tlUserId,
      ssa_user_id: ssaUserId,
      notes: clean(formData.get("notes")) || null,
      is_active: true,
      created_by: authorization.userId
    };
    const saved = existingId
      ? await supabaseAdmin.from("ops_network_sectors").update(payload).eq("company_id", companyId).eq("station_id", stationId).eq("id", existingId).select("id").single()
      : await supabaseAdmin.from("ops_network_sectors").insert(payload).select("id").single();
    if (saved.error) throw new Error(saved.error.message);
    const sectorId = saved.data.id;
    const removed = await supabaseAdmin.from("ops_network_sector_pincodes").delete().eq("company_id", companyId).eq("station_id", stationId).eq("sector_id", sectorId);
    if (removed.error) throw new Error(removed.error.message);
    if (values.length) {
      const shared = new Set(conflictRows.map(row => row.pincode));
      const inserted = await supabaseAdmin.from("ops_network_sector_pincodes").insert(values.map(pincode => ({ company_id: companyId, station_id: stationId, sector_id: sectorId, pincode, service_state: shared.has(pincode) ? "split" : "active", notes: outsideApproved.includes(pincode) ? "Manual station override" : null })));
      if (inserted.error) throw new Error(inserted.error.message);
    }
    revalidatePath("/ops-pulse/service-network");
    revalidatePath("/ops-pulse/master/service-network");
  } catch (error) { finish({ station: stationCode, error: error instanceof Error ? error.message : "Unable to save sector." }); }
  finish({ station: stationCode, notice: "Sector ownership and pincode plan saved." });
}

export async function archiveNetworkSector(formData: FormData) {
  const authorization = await requirePagePermission("service_network_master", "edit");
  const companyId = requireCompanyId(authorization);
  const stationCode = clean(formData.get("station_code")).toUpperCase();
  try {
    if (!supabaseAdmin) throw new Error("Database service is unavailable.");
    const stationId = clean(formData.get("station_id"));
    const sectorId = clean(formData.get("sector_id"));
    await permittedStation(companyId, stationId, stationCode, authorization.locationScopeIds, authorization.hasAllLocationAccess);
    const activeRoutes = await supabaseAdmin.from("ops_route_plans").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("station_id", stationId).eq("sector_id", sectorId).gte("plan_date", new Date().toISOString().slice(0, 10)).neq("status", "cancelled");
    if (activeRoutes.error) throw new Error(activeRoutes.error.message);
    if (activeRoutes.count) throw new Error("Cancel or move current/future routes before archiving this sector.");
    const result = await supabaseAdmin.from("ops_network_sectors").update({ is_active: false }).eq("company_id", companyId).eq("station_id", stationId).eq("id", sectorId);
    if (result.error) throw new Error(result.error.message);
    revalidatePath("/ops-pulse/service-network");
    revalidatePath("/ops-pulse/master/service-network");
  } catch (error) { finish({ station: stationCode, error: error instanceof Error ? error.message : "Unable to archive sector." }); }
  finish({ station: stationCode, notice: "Sector archived." });
}
