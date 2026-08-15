"use client";

import { useSearchParams } from "next/navigation";
import { PendingLink } from "@/components/pending-link";
import type { CapacityViewTab } from "@/lib/ops-pulse/capacity-access";

export function CapacityViewTabs({ active, allowed }: { active: CapacityViewTab; allowed: CapacityViewTab[] }) {
  const searchParams = useSearchParams();
  const stations = searchParams.get("stations");
  const withScope = (path: string) => stations ? `${path}?stations=${encodeURIComponent(stations)}` : path;

  return <nav className="capacity-view-tabs" aria-label="Capacity overview type">
    {allowed.includes("operations") ? <PendingLink className={active === "operations" ? "active" : ""} disableWhenCurrent href={withScope("/ops-pulse/capacity")}>
      Operational view
    </PendingLink> : null}
    {allowed.includes("hiring") ? <PendingLink className={active === "hiring" ? "active" : ""} disableWhenCurrent href={withScope("/ops-pulse/capacity/hiring")}>
      Hiring review
    </PendingLink> : null}
  </nav>;
}
