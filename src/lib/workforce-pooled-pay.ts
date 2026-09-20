/** Read-only scheme preview. Deliberately not wired to payroll accrual or payment writes. */
export type PooledPayTerms = {
  mode: "guarantee_plus_excess" | "pooled_floor";
  dailyGuarantee: number;
  packagesPerDay: number;
  packageRate: number;
  fuelPerKm: number;
};
export type PooledPayDay = { date: string; packages: number; verifiedKm: number };
export type PooledPayInput = {
  from: string; to: string; asOf: string; complete: boolean;
  terms: PooledPayTerms; days: readonly PooledPayDay[];
};

const dayMs = 86_400_000;
function date(value: string) {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed)
    || new Date(parsed).toISOString().slice(0, 10) !== value) throw new Error("Use valid calendar dates.");
  return parsed;
}
function quantity(value: number, label: string, max: number, scale = 1) {
  if (!Number.isFinite(value) || value < 0 || value > max
    || Math.abs(value * scale - Math.round(value * scale)) > 0.000001) {
    throw new Error(`${label} must be between 0 and ${max}${scale === 1 ? " in whole units" : " with at most two decimals"}.`);
  }
  return Math.round(value * scale);
}
const rupees = (paise: number) => paise / 100;

export function previewPooledPay(input: PooledPayInput) {
  const start = date(input.from), end = date(input.to), at = date(input.asOf);
  const calendarDays = (end - start) / dayMs + 1;
  if (calendarDays < 1 || calendarDays > 93) throw new Error("Choose an inclusive window of 1 to 93 days.");
  if (!["guarantee_plus_excess", "pooled_floor"].includes(input.terms.mode)) throw new Error("Choose a supported formula.");
  const guarantee = quantity(input.terms.dailyGuarantee, "Daily guarantee", 1_000_000, 100);
  const threshold = quantity(input.terms.packagesPerDay, "Package threshold", 100_000);
  const rate = quantity(input.terms.packageRate, "Package rate", 1_000_000, 100);
  const fuelRate = quantity(input.terms.fuelPerKm, "Fuel per km", 1_000_000, 100);
  if (guarantee <= 0) throw new Error("Enter a positive daily guarantee.");
  if (typeof input.complete !== "boolean") throw new Error("Confirm whether all qualifying days are included.");
  if (input.days.length > calendarDays) throw new Error("Use only one combined row per qualifying day.");
  const seen = new Set<string>();
  let packages = 0, kmHundredths = 0, fuelPaise = 0, dailyComparisonPaise = 0;
  const days = [...input.days].sort((a, b) => a.date.localeCompare(b.date)).map((row) => {
    const atDay = date(row.date);
    if (atDay < start || atDay > end) throw new Error("Every qualifying day must be inside the scheme window.");
    if (atDay > at) throw new Error("Future work cannot be counted as earned pay.");
    if (seen.has(row.date)) throw new Error("Combine all provider IDs for the same day into one row; duplicate dates are not allowed.");
    seen.add(row.date);
    const count = quantity(row.packages, "Delivered packages", 100_000);
    const distance = quantity(row.verifiedKm, "Verified km", 10_000, 100);
    const fuel = Math.round(distance * fuelRate / 100);
    packages += count; kmHundredths += distance; fuelPaise += fuel;
    dailyComparisonPaise += input.terms.mode === "guarantee_plus_excess"
      ? guarantee + Math.max(0, count - threshold) * rate : Math.max(guarantee, count * rate);
    return { ...row, guaranteedAmount: rupees(guarantee), fuelAmount: rupees(fuel) };
  });
  const workDays = days.length;
  const guaranteedPaise = guarantee * workDays;
  const packageAllowance = threshold * workDays;
  const excessPackages = Math.max(0, packages - packageAllowance);
  const variablePaise = packages * rate;
  const supplementPaise = input.terms.mode === "guarantee_plus_excess"
    ? excessPackages * rate : Math.max(0, variablePaise - guaranteedPaise);
  const totalPaise = guaranteedPaise + supplementPaise + fuelPaise;
  if (![totalPaise, dailyComparisonPaise].every(Number.isSafeInteger)) throw new Error("The calculated amount exceeds the supported safe range.");
  const incompleteReasons: string[] = [];
  if (at <= end) incompleteReasons.push("The window is still open; the last day must finish before final settlement.");
  if (!input.complete) incompleteReasons.push("All qualifying workdays and verified distances have not been confirmed.");
  return {
    formulaVersion: "pooled-pay-preview-v1" as const,
    from: input.from, to: input.to, calendarDays, workDays, packages, days,
    averagePackages: workDays ? packages / workDays : 0,
    packageAllowance, excessPackages, verifiedKm: kmHundredths / 100,
    guaranteedAmount: rupees(guaranteedPaise), variableAmount: rupees(variablePaise),
    supplementAmount: rupees(supplementPaise), fuelAmount: rupees(fuelPaise), totalAmount: rupees(totalPaise),
    dailyComparisonAmount: rupees(dailyComparisonPaise + fuelPaise),
    comparisonDifference: rupees(dailyComparisonPaise - guaranteedPaise - supplementPaise),
    windowComplete: incompleteReasons.length === 0, incompleteReasons,
    // A complete mathematical preview is never a payroll instruction or approval.
    payrollEnabled: false as const
  };
}
