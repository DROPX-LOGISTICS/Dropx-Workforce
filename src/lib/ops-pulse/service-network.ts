import { supabaseAdmin } from "@/lib/supabase-admin";

export type ServiceNetworkRule = {
  id?: string;
  stationCode: string;
  serviceRadiusKm: number;
  bikeSpr: number;
  vanSpr: number;
  bufferPercent: number;
  pincodeOwnership: string[];
  pincodeCoordinates?: Record<string, { lat: number; lng: number }>;
  jurisdictionOwner: string;
  effectiveFrom: string;
  effectiveTo: string;
  isActive: boolean;
};

function sourceCode(stationCode: string) {
  return `service_network_${stationCode.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

function parse(row: { id: string; description: string | null }) {
  try { return { ...(JSON.parse(row.description ?? "{}") as ServiceNetworkRule), id: row.id }; }
  catch { return null; }
}

export async function loadServiceNetworkRules(companyId: string) {
  if (!supabaseAdmin) return { rows: [] as ServiceNetworkRule[], error: "Database service is unavailable." };
  const result = await supabaseAdmin.from("report_import_master").select("id,description")
    .eq("company_id", companyId).eq("parser_type", "service_network_master").order("source_code");
  return { rows: (result.data ?? []).map(parse).filter(Boolean) as ServiceNetworkRule[], error: result.error?.message ?? null };
}

export async function saveServiceNetworkRule(companyId: string, rule: ServiceNetworkRule) {
  if (!supabaseAdmin) return "Database service is unavailable.";
  const result = await supabaseAdmin.from("report_import_master").upsert({
    company_id: companyId,
    source_code: sourceCode(rule.stationCode),
    name: `${rule.stationCode} Service Network`,
    description: JSON.stringify(rule),
    file_types: [],
    day_offset: 0,
    frequency: "daily",
    parser_type: "service_network_master",
    dedupe_fields: ["station_code"],
    is_active: rule.isActive,
    updated_at: new Date().toISOString()
  }, { onConflict: "company_id,source_code" });
  return result.error?.message ?? null;
}

export async function deleteServiceNetworkRule(companyId: string, id: string) {
  if (!supabaseAdmin) return "Database service is unavailable.";
  const result = await supabaseAdmin.from("report_import_master").delete()
    .eq("company_id", companyId).eq("id", id).eq("parser_type", "service_network_master");
  return result.error?.message ?? null;
}

export function capacityForMix(input: {
  small: number;
  volumetric: number;
  rule?: ServiceNetworkRule;
}) {
  if (!input.rule?.bikeSpr || !input.rule?.vanSpr) return { bike: null, van: null, total: null };
  const multiplier = 1 + Math.max(0, input.rule.bufferPercent) / 100;
  const bike = Math.ceil(input.small / input.rule.bikeSpr * multiplier);
  const van = Math.ceil(input.volumetric / input.rule.vanSpr * multiplier);
  return { bike, van, total: bike + van };
}
