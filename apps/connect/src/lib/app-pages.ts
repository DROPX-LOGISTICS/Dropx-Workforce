import type { WorkforceProfileType } from "./workforce-profiles";

export const employeeDefaultPageAccess = ["dashboard", "attendance", "leave"];
export const workforceDefaultPageAccess = ["dashboard", "payments", "advances"];

const employeePages = new Set(["dashboard", "attendance", "leave"]);
const workforcePages = new Set(["dashboard", "payments", "advances", "attendance", "roster", "performance"]);

export function defaultPageAccess(profileType: WorkforceProfileType | "user") {
  return profileType === "employee" ? employeeDefaultPageAccess : workforceDefaultPageAccess;
}

export function normalizeAppPageAccess(profileType: WorkforceProfileType | "user", pages: Iterable<unknown>) {
  const allowed = profileType === "employee" ? employeePages : workforcePages;
  return Array.from(new Set(
    Array.from(pages)
      .map((page) => String(page ?? "").trim().toLowerCase())
      .filter((page) => allowed.has(page))
  ));
}
