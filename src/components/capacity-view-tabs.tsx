"use client";

import { useSearchParams } from "next/navigation";
import { PendingLink } from "@/components/pending-link";

export function CapacityViewTabs({ active }: { active: "operations" | "hiring" }) {
  const searchParams = useSearchParams();
  const stations = searchParams.get("stations");
  const withScope = (path: string) => stations ? `${path}?stations=${encodeURIComponent(stations)}` : path;

  return <nav className="capacity-view-tabs" aria-label="Capacity overview type">
    <PendingLink className={active === "operations" ? "active" : ""} disableWhenCurrent href={withScope("/ops-pulse/capacity")}>
      Operational view
    </PendingLink>
    <PendingLink className={active === "hiring" ? "active" : ""} disableWhenCurrent href={withScope("/ops-pulse/capacity/hiring")}>
      Hiring review
    </PendingLink>
  </nav>;
}
