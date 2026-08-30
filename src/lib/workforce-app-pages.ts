export const workforceAppPageOptions = [
  { value: "dashboard", label: "Home" },
  { value: "payments", label: "Payments" },
  { value: "advances", label: "Advances" },
  { value: "attendance", label: "Attendance" },
  { value: "roster", label: "Roster" },
  { value: "performance", label: "Performance" }
] as const;

export const defaultWorkforceAppPageAccess = ["dashboard", "payments", "advances"];

const workforceAppPageCodes = new Set<string>(workforceAppPageOptions.map((page) => page.value));

export function normalizeWorkforceAppPageAccess(values: Iterable<unknown>) {
  return Array.from(new Set(
    Array.from(values)
      .map((value) => String(value ?? "").trim().toLowerCase())
      .filter((value) => workforceAppPageCodes.has(value))
  ));
}
