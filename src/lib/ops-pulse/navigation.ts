import type { NavItem } from "@/lib/app-navigation";

export type OpsClientCode = "amazon" | "flipkart";

export const opsNavItems: NavItem[] = [
  { code: "ops_pulse", label: "Overview", href: "/ops-pulse", icon: "O" },
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
  }
];

export function normalizeOpsClient(value: string | null | undefined): OpsClientCode | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "amazon" || normalized === "flipkart" ? normalized : null;
}
