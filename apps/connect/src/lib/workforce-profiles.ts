export const workforceProfileTypes = [
  "employee",
  "field_executive",
  "contractor",
  "vendor",
  "worker"
] as const;

export type WorkforceProfileType = typeof workforceProfileTypes[number];
export type NonEmployeeProfileType = Exclude<WorkforceProfileType, "employee">;

const tables: Record<NonEmployeeProfileType, "field_executives" | "contractors" | "vendors" | "workers"> = {
  field_executive: "field_executives",
  contractor: "contractors",
  vendor: "vendors",
  worker: "workers"
};

export function isWorkforceProfileType(value: unknown): value is WorkforceProfileType {
  return workforceProfileTypes.includes(String(value) as WorkforceProfileType);
}

export function isNonEmployeeProfileType(value: unknown): value is NonEmployeeProfileType {
  return isWorkforceProfileType(value) && value !== "employee";
}

export function workforceTable(profileType: WorkforceProfileType) {
  return profileType === "employee" ? "employees" as const : tables[profileType];
}

export function workforceLabel(profileType: NonEmployeeProfileType) {
  if (profileType === "contractor") return "Independent contractor";
  if (profileType === "vendor") return "Vendor";
  if (profileType === "worker") return "Worker";
  return "Field executive";
}
