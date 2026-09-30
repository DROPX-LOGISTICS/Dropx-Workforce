import type { PartnerOnboardingState } from "@/lib/partner-onboarding";
import type { LifecycleReadiness } from "@/lib/workforce-workbench";

export const clientIdLanes = ["all", "trigger", "progress", "bgc", "mapping", "blocked"] as const;
export type ClientIdLane = (typeof clientIdLanes)[number];
export type ClientIdBucket = Exclude<ClientIdLane, "all">;

const insufficiencyPattern = /\b(idfy|insufficien(?:cy|t)?|unable to verify|verification mismatch)\b/i;
const triggerStages = new Set(["id_creation_pending", "partner_setup_pending", "invitation_failed"]);

/**
 * Places one approved associate in exactly one operational queue.
 * This is provider-neutral; Amazon is only one configured adapter.
 */
export function clientIdBucket(
  partner: PartnerOnboardingState | undefined,
  readiness: Pick<LifecycleReadiness, "phase"> | undefined,
): ClientIdBucket {
  if (readiness?.phase === "mapping" || partner?.stage === "mapping_pending") return "mapping";

  const sourceEvidence = `${partner?.action_item ?? ""} ${partner?.label ?? ""} ${partner?.instruction ?? ""}`;
  if (insufficiencyPattern.test(sourceEvidence)) return "bgc";

  if (partner?.can_trigger || triggerStages.has(partner?.stage ?? "")) return "trigger";
  if (partner?.stage === "exception") return "blocked";
  return "progress";
}

export function isClientIdReadiness(readiness: Pick<LifecycleReadiness, "phase"> | undefined) {
  return Boolean(readiness && ["partner", "activation", "mapping"].includes(readiness.phase));
}

