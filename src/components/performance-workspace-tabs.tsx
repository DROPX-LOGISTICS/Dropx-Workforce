import Link from "next/link";

export function PerformanceWorkspaceTabs({ active }: { active: "daily" | "sls" | "delivery" | "onboarding" }) {
  return <nav className="performance-tabs performance-workspace-tabs">
    <Link className={active === "daily" ? "active" : ""} href="/performance?view=daily">Daily EDSP</Link>
    <Link className={active === "sls" ? "active" : ""} href="/performance?view=sls">Amazon SLS</Link>
    <Link className={active === "delivery" ? "active" : ""} href="/performance/shipments">Delivery Data</Link>
    <Link className={active === "onboarding" ? "active" : ""} href="/performance/onboarding">DA Onboarding</Link>
  </nav>;
}
