import type { CapacityRule } from "@/lib/ops-pulse/capacity";
import { capacityPlanningSettings } from "@/lib/ops-pulse/capacity";
import type { CapacityAdHocUsage } from "@/lib/ops-pulse/capacity-ad-hoc";
import type { CapacityStationDay } from "@/lib/ops-pulse/capacity-shipments";

export type CapacityPlanningAlert = {
  id: string;
  stationCode: string;
  date: string;
  type: "associate_drop" | "volume_spike" | "ad_hoc_mismatch";
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
  | "balanced"
  | "surplus"
  | "unconfigured"
  | "no_data";

export type CapacityPlanningDay = {
  date: string;
  systemIds: number;
  workload: number;
  inbound: number;
  internalDAs: number;
  externalDAs: number;
  paymentRequests: number;
  externalDaMismatch: number;
  required: number | null;
  spr: number;
  source: string;
  alerts: CapacityPlanningAlert[];
};

export type CapacityPlanningDecision = {
  stationCode: string;
  baselineDays: number;
  sourceDays: number;
  classifiedDays: number;
  adHocDays: number;
  latestDate: string | null;
  latestSystemIds: number;
  baseWorkload: number;
  peakWorkload: number;
  internalCapacity: number;
  internalCapacitySource: "payment_adjusted" | "system" | "none";
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

function requiredFor(workload: number, rule: CapacityRule | undefined) {
  if (!rule || !workload || !rule.targetSpr) return null;
  return Math.ceil(workload / rule.targetSpr * (1 + rule.bufferPercent / 100));
}

function blockGap(days: CapacityPlanningDay[], rule: CapacityRule | undefined) {
  const operational = days.filter((day) => day.workload > 0 && day.systemIds > 0);
  if (!rule || operational.length < 3) return null;
  const required = requiredFor(trimmedAverage(operational.map((day) => day.workload)), rule);
  return required == null ? null : required - median(operational.map((day) => day.internalDAs));
}

export function buildCapacityPlanningDecision({
  stationCode,
  rows,
  adHocUsage,
  rule
}: {
  stationCode: string;
  rows: CapacityStationDay[];
  adHocUsage: CapacityAdHocUsage[];
  rule: CapacityRule | undefined;
}): CapacityPlanningDecision {
  const settings = capacityPlanningSettings(rule);
  const adHocByDate = new Map<string, CapacityAdHocUsage>();
  adHocUsage.filter((row) => row.stationCode === stationCode).forEach((row) => adHocByDate.set(row.workDate, row));
  const rowByDate = new Map<string, CapacityStationDay>();
  rows.filter((row) => row.station_code === stationCode).forEach((row) => rowByDate.set(row.work_date, row));
  const dates = [...rowByDate.keys()].sort().slice(-settings.baselineDays);
  const daily: CapacityPlanningDay[] = dates.map((date) => {
    const row = rowByDate.get(date)!;
    const approvedAdHoc = adHocByDate.get(date);
    const systemIds = num(row.active_ids);
    const approvedCount = num(approvedAdHoc?.externalDaCount);
    // Amazon's road-ID total is authoritative and never increases here.
    // Approved external DAs classify who operated those same IDs; they are not
    // additional IDs or additional capacity.
    const externalDAs = Math.min(systemIds, approvedCount);
    const internalDAs = Math.max(0, systemIds - externalDAs);
    const workload = num(row.delivered);
    return {
      date,
      systemIds,
      workload,
      inbound: num(row.inbound),
      internalDAs,
      externalDAs,
      paymentRequests: num(approvedAdHoc?.paymentRequests),
      externalDaMismatch: Math.max(0, approvedCount - systemIds),
      required: requiredFor(workload, rule),
      spr: num(row.active_ids) ? workload / num(row.active_ids) : 0,
      source: row.volume_source || "No source",
      alerts: []
    };
  });

  const recentAlertStart = daily.at(-7)?.date ?? daily[0]?.date ?? "";
  daily.forEach((day, index) => {
    if (day.externalDaMismatch > 0) {
      day.alerts.push({
        id: `${stationCode}-${day.date}-ad-hoc-mismatch`,
        stationCode,
        date: day.date,
        type: "ad_hoc_mismatch",
        severity: "warning",
        title: "External DA count exceeds Amazon IDs",
        detail: `${day.externalDAs + day.externalDaMismatch} approved external DAs versus ${day.systemIds} Amazon IDs used on ${day.date}.`,
        changePercent: null
      });
    }
    if (index < 2 || day.date < recentAlertStart) return;
    const prior = daily.slice(Math.max(0, index - 7), index);
    const priorHeadcount = median(prior.map((item) => item.internalDAs).filter((value) => value > 0));
    const currentHeadcount = day.internalDAs;
    if (priorHeadcount > 0 && currentHeadcount < priorHeadcount) {
      const drop = (priorHeadcount - currentHeadcount) / priorHeadcount * 100;
      if (drop >= settings.associateDropPercent) {
        day.alerts.push({
          id: `${stationCode}-${day.date}-associate-drop`,
          stationCode,
          date: day.date,
          type: "associate_drop",
          severity: drop >= settings.associateDropPercent * 1.5 ? "critical" : "warning",
          title: `Internal DA coverage dropped ${Math.round(drop)}%`,
          detail: `${Math.round(priorHeadcount)} internal DAs at baseline versus ${Math.round(currentHeadcount)} on ${day.date}.`,
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

  const operationalDays = daily.filter((day) => day.workload > 0 && day.systemIds > 0);
  const sourceDays = operationalDays.length;
  const classifiedDays = operationalDays.length;
  const adHocDays = operationalDays.filter((day) => day.externalDAs > 0).length;
  const workloads = operationalDays.map((day) => day.workload);
  const baseWorkload = trimmedAverage(workloads);
  const peakWorkload = percentile(workloads, 0.9);
  const adjustedInternal = operationalDays.map((day) => day.internalDAs);
  const systemIds = operationalDays.map((day) => day.systemIds);
  const internalCapacity = adjustedInternal.length ? median(adjustedInternal) : median(systemIds);
  const internalCapacitySource = adHocUsage.some((row) => row.stationCode === stationCode && row.workDate >= (dates[0] ?? "") && row.workDate <= (dates.at(-1) ?? ""))
    ? "payment_adjusted"
    : systemIds.length ? "system" : "none";
  const permanentRequired = requiredFor(baseWorkload, rule);
  const peakRequired = requiredFor(peakWorkload, rule);
  const permanentGap = permanentRequired == null ? null : permanentRequired - internalCapacity;
  const peakFlex = permanentRequired == null || peakRequired == null ? 0 : Math.max(0, peakRequired - permanentRequired);
  const shortageDays = operationalDays.filter((day) => day.required != null && day.required > day.internalDAs).length;
  const previousBlock = daily.slice(-14, -7);
  const recentBlock = daily.slice(-7);
  const previousGap = blockGap(previousBlock, rule);
  const recentGap = blockGap(recentBlock, rule);
  const sustainedShortage = previousGap != null && recentGap != null && previousGap > 0 && recentGap > 0 && shortageDays >= 7;
  const confidence = sourceDays >= Math.ceil(settings.baselineDays * 0.8)
    ? "high"
    : sourceDays >= settings.minimumSourceDays
      ? "medium"
      : "low";
  const alerts = daily.flatMap((day) => day.alerts).sort((a, b) => b.date.localeCompare(a.date) || a.type.localeCompare(b.type));
  const hasRecentSpike = alerts.some((alert) => alert.type === "volume_spike" && alert.date >= recentAlertStart);

  let status: CapacityDecisionStatus;
  if (!sourceDays || !baseWorkload) status = "no_data";
  else if (!rule) status = "unconfigured";
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
    : status === "surplus" ? `Rebalance ${Math.abs(Math.floor(permanentGap ?? 0))}`
    : status === "unconfigured" ? "Configure master"
    : status === "no_data" ? "No data"
    : "Balanced";
  const action = status === "hire_candidate" ? `Sustained shortage across both 7-day reviews; validate hiring ${Math.max(0, Math.ceil(permanentGap ?? 0))}.`
    : status === "flex" ? `Keep base staffing; arrange ${peakFlex} flex resource${peakFlex === 1 ? "" : "s"} for peak days.`
    : status === "monitor" ? "Shortage is not sustained across both reviews; monitor before hiring."
    : status === "temporary_surge" ? "Recent spike may be temporary; use flex cover and review the next completed days."
    : status === "surplus" ? "Review redeployment or attrition replacement before adding capacity."
    : status === "unconfigured" ? "Configure SPR, baseline and alert thresholds in Capacity Master."
    : status === "no_data" ? "No completed workload is available for a workforce decision."
    : "Internal DA coverage is aligned to the stable 14-day requirement.";

  return {
    stationCode,
    baselineDays: settings.baselineDays,
    sourceDays,
    classifiedDays,
    adHocDays,
    latestDate: latest?.date ?? null,
    latestSystemIds: latest?.systemIds ?? 0,
    baseWorkload,
    peakWorkload,
    internalCapacity,
    internalCapacitySource,
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
