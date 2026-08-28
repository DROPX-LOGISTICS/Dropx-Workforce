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

export type NonEmployeeRoute =
  | "/field-executive"
  | "/delivery-network/onboarding"
  | "/delivery-network/onboarding/associates"
  | "/delivery-network/onboarding/operations"
  | "/delivery-network/contractor-profiles"
  | "/delivery-network/workforce-profiles"
  | "/contractors"
  | "/vendors"
  | "/workers";

type NonEmployeeConfig = {
  category: "workforce" | "field_executive" | "contractor" | "vendor" | "worker";
  designationCategory: "field_executives" | "contractors" | "vendors" | "workers";
  label: string;
  pageCode: "delivery_associates" | "contractors" | "vendors" | "workers";
  profileType: NonEmployeeProfileType;
  route: NonEmployeeRoute;
  table: "workforce" | "field_executives" | "contractors" | "vendors" | "workers";
};

export const nonEmployeeProfileConfigs: Record<NonEmployeeProfileType, NonEmployeeConfig> = {
  workforce: {
    category: "workforce",
    designationCategory: "contractors",
    label: "Workforce associate",
    pageCode: "delivery_associates",
    profileType: "workforce",
    route: "/delivery-network/workforce-profiles",
    table: "workforce"
  },
  field_executive: {
    category: "field_executive",
    designationCategory: "field_executives",
    label: "Workforce applicant",
    pageCode: "delivery_associates",
    profileType: "field_executive",
    route: "/field-executive",
    table: "field_executives"
  },
  contractor: {
    category: "contractor",
    designationCategory: "contractors",
    label: "Independent contractor",
    pageCode: "contractors",
    profileType: "contractor",
    route: "/contractors",
    table: "contractors"
  },
  vendor: {
    category: "vendor",
    designationCategory: "vendors",
    label: "Vendor",
    pageCode: "vendors",
    profileType: "vendor",
    route: "/vendors",
    table: "vendors"
  },
  worker: {
    category: "worker",
    designationCategory: "workers",
    label: "Worker",
    pageCode: "workers",
    profileType: "worker",
    route: "/workers",
    table: "workers"
  }
};

export function isWorkforceProfileType(value: unknown): value is WorkforceProfileType {
  return workforceProfileTypes.includes(String(value) as WorkforceProfileType);
}

export function isNonEmployeeProfileType(value: unknown): value is NonEmployeeProfileType {
  return isWorkforceProfileType(value) && value !== "employee";
}

export function nonEmployeeConfigForProfileType(value: unknown) {
  return isNonEmployeeProfileType(value) ? nonEmployeeProfileConfigs[value] : null;
}

export function nonEmployeeConfigForRoute(value: unknown) {
  const route = String(value ?? "") as NonEmployeeRoute;
  if (route === "/delivery-network/onboarding") {
    return { ...nonEmployeeProfileConfigs.field_executive, route };
  }
  if (route === "/delivery-network/contractor-profiles") {
    return {
      ...nonEmployeeProfileConfigs.workforce,
      route
    };
  }
  if (route === "/delivery-network/workforce-profiles") {
    return nonEmployeeProfileConfigs.workforce;
  }
  if (route === "/delivery-network/onboarding/associates") {
    return {
      ...nonEmployeeProfileConfigs.workforce,
      route
    };
  }
  if (route === "/delivery-network/onboarding/operations") {
    return {
      ...nonEmployeeProfileConfigs.vendor,
      label: "Operations partner",
      pageCode: "delivery_associates" as const,
      route
    };
  }
  return Object.values(nonEmployeeProfileConfigs).find((config) => config.route === route) ??
    nonEmployeeProfileConfigs.field_executive;
}

export function workforceTable(profileType: WorkforceProfileType) {
  return profileType === "employee"
    ? "employees" as const
    : nonEmployeeProfileConfigs[profileType].table;
}

export function workforceLabel(profileType: NonEmployeeProfileType) {
  return nonEmployeeProfileConfigs[profileType].label;
}
