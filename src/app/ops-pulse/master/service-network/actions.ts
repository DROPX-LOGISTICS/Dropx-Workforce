"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { deleteServiceNetworkRule, saveServiceNetworkRule } from "@/lib/ops-pulse/service-network";

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
