import { headers } from "next/headers";

export type AccessSurface = "dashboard" | "ops" | "workforce";

export const opsAccessPageCodes = [
  "ops_pulse",
  "performance",
  "capacity",
  "capacity_overview",
  "capacity_associates",
  "capacity_delivery",
  "capacity_hiring",
  "ops_reports",
  "daily_submission",
  "cod",
  "cod_executive_reconciliation",
  "cod_submission",
  "cod_validation",
  "cod_reports",
  "cod_portal_checks",
  "cod_cash_in_associate",
  "cps",
  "cps_overview",
  "cps_daily",
  "cps_monthly",
  "cps_cost_breakup",
  "cps_stations",
  "cps_shipments",
  "cps_associates",
  "cps_reports",
  "cps_inputs",
  "cps_unmapped",
  "service_network",
  "service_network_master",
  "delivery_associates",
  "business_documents",
  "expense_requests",
  "payment_requests",
  "payment_approvals",
  "payment_reports",
  "master_locations",
  "master_providers",
  "master_models",
  "cod_master",
  "performance_master",
  "capacity_master",
  "imports",
  "users",
  "fleet",
  "fleet_action_center",
  "fleet_vehicle_view",
  "fleet_date_view",
  "fleet_station_view",
  "fleet_tracking",
  "fleet_fuel_log",
  "fleet_live_gps",
  "fleet_maintenance",
  "fleet_reports"
] as const;

const opsPageCodes = new Set<string>(opsAccessPageCodes);

const sharedPageCodes = new Set([
  "imports",
  "business_documents",
  "expense_requests",
  "payment_requests",
  "payment_approvals",
  "payment_reports",
  "master_locations",
  "master_providers",
  "master_models",
  "users",
  "fleet",
  "fleet_action_center",
  "fleet_vehicle_view",
  "fleet_date_view",
  "fleet_station_view",
  "fleet_tracking",
  "fleet_fuel_log",
  "fleet_live_gps",
  "fleet_maintenance",
  "fleet_reports"
]);

export const workforceAccessPageCodes = [
  "delivery_associates",
  "vendors",
  "workers",
  "executive_id_onboarding",
  "provider_mapping",
  "people_review",
  "workforce_activity",
  "workforce_rate_cards",
  "workforce_earnings",
  "workforce_incentives",
  "workforce_adjustments",
  "workforce_payroll",
  "workforce_communications",
  "workforce_communications_app",
  "workforce_communications_whatsapp",
  "workforce_communications_history",
  "workforce_categories",
  "workforce_whatsapp",
  "users",
  "designations"
] as const;

const workforcePageCodes = new Set<string>(workforceAccessPageCodes);

export function currentAccessSurface(): AccessSurface {
  const host = (
    headers().get("x-forwarded-host") ??
    headers().get("host") ??
    ""
  ).split(":")[0].toLowerCase();
  if (host === "ops.dropxlogistics.com" || host.startsWith("ops-")) return "ops";
  if (
    host === "workforce.dropxlogistics.com" ||
    host.startsWith("workforce-") ||
    (host.endsWith(".vercel.app") && host.includes("workforce"))
  ) return "workforce";
  return "dashboard";
}

export function pageBelongsToSurface(code: string, surface: AccessSurface) {
  if (surface === "workforce") return workforcePageCodes.has(code);
  if (sharedPageCodes.has(code)) return true;
  return surface === "ops" ? opsPageCodes.has(code) : !opsPageCodes.has(code);
}

export function accessSurfaceLabel(surface: AccessSurface) {
  if (surface === "ops") return "Ops";
  if (surface === "workforce") return "Workforce";
  return "Dashboard";
}
