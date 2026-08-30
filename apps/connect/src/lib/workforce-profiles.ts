export const workforceProfileTypes = [
  "employee",
  "workforce",
  "field_executive",
  "contractor",
  "vendor",
  "worker"
] as const;

export type WorkforceProfileType = typeof workforceProfileTypes[number];
export type NonEmployeeProfileType = Exclude<WorkforceProfileType, "employee">;

const tables: Record<NonEmployeeProfileType, "workforce" | "field_executives" | "contractors" | "vendors" | "workers"> = {
  workforce: "workforce",
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
  if (profileType === "workforce") return "Workforce associate";
  if (profileType === "contractor") return "Workforce associate";
  if (profileType === "vendor") return "Vendor";
  if (profileType === "worker") return "Worker";
  return "Field executive";
}

export function profileFieldRuleCategory(profileType: NonEmployeeProfileType) {
  if (profileType === "workforce") {
    throw new Error("Canonical Workforce profiles must resolve registration policy from Designation Master.");
  }
  if (profileType === "contractor") return "contractors" as const;
  if (profileType === "vendor") return "vendors" as const;
  if (profileType === "worker") return "workers" as const;
  return "field_executives" as const;
}
