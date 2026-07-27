"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type CapacityAiFact = {
  stationCode: string;
  systemIds: number;
  regularIds: number | null;
  adHocIds: number | null;
  averageDelivered: number;
  averageInbound: number;
  spr: number;
  targetSpr: number | null;
  maxSafeSpr: number | null;
  requiredIds: number | null;
  gap: number | null;
  status: string;
  matchedDays?: number;
  baselineDays?: number;
  peakFlex?: number;
  confidence?: string;
  sustainedShortage?: boolean;
};

const CapacityActionContext = createContext<Record<string, string>>({});

export function CapacityAiActionProvider({
  children,
  defaults,
  facts
}: {
  children: React.ReactNode;
  defaults: Record<string, string>;
  facts: CapacityAiFact[];
}) {
  const [actions, setActions] = useState(defaults);
  const body = useMemo(() => JSON.stringify({ facts, defaults }), [defaults, facts]);

  useEffect(() => {
    if (!facts.length) return;
    const controller = new AbortController();
    fetch("/api/ops-pulse/capacity/actions", {
      body,
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: controller.signal
    }).then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (payload?.actions) setActions((current) => ({ ...current, ...payload.actions }));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [body, facts.length]);

  return <CapacityActionContext.Provider value={actions}>{children}</CapacityActionContext.Provider>;
}

export function CapacityAiAction({ stationCode }: { stationCode: string }) {
  const actions = useContext(CapacityActionContext);
  const action = actions[stationCode] || "Awaiting sufficient capacity data.";
  return <span className="capacity-ai-action" title={action}>{action}</span>;
}
