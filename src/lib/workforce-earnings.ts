import { readAllRows } from "@/lib/supabase-pagination";
import type { AuthorizationContext } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type WorkforceRateCard = {
  id: string;
  company_id: string;
  name: string;
  provider_id: string;
  station_id: string | null;
  designation_id: string | null;
  pay_type: "per_shipment" | "per_activity" | "fixed_daily" | "fixed_monthly" | "hybrid";
  effective_from: string;
  effective_to: string | null;
  delivery_rate: number | string;
  return_rate: number | string;
  mfn_rate: number | string;
  mfn_return_rate: number | string;
  fuel_rate: number | string;
  fixed_amount: number | string;
  guarantee_amount: number | string;
  status: "draft" | "active" | "paused" | "closed";
  approved_at?: string | null;
};

export type WorkforceIncentiveCampaign = {
  id: string;
  name: string;
  provider_id: string | null;
  station_id: string | null;
  designation_id: string | null;
  metric: "total_delivery" | "total_activity" | "amazon_delivery" | "swa_delivery" | "c_return" | "mfn";
  calculation_type: "per_unit_above_threshold" | "flat_threshold";
  threshold_value: number | string;
  rate_value: number | string;
  flat_amount: number | string;
  maximum_amount: number | string | null;
  effective_from: string;
  effective_to: string;
  status: "draft" | "active" | "paused" | "closed";
  approved_at?: string | null;
};

export type WorkforceAdjustment = {
  id: string;
  workforce_id: string;
  adjustment_type: "earning" | "deduction";
  category: string;
  amount: number | string;
  effective_date: string;
  reason: string;
  status: "draft" | "pending" | "approved" | "rejected" | "posted" | "cancelled";
};

type CpsShipmentRow = {
  id: string;
  client: string;
  work_date: string;
  station_code: string;
  provider_employee_id: string;
  provider_employee_name: string | null;
  amazon_delivery: number | string | null;
  swa_delivery: number | string | null;
  c_return: number | string | null;
  mfn: number | string | null;
  mfn_return: number | string | null;
  total_delivery: number | string | null;
  total_activity: number | string | null;
  da_total_pay: number | string | null;
  mapping_status: string | null;
  updated_at: string | null;
};

type ProviderMappingRow = {
  id: string;
  workforce_id: string | null;
  field_executive_id: string | null;
  contractor_id: string | null;
  employee_id: string | null;
  provider_id: string;
  station_id: string | null;
  provider_member_id: string;
  effective_from: string;
  effective_to: string | null;
  pay_type: string | null;
  payment_values: Record<string, unknown> | null;
  delivery_rate: number | string | null;
  pickup_rate: number | string | null;
  mfn_rate: number | string | null;
  mfn_return_rate: number | string | null;
  guarantee_amount: number | string | null;
  fuel_rate: number | string | null;
  status: string;
};

type WorkforceProfileRow = {
  id: string;
  full_name: string;
  dropx_id: string | null;
  designation_id: string;
  location_id: string;
  source_profile_type: string;
  source_profile_id: string;
  onboarding_status: string | null;
  lifecycle_status: string | null;
  is_active: boolean;
  bank_account_no: string | null;
  ifsc_code: string | null;
};

type ProviderRow = { id: string; code: string; name: string };
type StationRow = { id: string; station_code: string; station_name: string | null };

export type WorkforceEarningLine = {
  key: string;
  sourceType: "shipment" | "adjustment";
  sourceId: string;
  workforceId: string | null;
  mappingId: string | null;
  rateCardId: string | null;
  providerId: string | null;
  providerName: string;
  providerMemberId: string;
  dropxId: string | null;
  workerName: string;
  designationId: string | null;
  stationId: string | null;
  stationCode: string;
  workDate: string;
  totalDelivery: number;
  totalActivity: number;
  amazonDelivery: number;
  swaDelivery: number;
  customerReturn: number;
  mfn: number;
  mfnReturn: number;
  baseAmount: number;
  incentiveAmount: number;
  adjustmentAmount: number;
  netAmount: number;
  calculationSource: "rate_card" | "mapped_rate" | "imported_payout" | "adjustment" | "unresolved";
  status: "ready" | "hold" | "unmapped" | "missing_rate";
  holdReasons: string[];
  sourceUpdatedAt: string | null;
  trace: Record<string, unknown>;
};

export type WorkforceEarningSummary = {
  workforceId: string;
  dropxId: string;
  workerName: string;
  stationCode: string;
  bankAccountNo: string;
  ifscCode: string;
  shipmentCount: number;
  activityCount: number;
  workDays: number;
  baseAmount: number;
  incentiveAmount: number;
  earningAdjustments: number;
  deductions: number;
  grossAmount: number;
  netAmount: number;
  status: "ready" | "hold";
  holdReasons: string[];
  providerIds: string[];
  lines: WorkforceEarningLine[];
};

export type WorkforceEarningsSnapshot = {
  from: string;
  to: string;
  lines: WorkforceEarningLine[];
  summaries: WorkforceEarningSummary[];
  exceptions: WorkforceEarningLine[];
  sourceRowCount: number;
  totalSourceShipments: number;
  totalShipments: number;
  totalBase: number;
  totalIncentives: number;
  totalAdjustments: number;
  totalDeductions: number;
  totalNet: number;
  readyWorkers: number;
  heldWorkers: number;
  latestSourceUpdate: string | null;
  setupRequired: boolean;
  warnings: string[];
};

export type WorkforceEarningsInput = {
  from: string;
  to: string;
  shipments: CpsShipmentRow[];
  mappings: ProviderMappingRow[];
  workforce: WorkforceProfileRow[];
  providers: ProviderRow[];
  stations: StationRow[];
  rateCards: WorkforceRateCard[];
  campaigns: WorkforceIncentiveCampaign[];
  adjustments: WorkforceAdjustment[];
};

function amount(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function key(value: unknown) {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function sourceKey(type: string | null | undefined, id: string | null | undefined) {
  return `${String(type ?? "").trim().toLowerCase()}:${String(id ?? "").trim()}`;
}

function mappingSource(mapping: ProviderMappingRow) {
  if (mapping.workforce_id) return sourceKey("workforce", mapping.workforce_id);
  if (mapping.field_executive_id) return sourceKey("field_executive", mapping.field_executive_id);
  if (mapping.contractor_id) return sourceKey("contractor", mapping.contractor_id);
  if (mapping.employee_id) return sourceKey("employee", mapping.employee_id);
  return "";
}

function isEffective(from: string, to: string | null, workDate: string) {
  return from <= workDate && (!to || to >= workDate);
}

function pickPaymentValue(values: Record<string, unknown> | null, aliases: string[]) {
  const normalized = new Map(Object.entries(values ?? {}).map(([entryKey, value]) => [key(entryKey), amount(value)]));
  for (const alias of aliases) {
    const value = normalized.get(alias);
    if (value !== undefined) return value;
  }
  return 0;
}

function legacyRates(mapping: ProviderMappingRow) {
  return {
    delivery: amount(mapping.delivery_rate) || pickPaymentValue(mapping.payment_values, ["DELIVERY_RATE", "DELIVERY", "AMAZON_DELIVERY", "TOTAL_DELIVERY_RATE", "PER_PACKET"]),
    customerReturn: amount(mapping.pickup_rate) || pickPaymentValue(mapping.payment_values, ["RETURN_RATE", "CUSTOMER_RETURN_RATE", "C_RETURN_RATE", "CRETURN", "PICKUP_RATE", "RETURN"]),
    mfn: amount(mapping.mfn_rate) || pickPaymentValue(mapping.payment_values, ["MFN_RATE", "MFN", "SELLER_PICKUP_RATE", "SELLER_PICKUP"]),
    mfnReturn: amount(mapping.mfn_return_rate) || pickPaymentValue(mapping.payment_values, ["MFN_RETURN_RATE", "MFN_RETURN", "SELLER_RETURN_RATE", "SELLER_RETURN", "SLLLER_RETURN"]),
    fuel: amount(mapping.fuel_rate) || pickPaymentValue(mapping.payment_values, ["FUEL_RATE", "FUEL"]),
    guarantee: amount(mapping.guarantee_amount) || pickPaymentValue(mapping.payment_values, ["GUARANTEE_AMOUNT", "MINIMUM_GUARANTEE", "MG_SALARY", "FIXED_AMOUNT"])
  };
}

function cardScore(card: WorkforceRateCard, stationId: string, designationId: string) {
  if (card.station_id && card.station_id !== stationId) return -1;
  if (card.designation_id && card.designation_id !== designationId) return -1;
  return (card.station_id ? 2 : 0) + (card.designation_id ? 1 : 0);
}

function historicallyEligible(rule: { status: string; approved_at?: string | null; effective_to: string | null }) {
  return rule.status === "active" || (["paused", "closed"].includes(rule.status) && Boolean(rule.approved_at) && Boolean(rule.effective_to));
}

function resolveRateCard(cards: WorkforceRateCard[], providerId: string, stationId: string, designationId: string, workDate: string) {
  return cards
    .filter((card) => historicallyEligible(card) && card.provider_id === providerId && isEffective(card.effective_from, card.effective_to, workDate))
    .map((card) => ({ card, score: cardScore(card, stationId, designationId) }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score || right.card.effective_from.localeCompare(left.card.effective_from))[0]?.card ?? null;
}

function calculateCardBase(card: WorkforceRateCard, shipment: CpsShipmentRow) {
  const totalDelivery = amount(shipment.total_delivery);
  const totalActivity = amount(shipment.total_activity);
  const variable = totalDelivery * amount(card.delivery_rate)
    + amount(shipment.c_return) * amount(card.return_rate)
    + amount(shipment.mfn) * amount(card.mfn_rate)
    + amount(shipment.mfn_return) * amount(card.mfn_return_rate)
    + totalDelivery * amount(card.fuel_rate);
  if (card.pay_type === "fixed_daily") return totalActivity > 0 ? amount(card.fixed_amount) : 0;
  if (card.pay_type === "fixed_monthly") {
    const [year, month] = shipment.work_date.split("-").map(Number);
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return totalActivity > 0 ? amount(card.fixed_amount) / Math.max(days, 1) : 0;
  }
  if (card.pay_type === "per_activity") return totalActivity * amount(card.delivery_rate) + totalDelivery * amount(card.fuel_rate);
  if (card.pay_type === "hybrid") return Math.max(variable, amount(card.guarantee_amount));
  return variable;
}

function calculateLegacyBase(mapping: ProviderMappingRow, shipment: CpsShipmentRow) {
  const rates = legacyRates(mapping);
  const variable = amount(shipment.total_delivery) * rates.delivery
    + amount(shipment.c_return) * rates.customerReturn
    + amount(shipment.mfn) * rates.mfn
    + amount(shipment.mfn_return) * rates.mfnReturn
    + amount(shipment.total_delivery) * rates.fuel;
  const payType = key(mapping.pay_type);
  const base = payType.includes("FIXED") && !payType.includes("HYBRID")
    ? (amount(shipment.total_activity) > 0 ? rates.guarantee : 0)
    : payType.includes("HYBRID") || rates.guarantee > 0
      ? Math.max(variable, rates.guarantee)
      : variable;
  return { base, hasRate: variable > 0 || rates.guarantee > 0, rates };
}

function metricValue(campaign: WorkforceIncentiveCampaign, shipment: CpsShipmentRow) {
  const values: Record<WorkforceIncentiveCampaign["metric"], unknown> = {
    total_delivery: shipment.total_delivery,
    total_activity: shipment.total_activity,
    amazon_delivery: shipment.amazon_delivery,
    swa_delivery: shipment.swa_delivery,
    c_return: shipment.c_return,
    mfn: shipment.mfn
  };
  return amount(values[campaign.metric]);
}

function calculateIncentive(campaign: WorkforceIncentiveCampaign, shipment: CpsShipmentRow) {
  const metric = metricValue(campaign, shipment);
  const threshold = amount(campaign.threshold_value);
  const calculated = campaign.calculation_type === "flat_threshold"
    ? metric >= threshold ? amount(campaign.flat_amount) : 0
    : Math.max(metric - threshold, 0) * amount(campaign.rate_value);
  const maximum = amount(campaign.maximum_amount);
  return campaign.maximum_amount !== null ? Math.min(calculated, maximum) : calculated;
}

function profileHolds(profile: WorkforceProfileRow) {
  const holds: string[] = [];
  if (!profile.is_active || key(profile.onboarding_status) !== "ACTIVE") holds.push("Workforce profile is not active");
  if (profile.lifecycle_status && !["ACTIVE", "ONBOARDING"].includes(key(profile.lifecycle_status))) holds.push(`Lifecycle is ${profile.lifecycle_status}`);
  if (!String(profile.bank_account_no ?? "").trim() || !String(profile.ifsc_code ?? "").trim()) holds.push("Bank details are incomplete");
  if (!String(profile.dropx_id ?? "").trim()) holds.push("DropX ID is missing");
  return holds;
}

export function calculateWorkforceEarnings(input: WorkforceEarningsInput): WorkforceEarningsSnapshot {
  const providerById = new Map(input.providers.map((provider) => [provider.id, provider]));
  const providerByLabel = new Map<string, ProviderRow>();
  input.providers.forEach((provider) => {
    providerByLabel.set(key(provider.code), provider);
    providerByLabel.set(key(provider.name), provider);
  });
  const stationByCode = new Map(input.stations.map((station) => [key(station.station_code), station]));
  const stationById = new Map(input.stations.map((station) => [station.id, station]));
  const workforceBySource = new Map<string, WorkforceProfileRow>();
  input.workforce.forEach((profile) => {
    workforceBySource.set(sourceKey("workforce", profile.id), profile);
    workforceBySource.set(sourceKey(profile.source_profile_type, profile.source_profile_id), profile);
  });
  const workforceById = new Map(input.workforce.map((profile) => [profile.id, profile]));
  const mappingsByMember = new Map<string, ProviderMappingRow[]>();
  input.mappings.forEach((mapping) => {
    const memberKey = key(mapping.provider_member_id);
    const rows = mappingsByMember.get(memberKey) ?? [];
    rows.push(mapping);
    mappingsByMember.set(memberKey, rows);
  });
  const rateCardsByProvider = new Map<string, WorkforceRateCard[]>();
  input.rateCards.forEach((card) => {
    const rows = rateCardsByProvider.get(card.provider_id) ?? [];
    rows.push(card);
    rateCardsByProvider.set(card.provider_id, rows);
  });
  const lines: WorkforceEarningLine[] = [];

  for (const shipment of input.shipments) {
    const provider = providerByLabel.get(key(shipment.client)) ?? null;
    const station = stationByCode.get(key(shipment.station_code)) ?? null;
    let mappingCandidates = (mappingsByMember.get(key(shipment.provider_employee_id)) ?? [])
      .filter((candidate) => candidate.status !== "cancelled"
        && (!station || !candidate.station_id || candidate.station_id === station.id)
        && isEffective(candidate.effective_from, candidate.effective_to, shipment.work_date));
    if (provider) mappingCandidates = mappingCandidates.filter((candidate) => candidate.provider_id === provider.id);
    if (station) {
      const exactStationCandidates = mappingCandidates.filter((candidate) => candidate.station_id === station.id);
      mappingCandidates = exactStationCandidates.length
        ? exactStationCandidates
        : mappingCandidates.filter((candidate) => !candidate.station_id);
    }
    const candidateProviderIds = new Set(mappingCandidates.map((candidate) => candidate.provider_id));
    const candidateStationIds = new Set(mappingCandidates.map((candidate) => candidate.station_id ?? "__ALL_STATIONS__"));
    const candidateSources = new Set(mappingCandidates.map((candidate) => {
      const source = mappingSource(candidate);
      const candidateProfile = workforceBySource.get(source);
      return candidateProfile ? sourceKey("workforce", candidateProfile.id) : source;
    }).filter(Boolean));
    const mapping = station && (provider || candidateProviderIds.size === 1) && candidateStationIds.size === 1 && candidateSources.size === 1
      ? mappingCandidates.sort((left, right) => right.effective_from.localeCompare(left.effective_from))[0] ?? null
      : null;
    const profile = mapping ? workforceBySource.get(mappingSource(mapping)) ?? null : null;
    const rateCard = mapping && profile && station
      ? resolveRateCard(rateCardsByProvider.get(mapping.provider_id) ?? [], mapping.provider_id, station.id, profile.designation_id, shipment.work_date)
      : null;
    const holds = profile ? profileHolds(profile) : [];
    if (!mapping) {
      if (!station) holds.push("Station code is not configured");
      else if (!mappingCandidates.length) holds.push("No effective provider ID mapping");
      else if (candidateSources.size > 1) holds.push("Provider ID has overlapping mappings to different people");
      else if (!provider && candidateProviderIds.size > 1) holds.push("Provider label is unknown and the ID exists with multiple providers");
      else if (candidateStationIds.size > 1) holds.push("Provider ID has multiple station mappings");
      else holds.push("Provider ID mapping could not be resolved safely");
    }
    let baseAmount = 0;
    let calculationSource: WorkforceEarningLine["calculationSource"] = "unresolved";
    let missingRate = false;
    let rateTrace: Record<string, unknown> = {};

    if (mapping && rateCard) {
      baseAmount = calculateCardBase(rateCard, shipment);
      calculationSource = "rate_card";
      rateTrace = { rateCard: rateCard.name, payType: rateCard.pay_type, policyVersion: { ...rateCard } };
    } else if (mapping && amount(shipment.da_total_pay) > 0) {
      baseAmount = amount(shipment.da_total_pay);
      calculationSource = "imported_payout";
      rateTrace = { importedPayout: baseAmount };
    } else if (mapping) {
      const legacy = calculateLegacyBase(mapping, shipment);
      baseAmount = legacy.base;
      missingRate = !legacy.hasRate;
      calculationSource = missingRate ? "unresolved" : "mapped_rate";
      rateTrace = { payType: mapping.pay_type, rates: legacy.rates };
    }

    if (mapping && missingRate) holds.push("No effective rate card or mapped rate");
    if (mapping && !profile) holds.push("Provider ID is not linked to the canonical Workforce register");

    const matchingCampaigns = mapping && profile
      ? input.campaigns.filter((campaign) => historicallyEligible(campaign)
        && campaign.effective_from <= shipment.work_date
        && campaign.effective_to >= shipment.work_date
        && (!campaign.provider_id || campaign.provider_id === mapping.provider_id)
        && (!campaign.station_id || campaign.station_id === station?.id)
        && (!campaign.designation_id || campaign.designation_id === profile.designation_id))
      : [];
    const campaignTrace = matchingCampaigns.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      amount: money(calculateIncentive(campaign, shipment))
    })).filter((campaign) => campaign.amount > 0);
    const incentiveAmount = campaignTrace.reduce((sum, campaign) => sum + campaign.amount, 0);
    const status: WorkforceEarningLine["status"] = !mapping
      ? "unmapped"
      : missingRate
        ? "missing_rate"
        : holds.length ? "hold" : "ready";

    lines.push({
      key: `shipment:${shipment.id}`,
      sourceType: "shipment",
      sourceId: shipment.id,
      workforceId: profile?.id ?? null,
      mappingId: mapping?.id ?? null,
      rateCardId: rateCard?.id ?? null,
      providerId: mapping?.provider_id ?? provider?.id ?? null,
      providerName: provider?.name ?? (mapping ? providerById.get(mapping.provider_id)?.name : null) ?? shipment.client,
      providerMemberId: shipment.provider_employee_id,
      dropxId: profile?.dropx_id ?? null,
      workerName: profile?.full_name ?? shipment.provider_employee_name ?? shipment.provider_employee_id,
      designationId: profile?.designation_id ?? null,
      stationId: station?.id ?? null,
      stationCode: shipment.station_code,
      workDate: shipment.work_date,
      totalDelivery: amount(shipment.total_delivery),
      totalActivity: amount(shipment.total_activity),
      amazonDelivery: amount(shipment.amazon_delivery),
      swaDelivery: amount(shipment.swa_delivery),
      customerReturn: amount(shipment.c_return),
      mfn: amount(shipment.mfn),
      mfnReturn: amount(shipment.mfn_return),
      baseAmount: money(baseAmount),
      incentiveAmount: money(incentiveAmount),
      adjustmentAmount: 0,
      netAmount: money(baseAmount + incentiveAmount),
      calculationSource,
      status,
      holdReasons: Array.from(new Set(holds)),
      sourceUpdatedAt: shipment.updated_at,
      trace: {
        campaigns: campaignTrace,
        counts: {
          amazonDelivery: amount(shipment.amazon_delivery),
          customerReturn: amount(shipment.c_return),
          mfn: amount(shipment.mfn),
          mfnReturn: amount(shipment.mfn_return),
          swaDelivery: amount(shipment.swa_delivery),
          totalActivity: amount(shipment.total_activity),
          totalDelivery: amount(shipment.total_delivery)
        },
        importedMappingStatus: shipment.mapping_status,
        ...rateTrace
      }
    });
  }

  // Calculate daily entitlements over all source rows/IDs, then allocate cents back to their traces.
  const shipmentById = new Map(input.shipments.map((row) => [row.id, row]));
  function aggregate(group: WorkforceEarningLine[]): CpsShipmentRow {
    const first = shipmentById.get(group[0].sourceId)!;
    const combined = { ...first };
    for (const field of ["amazon_delivery", "swa_delivery", "c_return", "mfn", "mfn_return", "total_delivery", "total_activity"] as const) {
      combined[field] = group.reduce((sum, line) => sum + amount(shipmentById.get(line.sourceId)?.[field]), 0);
    }
    return combined;
  }
  function allocate(group: WorkforceEarningLine[], value: number, apply: (line: WorkforceEarningLine, allocated: number) => void) {
    const sorted = [...group].sort((a, b) => a.key.localeCompare(b.key));
    const weight = sorted.reduce((sum, line) => sum + line.totalActivity, 0);
    const cents = Math.round(money(value) * 100);
    let distributed = 0;
    sorted.forEach((line, index) => {
      const portion = index === sorted.length - 1 ? cents - distributed
        : Math.floor(cents * (weight ? line.totalActivity / weight : 1 / sorted.length));
      distributed += portion;
      apply(line, portion / 100);
    });
  }
  const dailyCards = new Map<string, WorkforceEarningLine[]>();
  for (const line of lines) {
    line.incentiveAmount = 0;
    line.trace.campaigns = [];
    if (line.workforceId && line.rateCardId) {
      const groupKey = `${line.workforceId}:${line.workDate}:${line.rateCardId}`;
      dailyCards.set(groupKey, [...(dailyCards.get(groupKey) ?? []), line]);
    }
  }
  for (const group of dailyCards.values()) {
    const card = input.rateCards.find((rule) => rule.id === group[0].rateCardId)!;
    if (!["fixed_daily", "fixed_monthly", "hybrid"].includes(card.pay_type)) continue;
    const dailyAmount = calculateCardBase(card, aggregate(group));
    allocate(group, dailyAmount, (line, allocated) => {
      line.baseAmount = allocated;
      line.trace.dailyAllocation = { unit: "associate/day/rate-card", sourceRows: group.length, dailyAmount: money(dailyAmount) };
    });
  }
  for (const campaign of input.campaigns.filter(historicallyEligible)) {
    const groups = new Map<string, WorkforceEarningLine[]>();
    for (const line of lines) {
      if (!line.workforceId || !line.mappingId || line.workDate < campaign.effective_from || line.workDate > campaign.effective_to
        || (campaign.provider_id && campaign.provider_id !== line.providerId)
        || (campaign.station_id && campaign.station_id !== line.stationId)
        || (campaign.designation_id && campaign.designation_id !== line.designationId)) continue;
      const groupKey = `${line.workforceId}:${line.workDate}`;
      groups.set(groupKey, [...(groups.get(groupKey) ?? []), line]);
    }
    for (const group of groups.values()) {
      const dailyAmount = calculateIncentive(campaign, aggregate(group));
      allocate(group, dailyAmount, (line, allocated) => {
        line.incentiveAmount = money(line.incentiveAmount + allocated);
        if (dailyAmount > 0) (line.trace.campaigns as unknown[]).push({ id: campaign.id, name: campaign.name, amount: allocated,
          dailyAmount: money(dailyAmount), sourceRows: group.length, unit: "associate/day/campaign", policyVersion: { ...campaign } });
      });
    }
  }
  for (const line of lines) line.netAmount = money(line.baseAmount + line.incentiveAmount);

  input.adjustments.filter((adjustment) => adjustment.status === "approved" || adjustment.status === "posted").forEach((adjustment) => {
    const profile = workforceById.get(adjustment.workforce_id);
    if (!profile) return;
    const signedAmount = adjustment.adjustment_type === "deduction" ? -amount(adjustment.amount) : amount(adjustment.amount);
    const station = stationById.get(profile.location_id);
    lines.push({
      key: `adjustment:${adjustment.id}`,
      sourceType: "adjustment",
      sourceId: adjustment.id,
      workforceId: profile.id,
      mappingId: null,
      rateCardId: null,
      providerId: null,
      providerName: "Internal",
      providerMemberId: "-",
      dropxId: profile.dropx_id,
      workerName: profile.full_name,
      designationId: profile.designation_id,
      stationId: profile.location_id,
      stationCode: station?.station_code ?? "-",
      workDate: adjustment.effective_date,
      totalDelivery: 0,
      totalActivity: 0,
      amazonDelivery: 0,
      swaDelivery: 0,
      customerReturn: 0,
      mfn: 0,
      mfnReturn: 0,
      baseAmount: 0,
      incentiveAmount: 0,
      adjustmentAmount: money(signedAmount),
      netAmount: money(signedAmount),
      calculationSource: "adjustment",
      status: profileHolds(profile).length ? "hold" : "ready",
      holdReasons: profileHolds(profile),
      sourceUpdatedAt: null,
      trace: { category: adjustment.category, reason: adjustment.reason, type: adjustment.adjustment_type }
    });
  });

  const summariesByWorker = new Map<string, WorkforceEarningSummary>();
  lines.filter((line) => line.workforceId).forEach((line) => {
    const workforceId = line.workforceId!;
    const current = summariesByWorker.get(workforceId) ?? {
      workforceId,
      dropxId: line.dropxId ?? "-",
      workerName: line.workerName,
      stationCode: line.stationCode,
      bankAccountNo: String(workforceById.get(workforceId)?.bank_account_no ?? "").trim(),
      ifscCode: String(workforceById.get(workforceId)?.ifsc_code ?? "").trim(),
      shipmentCount: 0,
      activityCount: 0,
      workDays: 0,
      baseAmount: 0,
      incentiveAmount: 0,
      earningAdjustments: 0,
      deductions: 0,
      grossAmount: 0,
      netAmount: 0,
      status: "ready" as const,
      holdReasons: [],
      providerIds: [],
      lines: []
    };
    current.shipmentCount += line.totalDelivery;
    current.activityCount += line.totalActivity;
    current.baseAmount += line.baseAmount;
    current.incentiveAmount += line.incentiveAmount;
    if (line.adjustmentAmount >= 0) current.earningAdjustments += line.adjustmentAmount;
    else current.deductions += Math.abs(line.adjustmentAmount);
    current.netAmount += line.netAmount;
    current.lines.push(line);
    current.holdReasons.push(...line.holdReasons);
    if (line.providerMemberId !== "-") current.providerIds.push(line.providerMemberId);
    summariesByWorker.set(workforceId, current);
  });

  const summaries = Array.from(summariesByWorker.values()).map((summary) => {
    const workDays = new Set(summary.lines.filter((line) => line.sourceType === "shipment").map((line) => line.workDate)).size;
    const holdReasons = Array.from(new Set(summary.holdReasons));
    const baseAmount = money(summary.baseAmount);
    const incentiveAmount = money(summary.incentiveAmount);
    const earningAdjustments = money(summary.earningAdjustments);
    const deductions = money(summary.deductions);
    const netAmount = money(summary.netAmount);
    if (netAmount <= 0) holdReasons.push("Net payable is zero or negative");
    return {
      ...summary,
      workDays,
      baseAmount,
      incentiveAmount,
      earningAdjustments,
      deductions,
      grossAmount: money(baseAmount + incentiveAmount + earningAdjustments),
      netAmount,
      status: holdReasons.length ? "hold" as const : "ready" as const,
      holdReasons,
      providerIds: Array.from(new Set(summary.providerIds))
    };
  }).sort((left, right) => right.netAmount - left.netAmount || left.workerName.localeCompare(right.workerName));

  const exceptions = lines.filter((line) => !line.workforceId || line.status === "missing_rate" || line.status === "unmapped");
  const latestSourceUpdate = input.shipments.map((row) => row.updated_at).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  return {
    from: input.from,
    to: input.to,
    lines: lines.sort((left, right) => right.workDate.localeCompare(left.workDate) || left.workerName.localeCompare(right.workerName)),
    summaries,
    exceptions,
    sourceRowCount: input.shipments.length,
    totalSourceShipments: input.shipments.reduce((sum, shipment) => sum + amount(shipment.total_delivery), 0),
    totalShipments: summaries.reduce((sum, summary) => sum + summary.shipmentCount, 0),
    totalBase: money(summaries.reduce((sum, summary) => sum + summary.baseAmount, 0)),
    totalIncentives: money(summaries.reduce((sum, summary) => sum + summary.incentiveAmount, 0)),
    totalAdjustments: money(summaries.reduce((sum, summary) => sum + summary.earningAdjustments, 0)),
    totalDeductions: money(summaries.reduce((sum, summary) => sum + summary.deductions, 0)),
    totalNet: money(summaries.reduce((sum, summary) => sum + summary.netAmount, 0)),
    readyWorkers: summaries.filter((summary) => summary.status === "ready").length,
    heldWorkers: summaries.filter((summary) => summary.status === "hold").length,
    latestSourceUpdate,
    setupRequired: false,
    warnings: []
  };
}

function missingTable(error: { code?: string | null; message?: string | null } | null | undefined) {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "42P01" || error?.code === "PGRST205" || message.includes("schema cache") || message.includes("does not exist");
}

async function loadShipmentRows(companyId: string, from: string, to: string, stationCodes: string[] | null) {
  if (!supabaseAdmin) return { rows: [] as CpsShipmentRow[], error: "Supabase service role key is not configured.", truncated: false };
  const rows: CpsShipmentRow[] = [];
  const pageSize = 1000;
  let truncated = false;
  for (let start = 0; start < 100000; start += pageSize) {
    let query = supabaseAdmin
      .from("cps_shipment_daily")
      .select("id, client, work_date, station_code, provider_employee_id, provider_employee_name, amazon_delivery, swa_delivery, c_return, mfn, mfn_return, total_delivery, total_activity, da_total_pay, mapping_status, updated_at")
      .eq("company_id", companyId)
      .gte("work_date", from)
      .lte("work_date", to)
      .order("work_date", { ascending: true })
      .order("id", { ascending: true })
      .range(start, start + pageSize - 1);
    if (stationCodes) query = query.in("station_code", stationCodes.length ? stationCodes : ["__NO_LOCATION_ACCESS__"]);
    const result = await query;
    if (result.error) return { rows, error: result.error.message, truncated };
    const page = (result.data ?? []) as CpsShipmentRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
    if (start + pageSize >= 100000) truncated = true;
  }
  return { rows, error: null as string | null, truncated };
}

export async function loadWorkforceEarnings(
  authorization: AuthorizationContext,
  from: string,
  to: string,
  options: { payrollRunId?: string | null } = {}
): Promise<WorkforceEarningsSnapshot> {
  const companyId = requireCompanyId(authorization);
  if (!supabaseAdmin) {
    return { ...calculateWorkforceEarnings({ from, to, shipments: [], mappings: [], workforce: [], providers: [], stations: [], rateCards: [], campaigns: [], adjustments: [] }), warnings: ["Supabase service role key is not configured."] };
  }
  const stationResult = await supabaseAdmin.from("stations").select("id, station_code, station_name").eq("company_id", companyId).order("station_code");
  const stations = (stationResult.data ?? []) as StationRow[];
  const scopedStationIds = authorization.hasAllLocationAccess ? null : new Set(authorization.locationScopeIds);
  const visibleStations = scopedStationIds ? stations.filter((station) => scopedStationIds.has(station.id)) : stations;
  const stationCodes = authorization.hasAllLocationAccess ? null : visibleStations.map((station) => station.station_code);

  let adjustmentQuery = supabaseAdmin.from("workforce_adjustments").select("id, workforce_id, adjustment_type, category, amount, effective_date, reason, status")
    .eq("company_id", companyId).gte("effective_date", from).lte("effective_date", to);
  adjustmentQuery = options.payrollRunId === null
    ? adjustmentQuery.eq("status", "approved").is("payroll_run_id", null)
    : typeof options.payrollRunId === "string"
      ? adjustmentQuery.or(`and(status.eq.approved,payroll_run_id.is.null),and(status.eq.posted,payroll_run_id.eq.${options.payrollRunId})`)
      : adjustmentQuery.in("status", ["approved", "posted"]);

  const [shipmentResult, mappingResult, workforceResult, providerResult, rateCardResult, campaignResult, adjustmentResult] = await Promise.all([
    loadShipmentRows(companyId, from, to, stationCodes),
    readAllRows(supabaseAdmin.from("field_executive_provider_mappings")
      .select("id, workforce_id, field_executive_id, contractor_id, employee_id, provider_id, station_id, provider_member_id, effective_from, effective_to, pay_type, payment_values, delivery_rate, pickup_rate, mfn_rate, mfn_return_rate, guarantee_amount, fuel_rate, status")
      .eq("company_id", companyId).neq("status", "cancelled").lte("effective_from", to).or(`effective_to.is.null,effective_to.gte.${from}`).order("id")),
    readAllRows(supabaseAdmin.from("workforce")
      .select("id, full_name, dropx_id, designation_id, location_id, source_profile_type, source_profile_id, onboarding_status, lifecycle_status, is_active, bank_account_no, ifsc_code")
      .eq("company_id", companyId).is("deleted_at", null).neq("migration_state", "reclassified").order("id")),
    readAllRows(supabaseAdmin.from("providers").select("id, code, name").eq("company_id", companyId).order("id")),
    readAllRows(supabaseAdmin.from("workforce_rate_cards").select("id, company_id, name, provider_id, station_id, designation_id, pay_type, effective_from, effective_to, delivery_rate, return_rate, mfn_rate, mfn_return_rate, fuel_rate, fixed_amount, guarantee_amount, status, approved_at")
      .eq("company_id", companyId).neq("status", "draft").lte("effective_from", to).or(`effective_to.is.null,effective_to.gte.${from}`).order("id")),
    readAllRows(supabaseAdmin.from("workforce_incentive_campaigns").select("id, name, provider_id, station_id, designation_id, metric, calculation_type, threshold_value, rate_value, flat_amount, maximum_amount, effective_from, effective_to, status, approved_at")
      .eq("company_id", companyId).neq("status", "draft").lte("effective_from", to).gte("effective_to", from).order("id")),
    readAllRows(adjustmentQuery.order("id"))
  ]);
  const requiredError = stationResult.error?.message || shipmentResult.error || mappingResult.error?.message || workforceResult.error?.message || providerResult.error?.message;
  const optionalErrors = [rateCardResult.error, campaignResult.error, adjustmentResult.error].filter(Boolean);
  const setupRequired = optionalErrors.some((error) => missingTable(error));
  const snapshot = calculateWorkforceEarnings({
    from,
    to,
    shipments: shipmentResult.rows,
    mappings: (mappingResult.data ?? []) as ProviderMappingRow[],
    workforce: ((workforceResult.data ?? []) as WorkforceProfileRow[]).filter((profile) => authorization.hasAllLocationAccess || authorization.locationScopeIds.includes(profile.location_id)),
    providers: (providerResult.data ?? []) as ProviderRow[],
    stations: visibleStations,
    rateCards: rateCardResult.error ? [] : (rateCardResult.data ?? []) as WorkforceRateCard[],
    campaigns: campaignResult.error ? [] : (campaignResult.data ?? []) as WorkforceIncentiveCampaign[],
    adjustments: adjustmentResult.error ? [] : (adjustmentResult.data ?? []) as WorkforceAdjustment[]
  });
  return {
    ...snapshot,
    setupRequired,
    warnings: [
      requiredError,
      shipmentResult.truncated ? "Shipment source exceeded the 100,000-row calculation safety limit. Narrow the date range before payroll." : null,
      ...optionalErrors.filter((error) => !missingTable(error)).map((error) => error?.message ?? null)
    ].filter((warning): warning is string => Boolean(warning))
  };
}

export function workforceEarningsDateRange(searchParams?: { from?: string; to?: string }) {
  const to = isWorkforceDate(searchParams?.to) ? searchParams!.to! : workforceToday();
  const defaultFrom = `${to.slice(0, 8)}01`;
  const from = isWorkforceDate(searchParams?.from) ? searchParams!.from! : defaultFrom;
  if (from > to) return { from: to, to };
  const maxFrom = new Date(`${to}T00:00:00.000Z`);
  maxFrom.setUTCDate(maxFrom.getUTCDate() - 92);
  return { from: from < maxFrom.toISOString().slice(0, 10) ? maxFrom.toISOString().slice(0, 10) : from, to };
}

export function isWorkforceDate(value: string | null | undefined): value is string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function workforceToday(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Kolkata",
    year: "numeric"
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
