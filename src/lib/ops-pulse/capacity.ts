import { supabaseAdmin } from "@/lib/supabase-admin";

export type CapacityRule = {
  id?: string;
  stationCode: string;
  targetSpr: number;
  maxSafeSpr: number;
  bufferPercent: number;
  recentDays: number;
  isActive: boolean;
};

export type CapacityRegionMap = {
  id?: string;
  name: string;
  matchField: "station" | "region" | "state";
  matchValue: string;
  mapUrl: string;
  isActive: boolean;
};

export type ShipmentSizeRule = {
  id?: string;
  maxLengthCm: number;
  maxWidthCm: number;
  maxHeightCm: number;
  maxWeightKg: number;
  dimensionalDivisor: number;
  maxDimensionalWeightKg: number;
  minActiveShipments: number;
};

export type CapacityServiceRoute = {
  id?: string;
  stationCode: string;
  routeName: string;
  vehicleType: "bike" | "van";
  pincode: string;
  daId: string;
  daName: string;
  color: string;
  coordinates: Array<{ lat: number; lng: number }>;
  isActive: boolean;
};

function sourceCode(stationCode: string) {
  return `capacity_station_${stationCode.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

function mapSourceCode(matchField: string, matchValue: string) {
  return `capacity_map_${matchField}_${matchValue.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

function routeSourceCode(route: CapacityServiceRoute) {
  const token = `${route.stationCode}_${route.routeName}_${route.daId}`.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return `capacity_service_route_${token}`.slice(0, 180);
}

function parse(row: { id: string; description: string | null }) {
  try {
    return { ...(JSON.parse(row.description ?? "{}") as CapacityRule), id: row.id };
  } catch {
    return null;
  }
}

export async function loadCapacityRules(companyId: string) {
  if (!supabaseAdmin) return { rows: [] as CapacityRule[], error: "Database service is unavailable." };
  const result = await supabaseAdmin.from("report_import_master")
    .select("id,description")
    .eq("company_id", companyId)
    .eq("parser_type", "capacity_master")
    .order("source_code");
  return { rows: (result.data ?? []).map(parse).filter(Boolean) as CapacityRule[], error: result.error?.message ?? null };
}

export async function saveCapacityRule(companyId: string, rule: CapacityRule) {
  if (!supabaseAdmin) return "Database service is unavailable.";
  const record = {
    company_id: companyId,
    source_code: sourceCode(rule.stationCode),
    name: `${rule.stationCode} Capacity`,
    description: JSON.stringify(rule),
    file_types: [],
    day_offset: 0,
    frequency: "daily",
    parser_type: "capacity_master",
    dedupe_fields: ["station_code"],
    is_active: rule.isActive,
    updated_at: new Date().toISOString()
  };
  const result = await supabaseAdmin.from("report_import_master").upsert(record, { onConflict: "company_id,source_code" });
  return result.error?.message ?? null;
}

export async function deleteCapacityRule(companyId: string, id: string) {
  if (!supabaseAdmin) return "Database service is unavailable.";
  const result = await supabaseAdmin.from("report_import_master").delete()
    .eq("company_id", companyId).eq("id", id).eq("parser_type", "capacity_master");
  return result.error?.message ?? null;
}

function parseMap(row: { id: string; description: string | null }) {
  try {
    return { ...(JSON.parse(row.description ?? "{}") as CapacityRegionMap), id: row.id };
  } catch {
    return null;
  }
}

export async function loadCapacityRegionMaps(companyId: string) {
  if (!supabaseAdmin) return { rows: [] as CapacityRegionMap[], error: "Database service is unavailable." };
  const result = await supabaseAdmin.from("report_import_master")
    .select("id,description")
    .eq("company_id", companyId)
    .eq("parser_type", "capacity_region_map")
    .eq("is_active", true)
    .order("name");
  return { rows: (result.data ?? []).map(parseMap).filter(Boolean) as CapacityRegionMap[], error: result.error?.message ?? null };
}

export async function saveCapacityRegionMap(companyId: string, map: CapacityRegionMap) {
  if (!supabaseAdmin) return "Database service is unavailable.";
  const record = {
    company_id: companyId,
    source_code: mapSourceCode(map.matchField, map.matchValue),
    name: map.name,
    description: JSON.stringify(map),
    file_types: [],
    day_offset: 0,
    frequency: "daily",
    parser_type: "capacity_region_map",
    dedupe_fields: ["match_field", "match_value"],
    is_active: map.isActive,
    updated_at: new Date().toISOString()
  };
  const result = await supabaseAdmin.from("report_import_master").upsert(record, { onConflict: "company_id,source_code" });
  return result.error?.message ?? null;
}

export async function deleteCapacityRegionMap(companyId: string, id: string) {
  if (!supabaseAdmin) return "Database service is unavailable.";
  const result = await supabaseAdmin.from("report_import_master").delete()
    .eq("company_id", companyId).eq("id", id).eq("parser_type", "capacity_region_map");
  return result.error?.message ?? null;
}

export async function loadShipmentSizeRule(companyId: string) {
  if (!supabaseAdmin) return { rule: null as ShipmentSizeRule | null, error: "Database service is unavailable." };
  const result = await supabaseAdmin.from("report_import_master").select("id,description")
    .eq("company_id", companyId).eq("source_code", "capacity_shipment_size_rule").maybeSingle();
  try {
    return { rule: result.data ? { ...(JSON.parse(result.data.description ?? "{}") as ShipmentSizeRule), id: result.data.id } : null, error: result.error?.message ?? null };
  } catch {
    return { rule: null, error: "Shipment-size rule is invalid." };
  }
}

export async function saveShipmentSizeRule(companyId: string, rule: ShipmentSizeRule) {
  if (!supabaseAdmin) return "Database service is unavailable.";
  const result = await supabaseAdmin.from("report_import_master").upsert({
    company_id: companyId,
    source_code: "capacity_shipment_size_rule",
    name: "Capacity shipment size rule",
    description: JSON.stringify(rule),
    file_types: [],
    day_offset: 0,
    frequency: "daily",
    parser_type: "capacity_shipment_classification",
    dedupe_fields: ["company_id"],
    is_active: true,
    updated_at: new Date().toISOString()
  }, { onConflict: "company_id,source_code" });
  return result.error?.message ?? null;
}

export async function loadCapacityServiceRoutes(companyId: string, stationCode?: string) {
  if (!supabaseAdmin) return { rows: [] as CapacityServiceRoute[], error: "Database service is unavailable." };
  let query = supabaseAdmin.from("report_import_master").select("id,description")
    .eq("company_id", companyId).eq("parser_type", "capacity_service_route").eq("is_active", true).order("name");
  if (stationCode) query = query.like("source_code", `capacity_service_route_${stationCode.toLowerCase()}_%`);
  const result = await query;
  const rows = (result.data ?? []).map((row) => {
    try { return { ...(JSON.parse(row.description ?? "{}") as CapacityServiceRoute), id: row.id }; }
    catch { return null; }
  }).filter(Boolean) as CapacityServiceRoute[];
  return { rows, error: result.error?.message ?? null };
}

export async function saveCapacityServiceRoute(companyId: string, route: CapacityServiceRoute) {
  if (!supabaseAdmin) return "Database service is unavailable.";
  const result = await supabaseAdmin.from("report_import_master").upsert({
    company_id: companyId,
    source_code: routeSourceCode(route),
    name: `${route.stationCode} · ${route.routeName} · ${route.daName || route.daId}`,
    description: JSON.stringify(route),
    file_types: [],
    day_offset: 0,
    frequency: "daily",
    parser_type: "capacity_service_route",
    dedupe_fields: ["station_code", "route_name", "da_id"],
    is_active: true,
    updated_at: new Date().toISOString()
  }, { onConflict: "company_id,source_code" });
  return result.error?.message ?? null;
}

export async function deleteCapacityServiceRoute(companyId: string, id: string) {
  if (!supabaseAdmin) return "Database service is unavailable.";
  const result = await supabaseAdmin.from("report_import_master").delete()
    .eq("company_id", companyId).eq("id", id).eq("parser_type", "capacity_service_route");
  return result.error?.message ?? null;
}

export function capacityMapEmbedUrl(mapUrl: string) {
  try {
    const parsed = new URL(mapUrl);
    const mapId = parsed.searchParams.get("mid");
    if (!mapId) return null;
    return `https://www.google.com/maps/d/embed?mid=${encodeURIComponent(mapId)}`;
  } catch {
    return null;
  }
}
