import { supabaseAdmin } from "@/lib/supabase-admin";

export type CapacityGroundUpdate = {
  id?: string;
  stationCode: string;
  workDate: string;
  assignedPackages: number | null;
  regularBike: number | null;
  regularVan: number | null;
  regularVanVehicle: number | null;
  adHocBike: number | null;
  adHocVanVehicle: number | null;
  adHocVan: number | null;
  classifiedIds: number | null;
  systemIdsAtSave: number | null;
  inboundAtSave: number;
  updatedAt: string;
  updatedBy: string;
};

type GroundRow = { id: string; description: string | null };

export async function loadCapacityGroundUpdates(companyId: string, from: string, to: string) {
  if (!supabaseAdmin) return { rows: [] as CapacityGroundUpdate[], error: "Database service is unavailable." };
  const result = await supabaseAdmin.from("report_import_master")
    .select("id,description")
    .eq("company_id", companyId)
    .eq("parser_type", "capacity_daily_ground")
    .gte("source_code", `capacity_ground_`)
    .order("source_code");
  const rows = ((result.data ?? []) as GroundRow[]).map((row) => {
    try { return { ...(JSON.parse(row.description ?? "{}") as CapacityGroundUpdate), id: row.id }; }
    catch { return null; }
  }).filter((row): row is CapacityGroundUpdate & { id: string } => Boolean(row && row.workDate >= from && row.workDate <= to));
  return { rows, error: result.error?.message ?? null };
}
