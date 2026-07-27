import type { CapacityRule } from "@/lib/ops-pulse/capacity";
import { capacityPlanningSettings } from "@/lib/ops-pulse/capacity";
import type { CapacityGroundUpdate } from "@/lib/ops-pulse/capacity-ground";
import type { CapacityStationDay } from "@/lib/ops-pulse/capacity-shipments";

export type CapacityPlanningAlert = {
  id: string;
  stationCode: string;
  date: string;
  type: "associate_drop" | "volume_spike" | "ground_missing";
  severity: "critical" | "warning";
  title: string;
  detail: string;
  changePercent: number | null;
};

export type CapacityDecisionStatus =
  | "hire_candidate"
  | "flex"
  | "monitor"
  | "temporary_surge"
  | "ground_required"
  | "balanced"
  | "surplus"
  | "unconfigured"
  | "no_data";

export type CapacityPlanningDay = {
  date: string;
  systemIds: number;
  workload: number;
  inbound: number;
  regular: number | null;
  adHoc: number | null;
  classified: number | null;
  matched: boolean;
  required: number | null;
  spr: number;
  source: string;
  alerts: CapacityPlanningAlert[];
};

export type CapacityPlanningDecision = {
  stationCode: string;
  baselineDays: number;
  sourceDays: number;
  matchedDays: number;
  minimumMatchedDays: number;
  latestDate: string | null;
  latestSystemIds: number;
  baseWorkload: number;
  peakWorkload: number;
  regularCapacity: number;
  regularCapacitySource: "ground" | "system" | "none";
  permanentRequired: number | null;
  permanentGap: number | null;
  peakRequired: number | null;
  peakFlex: number;
  shortageDays: number;
  sustainedShortage: boolean;
  confidence: "high" | "medium" | "low";
  status: CapacityDecisionStatus;
  label: string;
  action: string;
  daily: CapacityPlanningDay[];
  alerts: CapacityPlanningAlert[];
};

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values: number[], point: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(point * sorted.length) - 1));
  return sorted[index];
}

function trimmedAverage(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const trimmed = sorted.length >= 7 ? sorted.slice(1, -1) : sorted;
  return trimmed.reduce((sum, value) => sum + value, 0) / trimmed.length;
}

function regularCount(update: CapacityGroundUpdate | undefined) {
  return update ? num(update.regularBike) + num(update.regularVan) : 0;
}

function adHocCount(update: CapacityGroundUpdate | undefined) {
  return update ? num(update.adHocBike) + num(update.adHocVan) : 0;
}

function requiredFor(workload: number, rule: CapacityRule | undefined) {
  if (!rule || !workload || !rule.targetSpr) return null;
  return Math.ceil(workload / rule.targetSpr * (1 + rule.bufferPercent / 100));
}

function blockGap(days: CapacityPlanningDay[], rule: CapacityRule | undefined) {
  const matched = days.filter((day) => day.matched && day.regular != null);
  if (!rule || matched.length < 3) return null;
  const required = requiredFor(trimmedAverage(days.map((day) => day.workload).filter((value) => value > 0)), rule);
  return required == null ? null : required - median(matched.map((day) => day.regular ?? 0));
}

export function buildCapacityPlanningDecision({
  stationCode,
  rows,
  groundUpdates,
  rule
}: {
  stationCode: string;
  rows: CapacityStationDay[];
  groundUpdates: CapacityGroundUpdate[];
  rule: CapacityRule | undefined;
}): CapacityPlanningDecision {
  const settings = capacityPlanningSettings(rule);
  const groundByDate = new Map<string, CapacityGroundUpdate>();
  groundUpdates.filter((row) => row.stationCode === stationCode).forEach((row) => {
    const current = groundByDate.get(row.workDate);
    if (!current || row.updatedAt > current.updatedAt) groundByDate.set(row.workDate, row);
  });
  const rowByDate = new Map<string, CapacityStationDay>();
  rows.filter((row) => row.station_code === stationCode).forEach((row) => rowByDate.set(row.work_date, row));
  const dates = [...rowByDate.keys()].sort().slice(-settings.baselineDays);
  const daily: CapacityPlanningDay[] = dates.map((date) => {
    const row = rowByDate.get(date)!;
    const ground = groundByDate.get(date);
    // A saved zero is an explicit ground confirmation (for example, no operation);
    // absence of a saved row is the only "not updated" state.
    const classified = ground ? num(ground.classifiedIds) : null;
    const regular = classified != null ? regularCount(ground) : null;
    const adHoc = classified != null ? adHocCount(ground) : null;
    const workload = num(row.delivered);
    return {
      date,
      systemIds: num(row.active_ids),
      workload,
      inbound: num(row.inbound),
      regular,
      adHoc,
      classified,
      matched: classified != null,
      required: requiredFor(workload, rule),
      spr: num(row.active_ids) ? workload / num(row.active_ids) : 0,
      source: row.volume_source || "No source",
      alerts: []
    };
  });

  const recentAlertStart = daily.at(-7)?.date ?? daily[0]?.date ?? "";
  daily.forEach((day, index) => {
    if (index < 2 || day.date < recentAlertStart) return;
    const prior = daily.slice(Math.max(0, index - 7), index);
    const priorHeadcount = median(prior.map((item) => item.classified ?? item.systemIds).filter((value) => value > 0));
    const currentHeadcount = day.classified ?? day.systemIds;
    if (priorHeadcount > 0 && currentHeadcount < priorHeadcount) {
      const drop = (priorHeadcount - currentHeadcount) / priorHeadcount * 100;
      if (drop >= settings.associateDropPercent) {
        day.alerts.push({
          id: `${stationCode}-${day.date}-associate-drop`,
          stationCode,
          date: day.date,
          type: "associate_drop",
          severity: drop >= settings.associateDropPercent * 1.5 ? "critical" : "warning",
          title: `Associate strength dropped ${Math.round(drop)}%`,
          detail: `${Math.round(priorHeadcount)} baseline to ${Math.round(currentHeadcount)} on ${day.date}.`,
          changePercent: -drop
        });
      }
    }
    const priorWorkload = median(prior.map((item) => item.workload).filter((value) => value > 0));
    if (priorWorkload > 0 && day.workload > priorWorkload) {
      const spike = (day.workload - priorWorkload) / priorWorkload * 100;
      if (spike >= settings.volumeSpikePercent) {
        day.alerts.push({
          id: `${stationCode}-${day.date}-volume-spike`,
          stationCode,
          date: day.date,
          type: "volume_spike",
          severity: spike >= settings.volumeSpikePercent * 1.5 ? "critical" : "warning",
          title: `Workload spiked ${Math.round(spike)}%`,
          detail: `${Math.round(priorWorkload)} baseline to ${Math.round(day.workload)} on ${day.date}.`,
          changePercent: spike
        });
      }
    }
  });

  const latest = daily.at(-1);
  if (latest && !latest.matched) {
    latest.alerts.push({
      id: `${stationCode}-${latest.date}-ground-missing`,
      stationCode,
      date: latest.date,
      type: "ground_missing",
      severity: "warning",
      title: "Ground update not matched",
      detail: `Final workload exists for ${latest.date}, but on-ground staffing is missing.`,
      changePercent: null
    });
  }

  const sourceDays = daily.length;
  const matched = daily.filter((day) => day.matched && day.regular != null);
  const matchedDays = matched.length;
  const workloads = daily.map((day) => day.workload).filter((value) => value > 0);
  const baseWorkload = trimmedAverage(workloads);
  const peakWorkload = percentile(workloads, 0.9);
  const groundRegular = matched.map((day) => day.regular ?? 0);
  const systemIds = daily.map((day) => day.systemIds).filter((value) => value > 0);
  const regularCapacity = groundRegular.length ? median(groundRegular) : median(systemIds);
  const regularCapacitySource = groundRegular.length ? "ground" : systemIds.length ? "system" : "none";
  const permanentRequired = requiredFor(baseWorkload, rule);
  const peakRequired = requiredFor(peakWorkload, rule);
  const permanentGap = permanentRequired == null ? null : permanentRequired - regularCapacity;
  const peakFlex = permanentRequired == null || peakRequired == null ? 0 : Math.max(0, peakRequired - permanentRequired);
  const shortageDays = matched.filter((day) => day.required != null && day.regular != null && day.required > day.regular).length;
  const previousBlock = daily.slice(-14, -7);
  const recentBlock = daily.slice(-7);
  const previousGap = blockGap(previousBlock, rule);
  const recentGap = blockGap(recentBlock, rule);
  const sustainedShortage = previousGap != null && recentGap != null && previousGap > 0 && recentGap > 0 && shortageDays >= 7;
  const confidence = sourceDays >= Math.ceil(settings.baselineDays * 0.8) && matchedDays >= settings.minimumMatchedDays
    ? "high"
    : sourceDays >= settings.minimumMatchedDays && matchedDays >= Math.ceil(settings.minimumMatchedDays / 2)
      ? "medium"
      : "low";
  const alerts = daily.flatMap((day) => day.alerts).sort((a, b) => b.date.localeCompare(a.date) || a.type.localeCompare(b.type));
  const hasRecentSpike = alerts.some((alert) => alert.type === "volume_spike" && alert.date >= recentAlertStart);

  let status: CapacityDecisionStatus;
  if (!sourceDays || !baseWorkload) status = "no_data";
  else if (!rule) status = "unconfigured";
  else if (matchedDays < settings.minimumMatchedDays) status = "ground_required";
  else if ((permanentGap ?? 0) > 0 && sustainedShortage) status = "hire_candidate";
  else if ((permanentGap ?? 0) > 0 && hasRecentSpike) status = "temporary_surge";
  else if ((permanentGap ?? 0) > 0) status = "monitor";
  else if (peakFlex > 0) status = "flex";
  else if ((permanentGap ?? 0) < -1) status = "surplus";
  else status = "balanced";

  const label = status === "hire_candidate" ? `Hire candidate ${Math.max(0, Math.ceil(permanentGap ?? 0))}`
    : status === "flex" ? `Peak flex +${peakFlex}`
    : status === "monitor" ? "Monitor"
    : status === "temporary_surge" ? "Temporary surge"
    : status === "ground_required" ? "Ground update required"
    : status === "surplus" ? `Rebalance ${Math.abs(Math.floor(permanentGap ?? 0))}`
    : status === "unconfigured" ? "Configure master"
    : status === "no_data" ? "No data"
    : "Balanced";
  const action = status === "hire_candidate" ? `Sustained shortage across both 7-day reviews; validate hiring ${Math.max(0, Math.ceil(permanentGap ?? 0))}.`
    : status === "flex" ? `Keep base staffing; arrange ${peakFlex} flex resource${peakFlex === 1 ? "" : "s"} for peak days.`
    : status === "monitor" ? "Shortage is not sustained across both reviews; monitor before hiring."
    : status === "temporary_surge" ? "Recent spike may be temporary; use flex cover and review the next completed days."
    : status === "ground_required" ? `Only ${matchedDays}/${settings.minimumMatchedDays} required days are ground-matched; complete updates before hiring.`
    : status === "surplus" ? "Review redeployment or attrition replacement before adding capacity."
    : status === "unconfigured" ? "Configure SPR, baseline and alert thresholds in Capacity Master."
    : status === "no_data" ? "No completed workload is available for a workforce decision."
    : "Regular capacity is aligned to the stable 14-day requirement.";

  return {
    stationCode,
    baselineDays: settings.baselineDays,
    sourceDays,
    matchedDays,
    minimumMatchedDays: settings.minimumMatchedDays,
    latestDate: latest?.date ?? null,
    latestSystemIds: latest?.systemIds ?? 0,
    baseWorkload,
    peakWorkload,
    regularCapacity,
    regularCapacitySource,
    permanentRequired,
    permanentGap,
    peakRequired,
    peakFlex,
    shortageDays,
    sustainedShortage,
    confidence,
    status,
    label,
    action,
    daily,
    alerts
  };
}
