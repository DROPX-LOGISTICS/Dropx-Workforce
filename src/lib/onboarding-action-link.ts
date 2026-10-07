export type OnboardingActionKind = "amazon" | "idfy";

const trimTrailingPunctuation = (value: string) => value.replace(/[\]\)}>.,;:!?]+$/g, "");

export function onboardingAction(value: unknown): { kind: OnboardingActionKind; url: string } | null {
  const cleaned = trimTrailingPunctuation(String(value ?? "").trim());
  if (!cleaned) return null;
  try {
    const url = new URL(cleaned);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (host === "logistics.amazon.in" && url.pathname.startsWith("/account-management/invitation")) {
      return { kind: "amazon", url: url.toString() };
    }
    if (host === "idfy.com" || host.endsWith(".idfy.com")) {
      return { kind: "idfy", url: url.toString() };
    }
    return null;
  } catch {
    return null;
  }
}

export function firstOnboardingActionLink(raw: string) {
  const links = raw.replaceAll("&amp;", "&").match(/https:\/\/[^\s<>"']+/gi) ?? [];
  for (const link of links) {
    const action = onboardingAction(link);
    if (action) return action.url.slice(0, 2000);
  }
  return "";
}
