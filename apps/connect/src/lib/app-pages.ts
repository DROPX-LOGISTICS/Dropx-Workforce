import type { WorkforceProfileType } from "./workforce-profiles";

export const employeeDefaultPageAccess = ["dashboard", "attendance", "leave"];
// Workforce is an operating workspace, not an HR subset. Designations may add
// access, but must not remove the associate's core operating journey.
export const workforceDefaultPageAccess = ["dashboard", "payments", "advances", "attendance", "roster", "performance", "reports", "rate_card", "connect", "documents", "leave"];

const employeePages = new Set(["dashboard", "attendance", "leave"]);
const workforcePages = new Set(["dashboard", "payments", "advances", "attendance", "roster", "performance", "reports", "rate_card", "connect", "documents", "leave"]);

export function defaultPageAccess(profileType: WorkforceProfileType | "user") {
  return profileType === "employee" || profileType === "user" ? employeeDefaultPageAccess : workforceDefaultPageAccess;
}

export function normalizeAppPageAccess(profileType: WorkforceProfileType | "user", pages: Iterable<unknown>) {
  const allowed = profileType === "employee" || profileType === "user" ? employeePages : workforcePages;
  return Array.from(new Set(
    Array.from(pages)
      .map((page) => String(page ?? "").trim().toLowerCase())
      .filter((page) => allowed.has(page))
  ));
}
