import { unstable_cache } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type CapacityStationDay = {
  station_code: string;
  work_date: string;
  active_ids: number | string;
  low_volume_ids: number | string;
  delivered: number | string;
  shipment_count: number | string;
  inbound: number | string;
  detail_active_ids: number | string;
  daily_count_active_ids: number | string;
  volume_source: string;
};

export type CapacityAssociateDay = {
  station_code: string;
  work_date: string;
  associate_id: string;
  associate_name: string | null;
  delivered: number | string;
  volumetric: number | string;
  small: number | string;
  unclassified: number | string;
};

export type CapacityPincode = {
  postal_code: string;
  delivered: number | string;
  active_ids: number | string;
  active_days: number | string;
  weight_ready: number | string;
  dimension_ready: number | string;
  volumetric: number | string;
  small: number | string;
  unclassified: number | string;
  average_weight_kg: number | string | null;
  average_cubic_cm3: number | string | null;
};

export type ShipmentCountAssociateDay = {
  client: string;
  station_code: string;
  work_date: string;
  provider_employee_id: string;
  provider_employee_name: string | null;
  total_delivery: number | string | null;
};

const ASSOCIATE_PAGE_SIZE = 1000;

function associateKey(stationCode: string, workDate: string, associateId: string) {
  return `${stationCode.trim().toUpperCase()}|${workDate}|${associateId.trim().toUpperCase()}`;
}

function normalizedAssociateName(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase();
}

async function loadDetailedAssociateDays(companyId: string, stationCodes: string[], from: string, to: string) {
  if (!supabaseAdmin || !stationCodes.length) {
    return { data: [] as CapacityAssociateDay[], error: null };
  }

  const stationChunks: string[][] = [];
  for (let index = 0; index < stationCodes.length; index += 6) {
    stationChunks.push(stationCodes.slice(index, index + 6));
  }

  const chunks = await Promise.all(stationChunks.map(async (codes) => {
    const rows: CapacityAssociateDay[] = [];
    let fromRow = 0;
    for (;;) {
      const result = await supabaseAdmin!
        .rpc("capacity_associate_daily", {
          p_company_id: companyId,
          p_station_codes: codes,
          p_from: from,
          p_to: to
        })
        .order("work_date", { ascending: true })
        .order("station_code", { ascending: true })
        .order("associate_id", { ascending: true })
        .range(fromRow, fromRow + ASSOCIATE_PAGE_SIZE - 1);

      if (result.error) return { data: rows, error: result.error };
      const page = (result.data ?? []) as CapacityAssociateDay[];
      if (!page.length) break;
      rows.push(...page);
      fromRow += page.length;
    }
    return { data: rows, error: null };
  }));

  return {
    data: chunks.flatMap((chunk) => chunk.data),
    error: chunks.find((chunk) => chunk.error)?.error ?? null
  };
}

export async function loadShipmentCountAssociateDays(companyId: string, stationCodes: string[], from: string, to: string) {
  if (!supabaseAdmin || !stationCodes.length) {
    return { data: [] as ShipmentCountAssociateDay[], error: null };
  }

  const stationChunks: string[][] = [];
  for (let index = 0; index < stationCodes.length; index += 6) {
    stationChunks.push(stationCodes.slice(index, index + 6));
  }

  const chunks = await Promise.all(stationChunks.map(async (codes) => {
    const rows: ShipmentCountAssociateDay[] = [];
    let fromRow = 0;
    for (;;) {
      const result = await supabaseAdmin!
        .from("cps_shipment_daily")
        .select("client,station_code,work_date,provider_employee_id,provider_employee_name,total_delivery")
        .eq("company_id", companyId)
        .in("station_code", codes)
        .gte("work_date", from)
        .lte("work_date", to)
        .not("provider_employee_id", "is", null)
        .order("work_date", { ascending: true })
        .order("station_code", { ascending: true })
        .order("provider_employee_id", { ascending: true })
        .order("client", { ascending: true })
        .range(fromRow, fromRow + ASSOCIATE_PAGE_SIZE - 1);

      if (result.error) return { data: rows, error: result.error };
      const page = (result.data ?? []) as ShipmentCountAssociateDay[];
      if (!page.length) break;
      rows.push(...page);
      // Supabase may enforce a lower server-side maximum than the requested
      // range. Advancing by the actual page size prevents silently skipping
      // later dates when that happens.
      fromRow += page.length;
    }
    return { data: rows, error: null };
  }));

  return {
    data: chunks.flatMap((chunk) => chunk.data),
    error: chunks.find((chunk) => chunk.error)?.error ?? null
  };
}

export function mergeCapacityAssociateDays(
  detailedRows: CapacityAssociateDay[],
  shipmentCountRows: ShipmentCountAssociateDay[]
) {
  const merged = [...detailedRows];
  const detailedKeys = new Set(detailedRows.map((row) => associateKey(row.station_code, row.work_date, row.associate_id)));
  const detailedNameKeys = new Set(detailedRows.flatMap((row) => {
    const name = normalizedAssociateName(row.associate_name);
    return name ? [`${row.station_code.trim().toUpperCase()}|${row.work_date}|${name}`] : [];
  }));
  const fallbackByKey = new Map<string, CapacityAssociateDay>();

  shipmentCountRows.forEach((row) => {
    const associateId = String(row.provider_employee_id ?? "").trim();
    if (!associateId) return;
    const key = associateKey(row.station_code, row.work_date, associateId);
    if (detailedKeys.has(key)) return;
    const name = String(row.provider_employee_name ?? "").trim() || null;
    const normalizedName = normalizedAssociateName(name);
    if (normalizedName && detailedNameKeys.has(`${row.station_code.trim().toUpperCase()}|${row.work_date}|${normalizedName}`)) return;

    const delivered = Number(row.total_delivery ?? 0);
    const current = fallbackByKey.get(key);
    if (current) {
      current.delivered = Number(current.delivered) + (Number.isFinite(delivered) ? delivered : 0);
      current.unclassified = current.delivered;
      if (!current.associate_name && name) current.associate_name = name;
      return;
    }
    fallbackByKey.set(key, {
      station_code: row.station_code,
      work_date: row.work_date,
      associate_id: associateId,
      associate_name: name,
      delivered: Number.isFinite(delivered) ? delivered : 0,
      volumetric: 0,
      small: 0,
      unclassified: Number.isFinite(delivered) ? delivered : 0
    });
  });

  merged.push(...fallbackByKey.values());
  return merged.sort((left, right) =>
    left.work_date.localeCompare(right.work_date)
    || left.station_code.localeCompare(right.station_code)
    || left.associate_id.localeCompare(right.associate_id)
  );
}

const cachedCapacityStationDays = unstable_cache(async (companyId: string, stationCodes: string[], from: string, to: string) => {
  if (!supabaseAdmin || !stationCodes.length) return { data: [] as CapacityStationDay[], error: null };
  const chunks: string[][] = [];
  for (let index = 0; index < stationCodes.length; index += 6) chunks.push(stationCodes.slice(index, index + 6));
  const results = await Promise.all(chunks.map((codes) => supabaseAdmin!.rpc("capacity_station_daily", {
    p_company_id: companyId, p_station_codes: codes, p_from: from, p_to: to
  })));
  return {
    data: results.flatMap((result) => (result.data ?? []) as CapacityStationDay[]),
    error: results.find((result) => result.error)?.error ?? null
  };
}, ["capacity-station-days"], { revalidate: 60 });

export async function loadCapacityStationDays(companyId: string, stationCodes: string[], from: string, to: string) {
  return cachedCapacityStationDays(companyId, [...stationCodes].sort(), from, to);
}

const cachedCapacityAssociateDays = unstable_cache(async (companyId: string, stationCodes: string[], from: string, to: string) => {
  if (!supabaseAdmin || !stationCodes.length) return { data: [] as CapacityAssociateDay[], error: null };
  const [detailResult, countResult] = await Promise.all([
    loadDetailedAssociateDays(companyId, stationCodes, from, to),
    loadShipmentCountAssociateDays(companyId, stationCodes, from, to)
  ]);
  return {
    data: mergeCapacityAssociateDays(
      detailResult.data,
      countResult.data
    ),
    error: detailResult.error ?? countResult.error
  };
}, ["capacity-associate-days-v4"], { revalidate: 120 });

export async function loadCapacityAssociateDays(companyId: string, stationCodes: string[], from: string, to: string) {
  return cachedCapacityAssociateDays(companyId, [...stationCodes].sort(), from, to);
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
