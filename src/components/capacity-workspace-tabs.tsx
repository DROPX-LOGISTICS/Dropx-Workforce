"use client";

import { useSearchParams } from "next/navigation";
import { PendingLink } from "@/components/pending-link";

export function CapacityWorkspaceTabs({ active }: { active: "overview" | "associates" | "delivery" }) {
  const searchParams = useSearchParams();
  const selectedStations = searchParams.get("stations");
  const withScope = (path: string) => selectedStations ? `${path}?stations=${encodeURIComponent(selectedStations)}` : path;

  return <nav className="performance-tabs performance-workspace-tabs">
    <PendingLink className={active === "overview" ? "active" : ""} disableWhenCurrent href={withScope("/ops-pulse/capacity")}>Capacity overview</PendingLink>
    <PendingLink className={active === "associates" ? "active" : ""} disableWhenCurrent href={withScope("/ops-pulse/capacity/associates")}>Associate SPR</PendingLink>
    <PendingLink className={active === "delivery" ? "active" : ""} disableWhenCurrent href={withScope("/ops-pulse/performance/shipments")}>Delivery data</PendingLink>
  </nav>;
}
