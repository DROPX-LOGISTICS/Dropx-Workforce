import Link from "next/link";

export function CapacityWorkspaceTabs({ active }: { active: "overview" | "delivery" }) {
  return <nav className="performance-tabs performance-workspace-tabs">
    <Link className={active === "overview" ? "active" : ""} href="/capacity">Workforce Capacity</Link>
    <Link className={active === "delivery" ? "active" : ""} href="/performance/shipments">Delivery Data</Link>
  </nav>;
}
