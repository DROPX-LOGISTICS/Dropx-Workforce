import type { CodLocationRow } from "@/lib/ops-pulse/cod";
import { loadApprovedCapacityAdHocUsage } from "@/lib/ops-pulse/capacity-ad-hoc";
import { loadCapacityRules } from "@/lib/ops-pulse/capacity";
import { buildCapacityPlanningDecision, type CapacityPlanningDecision } from "@/lib/ops-pulse/capacity-decision";
import { loadCapacityStationDays } from "@/lib/ops-pulse/capacity-shipments";

export type CapacityDataState = "ready" | "stale" | "missing";

export type CapacityStationSnapshot = {
  stationCode: string;
  stationName: string;
  region: string;
  cluster: string;
  latestDate: string | null;
  freshnessDays: number | null;
  dataState: CapacityDataState;
  averageSystemIds: number;
  latestSystemIds: number;
  averageWorkload: number;
  averageInbound: number;
  spr: number;
  targetSpr: number | null;
  maxSafeSpr: number | null;
  requiredIds: number | null;
  modelledGap: number | null;
  latestInternalDAs: number;
  latestExternalDAs: number;
  latestAdHocRequests: number;
  decision: CapacityPlanningDecision;
  action: string;
};

export type CapacityTrendPoint = {
  date: string;
  workload: number;
  systemIds: number;
  requiredIds: number;
  supportedWorkload: number;
  internalDAs: number;
  externalDAs: number;
  sourceStations: number;
};

export type CapacitySnapshot = {
  reportingDate: string;
  from: string;
  scopeDataDate: string | null;
  scopeCoverage: number;
  stations: CapacityStationSnapshot[];
  trend: CapacityTrendPoint[];
  summary: {
    stations: number;
    sourceReady: number;
    externalDAs: number;
    stale: number;
    actionRequired: number;
    hireCandidates: number;
    permanentGap: number;
    peakFlex: number;
    averageSpr: number;
  };
  errors: string[];
};

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateShift(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateDistance(from: string, to: string) {
  return Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000));
}

function locationName(location: CodLocationRow) {
  return location.station_name || location.city || location.station_code;
}

export async function loadCapacitySnapshot({
  companyId,
  locations,
  reportingDate,
  baselineDays = 14
}: {
  companyId: string;
  locations: CodLocationRow[];
  reportingDate: string;
  baselineDays?: number;
}): Promise<CapacitySnapshot> {
  const codes = locations.map((location) => location.station_code);
  const from = dateShift(reportingDate, -(Math.max(14, baselineDays) - 1));
  const [ruleResult, stationResult, adHocResult] = await Promise.all([
    loadCapacityRules(companyId),
    loadCapacityStationDays(companyId, codes, from, reportingDate),
    loadApprovedCapacityAdHocUsage(companyId, from, reportingDate)
  ]);
  const rules = new Map(ruleResult.rows.map((rule) => [rule.stationCode, rule]));
  const stationRows = stationResult.data ?? [];

  const stations = locations.map((location): CapacityStationSnapshot => {
    const stationCode = location.station_code;
    const rule = rules.get(stationCode);
    const rows = stationRows.filter((row) => row.station_code === stationCode).sort((a, b) => a.work_date.localeCompare(b.work_date));
    const decision = buildCapacityPlanningDecision({
      stationCode,
      rows,
      adHocUsage: adHocResult.rows,
      rule
    });
    const activeDays = decision.daily.filter((day) => day.workload > 0);
    const averageSystemIds = activeDays.length
      ? activeDays.reduce((sum, day) => sum + day.systemIds, 0) / activeDays.length
      : 0;
    const averageWorkload = decision.baseWorkload;
    const spr = averageSystemIds ? averageWorkload / averageSystemIds : 0;
    const latestDate = decision.latestDate;
    const freshnessDays = latestDate ? dateDistance(latestDate, reportingDate) : null;
    const dataState: CapacityDataState = freshnessDays == null ? "missing" : freshnessDays <= 1 ? "ready" : "stale";
    const latestDay = decision.daily.at(-1);
    const requiredIds = decision.permanentRequired;
    const modelledGap = decision.permanentGap;
    const action = dataState === "missing"
      ? "No completed workload is available. Resolve the source before taking a capacity decision."
      : dataState === "stale"
        ? `Source is ${freshnessDays} days behind. Refresh data before acting on the modelled position.`
        : decision.action;
    return {
      stationCode,
      stationName: locationName(location),
      region: location.region || "",
      cluster: location.cluster || "",
      latestDate,
      freshnessDays,
      dataState,
      averageSystemIds,
      latestSystemIds: decision.latestSystemIds,
      averageWorkload,
      averageInbound: activeDays.length ? activeDays.reduce((sum, day) => sum + day.inbound, 0) / activeDays.length : 0,
      spr,
      targetSpr: rule?.targetSpr ?? null,
      maxSafeSpr: rule?.maxSafeSpr ?? null,
      requiredIds,
      modelledGap,
      latestInternalDAs: latestDay?.internalDAs ?? 0,
      latestExternalDAs: latestDay?.externalDAs ?? 0,
      latestAdHocRequests: latestDay?.paymentRequests ?? 0,
      decision,
      action
    };
  });

  const coverageByDate = new Map<string, Set<string>>();
  stationRows.forEach((row) => {
    if (!coverageByDate.has(row.work_date)) coverageByDate.set(row.work_date, new Set());
    coverageByDate.get(row.work_date)!.add(row.station_code);
  });
  const coverageRows = [...coverageByDate.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  const minimumCoverage = Math.max(1, Math.ceil(codes.length * 0.8));
  const scopeDataDate = coverageRows.find(([, covered]) => covered.size >= minimumCoverage)?.[0]
    ?? [...coverageRows].sort((a, b) => b[1].size - a[1].size || b[0].localeCompare(a[0]))[0]?.[0]
    ?? null;
  const scopeCoverage = scopeDataDate && codes.length
    ? Math.round((coverageByDate.get(scopeDataDate)?.size ?? 0) / codes.length * 100)
    : 0;

  const trendDates = [...new Set(stations.flatMap((station) => station.decision.daily.map((day) => day.date)))].sort();
  const trend = trendDates.map((date): CapacityTrendPoint => {
    const days = stations.map((station) => station.decision.daily.find((day) => day.date === date)).filter(Boolean);
    return {
      date,
      workload: days.reduce((sum, day) => sum + num(day?.workload), 0),
      systemIds: days.reduce((sum, day) => sum + num(day?.systemIds), 0),
      requiredIds: days.reduce((sum, day) => sum + num(day?.required), 0),
      supportedWorkload: stations.reduce((sum, station) => {
        const day = station.decision.daily.find((entry) => entry.date === date);
        return sum + (day && station.targetSpr ? day.systemIds * station.targetSpr : 0);
      }, 0),
      internalDAs: days.reduce((sum, day) => sum + num(day?.internalDAs), 0),
      externalDAs: days.reduce((sum, day) => sum + num(day?.externalDAs), 0),
      sourceStations: days.length,
    };
  });

  const readyStations = stations.filter((station) => station.dataState === "ready");
  const totalWorkload = readyStations.reduce((sum, station) => sum + station.averageWorkload, 0);
  const totalIds = readyStations.reduce((sum, station) => sum + station.averageSystemIds, 0);
  const actionStatuses = new Set(["hire_candidate", "flex", "monitor", "temporary_surge"]);
  const hireCandidates = stations.filter((station) => station.decision.status === "hire_candidate");
  return {
    reportingDate,
    from,
    scopeDataDate,
    scopeCoverage,
    stations,
    trend,
    summary: {
      stations: stations.length,
      sourceReady: readyStations.length,
      externalDAs: stations.reduce((sum, station) => sum + station.latestExternalDAs, 0),
      stale: stations.filter((station) => station.dataState !== "ready").length,
      actionRequired: stations.filter((station) => actionStatuses.has(station.decision.status) || station.dataState !== "ready").length,
      hireCandidates: hireCandidates.length,
      permanentGap: hireCandidates.reduce((sum, station) => sum + Math.max(0, Math.ceil(station.decision.permanentGap ?? 0)), 0),
      peakFlex: stations.reduce((sum, station) => sum + station.decision.peakFlex, 0),
      averageSpr: totalIds ? totalWorkload / totalIds : 0
    },
    errors: [
      ruleResult.error,
      stationResult.error?.message,
      adHocResult.error
    ].filter((value): value is string => Boolean(value))
  };
}
