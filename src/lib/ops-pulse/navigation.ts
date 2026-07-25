import type { NavItem } from "@/lib/app-navigation";
import type { OperatingMode } from "@/lib/ops-pulse/operating-context";

const commonStart: NavItem[] = [
  { code: "ops_pulse", label: "Dashboard", href: "/ops-pulse", icon: "#" },
  { code: "daily_submission", label: "Daily Operations", href: "/ops-pulse/daily-submission", icon: "D" },
  {
    code: "cod_reports",
    label: "Performance",
    icon: "P",
    children: [
      { code: "cod_reports", label: "Daily EDSP", href: "/ops-pulse/performance?view=daily" },
      { code: "cod_reports", label: "Amazon SLS", href: "/ops-pulse/performance?view=sls" },
      { code: "cps_shipments", label: "Shipment Activity", href: "/ops-pulse/performance/shipments" }
    ]
  }
];

const cps: NavItem = {
  code: "cps",
  label: "CPS",
  icon: "C",
  children: [
    { code: "cps_overview", label: "Overview", href: "/cps" },
    { code: "cps_stations", label: "Stations", href: "/cps?view=stations" },
    { code: "cps_shipments", label: "Shipments", href: "/cps?view=shipments" },
    { code: "cps_associates", label: "Associates", href: "/cps?view=associates" },
    { code: "cps_reports", label: "Reports", href: "/cps?view=reports" },
    { code: "imports", label: "Imports", href: "https://dashboard.dropxlogistics.com/imports" },
    { code: "cps_unmapped", label: "Unmapped IDs", href: "/cps?view=unmapped" },
    { code: "cps_inputs", label: "Inputs", href: "/cps?view=inputs" }
  ]
};

const administration: NavItem[] = [
  {
    code: "master_data",
    label: "Ops Masters",
    icon: "*",
    children: [
      { code: "cod_master", label: "COD Master", href: "/master/cod-master" },
      { code: "master_locations", label: "Station Master", href: "/master/location" },
      { code: "master_providers", label: "Client / Provider Master", href: "/master/providers" },
      { code: "master_models", label: "Operation Models", href: "/master/models" }
    ]
  },
  {
    code: "users",
    label: "Users & Access",
    icon: "@",
    children: [
      { code: "users", label: "Ops Users & Scope", href: "/ops-pulse/access" },
      { code: "users", label: "Manage Roles", href: "/users?section=roles" }
    ]
  }
];

function modelOperations(mode: OperatingMode): NavItem {
  if (mode === "amazon_now") {
    return {
      code: "ops_pulse",
      label: "Live Operations",
      icon: "L",
      children: [
        { code: "ops_pulse", label: "Shift Control", href: "/ops-pulse?view=shift" },
        { code: "ops_pulse", label: "Hourly Performance", href: "/ops-pulse?view=hourly" },
        { code: "daily_submission", label: "Attendance & Reporting", href: "/ops-pulse/daily-submission" },
        { code: "cod_reports", label: "Exceptions", href: "/ops-pulse/cod/reports?client=amazon" },
        { code: "cod_reports", label: "Performance Reports", href: "/ops-pulse/reports/amazon" }
      ]
    };
  }
  if (mode === "flipkart_odh_mdh") {
    return {
      code: "cod",
      label: "Operations",
      icon: "O",
      children: [
        { code: "cod_submission", label: "COD Submission", href: "/ops-pulse/cod/submission?client=flipkart" },
        { code: "cod_validation", label: "Deposit Validation", href: "/ops-pulse/cod/validation?client=flipkart" },
        { code: "cod_reports", label: "COD Reports", href: "/ops-pulse/cod/reports?client=flipkart" }
      ]
    };
  }
  return {
    code: "cod",
    label: "Operations",
    icon: "O",
    children: [
      { code: "cod_executive_reconciliation", label: "Executive Reconciliation", href: "/ops-pulse/cod/executive-reconciliation?client=amazon" },
      { code: "cod_submission", label: "COD Submission", href: "/ops-pulse/cod/submission?client=amazon" },
      { code: "cod_validation", label: "Validation & Closure", href: "/ops-pulse/cod/validation?client=amazon" },
      { code: "cod_portal_checks", label: "SCC Portal Checks", href: "/ops-pulse/cod/portal-checks" },
      { code: "cod_reports", label: "COD Reports", href: "/ops-pulse/cod/reports?client=amazon" }
      ,{ code: "cod_reports", label: "Performance Reports", href: "/ops-pulse/reports/amazon" }
    ]
  };
}

export function opsNavItemsForMode(mode: OperatingMode): NavItem[] {
  return [...commonStart, modelOperations(mode), cps, ...administration];
}

export function normalizeOpsClient(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "amazon" || normalized === "flipkart" ? normalized : null;
}
