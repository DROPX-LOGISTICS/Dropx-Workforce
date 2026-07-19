export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { getAuthorization, hasPermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

type ExportLevel = "da" | "shipment_type" | "station";

type ShipmentFact = {
  client: string | null;
  provider_employee_id: string | null;
  provider_employee_name: string | null;
  shipment_type: string | null;
  station_code: string | null;
  total_activity: number | null;
  total_delivery: number | null;
  updated_at: string | null;
  work_date: string | null;
};

type StationRow = {
  city: string | null;
  state: string | null;
  station_code: string | null;
  station_name: string | null;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function csvCell(value: unknown) {
  const text = clean(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(headers: string[], rows: Array<Record<string, unknown>>) {
  const lines = [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))
  ];
  return lines.join("\n");
}

function downloadCsv(fileName: string, csv: string) {
  return new Response(csv, {
    headers: {
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Type": "text/csv; charset=utf-8"
    }
  });
}

function parseLevel(value: string | null): ExportLevel {
  if (value === "da" || value === "shipment_type" || value === "station") return value;
  return "station";
}

function numberValue(value: number | null) {
  return Number(value ?? 0);
}

async function loadStations(companyId: string, stationCodes: string[]) {
  if (!supabaseAdmin || !stationCodes.length) return new Map<string, StationRow>();
  const { data } = await supabaseAdmin
    .from("stations")
    .select("station_code, station_name, city, state")
    .eq("company_id", companyId)
    .in("station_code", stationCodes);

  return new Map((data ?? []).map((station) => [clean(station.station_code).toUpperCase(), station as StationRow]));
}

function stationLookup(stations: Map<string, StationRow>, stationCode: string | null) {
  return stations.get(clean(stationCode).toUpperCase()) ?? null;
}

export async function GET(request: NextRequest) {
  if (!supabaseAdmin) return Response.json({ error: "Supabase service key is not configured." }, { status: 500 });

  const authorization = await getAuthorization();
  if (!authorization) return Response.json({ error: "Login required." }, { status: 401 });
  if (!hasPermission(authorization, "imports", "access") && !hasPermission(authorization, "report_imports", "view")) {
    return Response.json({ error: "Permission denied." }, { status: 403 });
  }

  const companyId = requireCompanyId(authorization);
  const level = parseLevel(request.nextUrl.searchParams.get("level"));
  const { data, error } = await supabaseAdmin
    .from("cps_shipment_daily")
    .select("client, station_code, provider_employee_id, provider_employee_name, shipment_type, work_date, total_delivery, total_activity, updated_at")
    .eq("company_id", companyId)
    .order("work_date", { ascending: false })
    .limit(50000);

  if (error) return Response.json({ error: error.message }, { status: 400 });

  const facts = (data ?? []) as ShipmentFact[];
  const stationCodes = Array.from(new Set(facts.map((row) => clean(row.station_code).toUpperCase()).filter(Boolean)));
  const stationMap = await loadStations(companyId, stationCodes);

  if (level === "da") {
    const headers = ["work_date", "station_code", "station_name", "state", "cluster", "client", "provider_employee_id", "provider_employee_name", "shipment_type", "total_delivery", "total_activity", "last_updated_at"];
    const rows = facts.map((row) => {
      const station = stationLookup(stationMap, row.station_code);
      return {
        client: row.client ?? "Amazon",
        cluster: "",
        provider_employee_id: row.provider_employee_id ?? "",
        provider_employee_name: row.provider_employee_name ?? "",
        shipment_type: row.shipment_type ?? "",
        state: station?.state ?? "",
        station_code: row.station_code ?? "",
        station_name: station?.station_name ?? "",
        total_activity: numberValue(row.total_activity),
        total_delivery: numberValue(row.total_delivery),
        last_updated_at: row.updated_at ?? "",
        work_date: row.work_date ?? ""
      };
    });
    return downloadCsv("amazon-shipment-source-da.csv", toCsv(headers, rows));
  }

  if (level === "shipment_type") {
    const map = new Map<string, { activity: number; delivery: number; rows: number }>();
    facts.forEach((row) => {
      const key = row.shipment_type || "Unspecified";
      const current = map.get(key) ?? { activity: 0, delivery: 0, rows: 0 };
      current.activity += numberValue(row.total_activity);
      current.delivery += numberValue(row.total_delivery);
      current.rows += 1;
      map.set(key, current);
    });
    const headers = ["shipment_type", "rows", "total_delivery", "total_activity"];
    const rows = Array.from(map.entries())
      .map(([shipmentType, values]) => ({
        shipment_type: shipmentType,
        rows: values.rows,
        total_activity: values.activity,
        total_delivery: values.delivery
      }))
      .sort((a, b) => Number(b.total_activity) - Number(a.total_activity));
    return downloadCsv("amazon-shipment-source-types.csv", toCsv(headers, rows));
  }

  const map = new Map<string, {
    activity: number;
    daIds: Set<string>;
    dates: Set<string>;
    delivery: number;
    stationCode: string;
    updatedAt: string | null;
  }>();
  facts.forEach((row) => {
    const stationCode = clean(row.station_code).toUpperCase() || "-";
    const current = map.get(stationCode) ?? {
      activity: 0,
      daIds: new Set<string>(),
      dates: new Set<string>(),
      delivery: 0,
      stationCode,
      updatedAt: null
    };
    current.activity += numberValue(row.total_activity);
    current.delivery += numberValue(row.total_delivery);
    if (row.provider_employee_id) current.daIds.add(row.provider_employee_id);
    if (row.work_date) current.dates.add(row.work_date);
    if (row.updated_at && (!current.updatedAt || row.updated_at > current.updatedAt)) current.updatedAt = row.updated_at;
    map.set(stationCode, current);
  });

  const headers = ["station_code", "station_name", "state", "cluster", "from_date", "to_date", "days", "da_count", "total_delivery", "total_activity", "last_updated_at"];
  const rows = Array.from(map.values())
    .map((stationRow) => {
      const dates = Array.from(stationRow.dates).sort();
      const station = stationLookup(stationMap, stationRow.stationCode);
      return {
        cluster: "",
        da_count: stationRow.daIds.size,
        days: dates.length,
        from_date: dates[0] ?? "",
        last_updated_at: stationRow.updatedAt ?? "",
        state: station?.state ?? "",
        station_code: stationRow.stationCode,
        station_name: station?.station_name ?? "",
        to_date: dates.at(-1) ?? "",
        total_activity: stationRow.activity,
        total_delivery: stationRow.delivery
      };
    })
    .sort((a, b) => String(a.station_code).localeCompare(String(b.station_code)));

  return downloadCsv("amazon-shipment-source-stations.csv", toCsv(headers, rows));
}
