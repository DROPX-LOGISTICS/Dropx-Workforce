export function normalizeFieldExecutiveVehicleType(
  value: FormDataEntryValue | string | null | undefined,
  designationCode: string | null | undefined
) {
  const code = String(designationCode ?? "").trim().toUpperCase();
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!["DA", "PTDA"].includes(code)) return null;
  if (!["bike", "van"].includes(normalized)) {
    throw new Error("Vehicle type is required for DA and PTDA. Choose Bike or Van.");
  }
  return normalized;
}
