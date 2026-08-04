export const designationPortalOptions = [
  { code: "dashboard", label: "Dashboard" },
  { code: "hrms", label: "HRMS" },
  { code: "ops", label: "OPS" },
  { code: "recruitment", label: "Recruitment" }
] as const;

export type DesignationPortalCode = typeof designationPortalOptions[number]["code"];
export type DesignationPortalAction = "add" | "view" | "edit";
export type DesignationPortalPermission = Record<DesignationPortalAction, boolean>;
export type DesignationPortalPermissions = Record<DesignationPortalCode, DesignationPortalPermission>;

export const defaultDesignationPortalPermissions: DesignationPortalPermissions = {
  dashboard: { add: true, view: true, edit: true },
  hrms: { add: false, view: false, edit: false },
  ops: { add: false, view: false, edit: false },
  recruitment: { add: false, view: false, edit: false }
};

export type DesignationPortalAccess = {
  portal_permissions?: unknown;
};

export type DesignationPortalAccessOptions = {
  isOwner?: boolean;
};

export function normalizeDesignationPortalPermissions(value: unknown): DesignationPortalPermissions {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = null;
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return structuredClone(defaultDesignationPortalPermissions);
  }

  const source = parsed as Record<string, unknown>;
  return Object.fromEntries(designationPortalOptions.map(({ code }) => {
    const portal = source[code];
    const permissions = portal && typeof portal === "object" && !Array.isArray(portal)
      ? portal as Record<string, unknown>
      : {};
    const fallback = defaultDesignationPortalPermissions[code];
    const edit = typeof permissions.edit === "boolean" ? permissions.edit : fallback.edit;
    return [code, {
      add: typeof permissions.add === "boolean" ? permissions.add : fallback.add,
      view: (typeof permissions.view === "boolean" ? permissions.view : fallback.view) || edit,
      edit
    }];
  })) as DesignationPortalPermissions;
}

export function canAccessDesignationPortal(
  designation: DesignationPortalAccess | null | undefined,
  portal: DesignationPortalCode,
  action: DesignationPortalAction,
  options?: DesignationPortalAccessOptions
) {
  if (options?.isOwner) return true;
  return normalizeDesignationPortalPermissions(designation?.portal_permissions)[portal][action];
}

export function requireDesignationPortalAccess(
  designation: DesignationPortalAccess | null | undefined,
  portal: DesignationPortalCode,
  action: DesignationPortalAction,
  options?: DesignationPortalAccessOptions
) {
  if (!canAccessDesignationPortal(designation, portal, action, options)) {
    throw new Error(`This designation does not allow ${action} access from ${designationPortalOptions.find((item) => item.code === portal)?.label ?? portal}.`);
  }
}
