import { supabaseAdmin } from "@/lib/supabase-admin";

export type CapacityStationDay = {
  station_code: string;
  work_date: string;
  active_ids: number | string;
  delivered: number | string;
  shipment_count: number | string;
};

export type CapacityAssociateDay = {
  station_code: string;
  work_date: string;
  associate_id: string;
  associate_name: string | null;
  delivered: number | string;
};

export type CapacityPincode = {
  postal_code: string;
  delivered: number | string;
  active_ids: number | string;
  active_days: number | string;
  weight_ready: number | string;
  dimension_ready: number | string;
  average_weight_kg: number | string | null;
  average_cubic_cm3: number | string | null;
};

export async function loadCapacityStationDays(companyId: string, stationCodes: string[], from: string, to: string) {
  if (!supabaseAdmin || !stationCodes.length) return { data: [] as CapacityStationDay[], error: null };
  const result = await supabaseAdmin.rpc("capacity_station_daily", {
    p_company_id: companyId,
    p_station_codes: stationCodes,
    p_from: from,
    p_to: to
  });
  return { data: (result.data ?? []) as CapacityStationDay[], error: result.error };
}

export async function loadCapacityAssociateDays(companyId: string, stationCodes: string[], from: string, to: string) {
  if (!supabaseAdmin || !stationCodes.length) return { data: [] as CapacityAssociateDay[], error: null };
  const result = await supabaseAdmin.rpc("capacity_associate_daily", {
    p_company_id: companyId,
    p_station_codes: stationCodes,
    p_from: from,
    p_to: to
  });
  return { data: (result.data ?? []) as CapacityAssociateDay[], error: result.error };
}

export async function loadCapacityPincodes(companyId: string, stationCode: string, from: string, to: string) {
  if (!supabaseAdmin || !stationCode) return { data: [] as CapacityPincode[], error: null };
  const result = await supabaseAdmin.rpc("capacity_pincode_summary", {
    p_company_id: companyId,
    p_station_code: stationCode,
    p_from: from,
    p_to: to
  });
  return { data: (result.data ?? []) as CapacityPincode[], error: result.error };
}
