"use client";

import { createContext, useContext } from "react";

export type CapacityAiFact = {
  stationCode: string;
  systemIds: number;
  internalDAs: number | null;
  externalDAs: number | null;
  averageDelivered: number;
  averageInbound: number;
  spr: number;
  targetSpr: number | null;
  maxSafeSpr: number | null;
  requiredIds: number | null;
  gap: number | null;
  status: string;
  sourceDays?: number;
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
  // Capacity decisions remain deterministic and auditable. The interactive AI
  // explains these facts but never rewrites the operational action.
  void facts;
  return <CapacityActionContext.Provider value={defaults}>{children}</CapacityActionContext.Provider>;
}

export function CapacityAiAction({ stationCode }: { stationCode: string }) {
  const actions = useContext(CapacityActionContext);
  const action = actions[stationCode] || "Awaiting sufficient capacity data.";
  return <span className="capacity-ai-action" title={action}>{action}</span>;
}
