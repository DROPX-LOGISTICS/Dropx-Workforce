export const fieldExecutiveVehicleTypes = [
  { value: "bike", label: "Bike" },
  { value: "van", label: "Van" }
] as const;

export function designationRequiresVehicleType(code: string | null | undefined) {
  return ["DA", "PTDA"].includes(String(code ?? "").trim().toUpperCase());
}

export function normalizeFieldExecutiveVehicleType(
  value: FormDataEntryValue | string | null | undefined,
  designationCode: string | null | undefined
) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!designationRequiresVehicleType(designationCode)) return null;
  if (!fieldExecutiveVehicleTypes.some((option) => option.value === normalized)) {
    throw new Error("Vehicle type is required for DA and PTDA. Choose Bike or Van.");
  }
  return normalized;
}
