import type { NavItem } from "@/lib/app-navigation";

export type OpsClientCode = "amazon" | "flipkart";

export const opsNavItems: NavItem[] = [
  { code: "ops_pulse", label: "Dashboard", href: "/ops-pulse", icon: "#" },
  { code: "daily_submission", label: "Daily Submission", href: "/ops-pulse/daily-submission", icon: "D" },
  {
    code: "cod",
    label: "Amazon Operations",
    icon: "A",
    children: [
      { code: "cod_executive_reconciliation", label: "Executive Reconciliation", href: "/ops-pulse/cod/executive-reconciliation?client=amazon" },
      { code: "cod_submission", label: "COD Submission", href: "/ops-pulse/cod/submission?client=amazon" },
      { code: "cod_validation", label: "Validation", href: "/ops-pulse/cod/validation?client=amazon" },
      { code: "cod_reports", label: "Reports", href: "/ops-pulse/cod/reports?client=amazon" },
      { code: "cod_portal_checks", label: "SCC Portal Checks", href: "/ops-pulse/cod/portal-checks" }
    ]
  },
  {
    code: "cod",
    label: "Flipkart Operations",
    icon: "F",
    children: [
      { code: "daily_submission", label: "Daily Submission", href: "/ops-pulse/daily-submission?client=flipkart" },
      { code: "cod_submission", label: "COD Submission", href: "/ops-pulse/cod/submission?client=flipkart" },
      { code: "cod_validation", label: "Validation", href: "/ops-pulse/cod/validation?client=flipkart" },
      { code: "cod_reports", label: "Reports", href: "/ops-pulse/cod/reports?client=flipkart" }
    ]
  },
  {
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
  },
  {
    code: "master_data",
    label: "Master Data",
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
      { code: "users", label: "Users", href: "/users?section=users" },
      { code: "users", label: "Roles & Permissions", href: "/users?section=roles" }
    ]
  }
];

export function normalizeOpsClient(value: string | null | undefined): OpsClientCode | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "amazon" || normalized === "flipkart" ? normalized : null;
}
