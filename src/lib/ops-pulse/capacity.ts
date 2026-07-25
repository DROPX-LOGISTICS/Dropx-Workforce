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

function sourceCode(stationCode: string) {
  return `capacity_station_${stationCode.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
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
