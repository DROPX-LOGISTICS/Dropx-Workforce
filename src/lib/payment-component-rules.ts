export const componentSources = ["biometric_attendance", "amazon_daily_shipment", "manual_approved"] as const;
export const componentBases = ["attendance_day", "shipment_active_day", "shipment_quantity", "manual"] as const;
export const shipmentMetrics = ["total_delivery", "total_activity", "amazon_delivery", "swa_delivery", "customer_return", "seller_pickup", "seller_return"] as const;

export type ComponentSource = typeof componentSources[number];
export type ComponentBasis = typeof componentBases[number];
export type ShipmentMetric = typeof shipmentMetrics[number];
export type PaymentComponentRule = {
  fieldId: string;
  componentCode: string;
  sourceOfTruth: ComponentSource;
  calculationBasis: ComponentBasis;
  sourceMetric: ShipmentMetric | null;
  minimumUnits: number | null;
};

export type PaymentFieldRuleShape = {
  id: string;
  code: string;
  field_type: "amount" | "production";
  pay_schedule: "per_hour" | "per_day" | "per_month" | null;
};

export const earningRuleOptions = (field: PaymentFieldRuleShape) => {
  if (field.field_type === "production") return [
    { value: "amazon_daily_shipment:shipment_quantity", label: "Amazon shipment quantity" },
    { value: "manual_approved:manual", label: "Approved manual quantity" }
  ];
  if (field.pay_schedule === "per_day") return [
    { value: "biometric_attendance:attendance_day", label: "Biometric attendance day" },
    { value: "amazon_daily_shipment:shipment_active_day", label: "Amazon activity day" },
    { value: "manual_approved:manual", label: "Approved manual day" }
  ];
  return [{ value: "manual_approved:manual", label: "Approved manual amount" }];
};

export function defaultComponentRule(field: PaymentFieldRuleShape): PaymentComponentRule {
  if (field.field_type === "production") return {
    fieldId: field.id, componentCode: field.code, sourceOfTruth: "amazon_daily_shipment",
    calculationBasis: "shipment_quantity", sourceMetric: null, minimumUnits: null
  };
  if (field.pay_schedule === "per_day") return {
    fieldId: field.id, componentCode: field.code, sourceOfTruth: "biometric_attendance",
    calculationBasis: "attendance_day", sourceMetric: null, minimumUnits: null
  };
  return {
    fieldId: field.id, componentCode: field.code, sourceOfTruth: "manual_approved",
    calculationBasis: "manual", sourceMetric: null, minimumUnits: null
  };
}

export function componentRuleLabel(rule: Pick<PaymentComponentRule, "sourceOfTruth" | "calculationBasis" | "sourceMetric" | "minimumUnits">) {
  if (rule.sourceOfTruth === "biometric_attendance") return "Biometric attendance day";
  if (rule.sourceOfTruth === "manual_approved") return "Approved manual evidence";
  if (rule.calculationBasis === "shipment_active_day") {
    return `Amazon activity day · ${String(rule.sourceMetric ?? "total_activity").replaceAll("_", " ")} ≥ ${rule.minimumUnits ?? 1}`;
  }
  return `Amazon quantity · ${String(rule.sourceMetric ?? "total_activity").replaceAll("_", " ")}`;
}

export function storedComponentRules(values: Record<string, unknown> | null | undefined): Record<string, PaymentComponentRule> {
  const raw = values?.DROPX_COMPONENT_RULES;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).flatMap(([code, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const candidate = value as Record<string, unknown>;
    const sourceOfTruth = String(candidate.sourceOfTruth ?? candidate.source_of_truth ?? "") as ComponentSource;
    const calculationBasis = String(candidate.calculationBasis ?? candidate.calculation_basis ?? "") as ComponentBasis;
    const sourceMetricRaw = candidate.sourceMetric ?? candidate.source_metric;
    const minimumRaw = candidate.minimumUnits ?? candidate.minimum_units;
    if (!componentSources.includes(sourceOfTruth) || !componentBases.includes(calculationBasis)) return [];
    const sourceMetric = sourceMetricRaw == null || sourceMetricRaw === "" ? null : String(sourceMetricRaw) as ShipmentMetric;
    if (sourceMetric && !shipmentMetrics.includes(sourceMetric)) return [];
    const minimumUnits = minimumRaw == null || minimumRaw === "" ? null : Number(minimumRaw);
    if (minimumUnits !== null && (!Number.isFinite(minimumUnits) || minimumUnits < 0)) return [];
    return [[code, { fieldId: "", componentCode: code, sourceOfTruth, calculationBasis, sourceMetric, minimumUnits } satisfies PaymentComponentRule]];
  }));
}
