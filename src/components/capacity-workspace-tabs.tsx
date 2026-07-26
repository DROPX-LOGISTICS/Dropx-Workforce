import Link from "next/link";

export function CapacityWorkspaceTabs({ active }: { active: "overview" | "associates" | "delivery" }) {
  return <nav className="performance-tabs performance-workspace-tabs">
    <Link className={active === "overview" ? "active" : ""} href="/ops-pulse/capacity">Capacity overview</Link>
    <Link className={active === "associates" ? "active" : ""} href="/ops-pulse/capacity/associates">Associate SPR</Link>
    <Link className={active === "delivery" ? "active" : ""} href="/ops-pulse/performance/shipments">Shipment volume</Link>
  </nav>;
}
