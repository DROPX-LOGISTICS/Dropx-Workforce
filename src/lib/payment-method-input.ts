import { componentBases, componentSources, shipmentMetrics, type PaymentComponentRule } from "@/lib/payment-component-rules";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parsePaymentMethodInput(form: FormData, editing: boolean) {
  const id = editing ? String(form.get("id") ?? "").trim() : null;
  const code = String(form.get("code") ?? "").trim().toUpperCase();
  const name = String(form.get("name") ?? "").trim();
  const fieldIds = [...new Set(form.getAll("field_ids").map((value) => String(value).trim()))];
  const designationIds = [...new Set(form.getAll("designation_ids").map((value) => String(value).trim()))];
  if (editing && (!id || !uuid.test(id))) throw new Error("Select a valid payment method.");
  if (!/^[A-Z0-9_]{1,80}$/.test(code)) throw new Error("Method ID must contain letters, numbers or underscores (up to 80 characters).");
  if (!name || name.length > 160) throw new Error("Enter a method name (up to 160 characters).");
  if (!fieldIds.length || fieldIds.length > 50 || fieldIds.some((field) => !uuid.test(field))) throw new Error("Select between 1 and 50 valid payment fields.");
  if (!designationIds.length || designationIds.length > 100 || designationIds.some((designation) => !uuid.test(designation))) throw new Error("Select between 1 and 100 valid Workforce designations.");
  let componentRules: PaymentComponentRule[];
  try {
    const parsed = JSON.parse(String(form.get("component_rules_json") ?? "[]")) as unknown;
    if (!Array.isArray(parsed)) throw new Error();
    componentRules = parsed as PaymentComponentRule[];
  } catch { throw new Error("Configure an earning rule for every selected payment field."); }
  const ruleFields = componentRules.map((rule) => String(rule.fieldId ?? "").trim());
  if (componentRules.length !== fieldIds.length || new Set(ruleFields).size !== fieldIds.length || fieldIds.some((field) => !ruleFields.includes(field))) {
    throw new Error("Configure exactly one earning rule for every selected payment field.");
  }
  for (const rule of componentRules) {
    if (!uuid.test(rule.fieldId) || !/^[A-Z0-9_]{1,120}$/.test(String(rule.componentCode ?? ""))) throw new Error("A payment component rule is invalid.");
    if (!componentSources.includes(rule.sourceOfTruth) || !componentBases.includes(rule.calculationBasis)) throw new Error("Choose a valid earning rule for every payment component.");
    if (rule.sourceOfTruth === "biometric_attendance" && rule.calculationBasis !== "attendance_day") throw new Error("Biometric payments must use an attendance-day rule.");
    if (rule.sourceOfTruth === "manual_approved" && rule.calculationBasis !== "manual") throw new Error("Manual payments must use approved manual evidence.");
    if (rule.sourceOfTruth === "amazon_daily_shipment" && !["shipment_active_day", "shipment_quantity"].includes(rule.calculationBasis)) throw new Error("Amazon payments must use an activity-day or shipment-quantity rule.");
    if (rule.sourceOfTruth === "amazon_daily_shipment" && (!rule.sourceMetric || !shipmentMetrics.includes(rule.sourceMetric))) throw new Error("Choose the Amazon metric for every Amazon payment component.");
    if (rule.calculationBasis === "shipment_active_day" && (rule.minimumUnits == null || !Number.isFinite(Number(rule.minimumUnits)) || Number(rule.minimumUnits) < 0 || Number(rule.minimumUnits) > 1000000)) throw new Error("Enter a valid minimum activity for every Amazon activity-day component.");
  }
  return { id, code, name, fieldIds, designationIds, componentRules };
}
