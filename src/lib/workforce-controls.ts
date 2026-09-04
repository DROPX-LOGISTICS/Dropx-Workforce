import type { AuthorizationContext } from "@/lib/authorization";

export function assertWorkforceLocationAccess(
  authorization: Pick<AuthorizationContext, "hasAllLocationAccess" | "locationScopeIds">,
  ...locationIds: Array<string | null | undefined>
) {
  if (authorization.hasAllLocationAccess) return;
  if (locationIds.some((id) => !id || !authorization.locationScopeIds.includes(id))) {
    throw new Error("This record or its destination is outside your station access.");
  }
}

export function isFieldActive(profile: { is_active?: boolean | null; onboarding_status?: string | null; lifecycle_status?: string | null }) {
  return Boolean(profile.is_active) && profile.onboarding_status?.toLowerCase() === "active"
    && (!profile.lifecycle_status || ["active", "onboarding"].includes(profile.lifecycle_status.toLowerCase()));
}

export function isRetiredWorkforceTable(error: { code?: string; message?: string } | null, table: string) {
  if (!["field_executives", "workers"].includes(table)) return false;
  return (error?.code === "PGRST205" && Boolean(error.message?.includes(`'public.${table}'`)))
    || (error?.code === "42P01" && Boolean(error.message?.includes(`relation "public.${table}" does not exist`)));
}

export function providerClearanceStatus(value: unknown): "pending" | "cleared" {
  const status = String(value ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
  return ["clear", "cleared", "complete", "completed", "done", "active"].includes(status) ? "cleared" : "pending";
}

export function canonicalAttendanceIdentity(
  row: { profile_type: string | null; account_id: string | null; field_executive_id?: string | null; contractor_id?: string | null },
  identities: Map<string, string>
) {
  if (row.profile_type === "employee") return null;
  const type = row.profile_type || (row.field_executive_id ? "field_executive" : row.contractor_id ? "contractor" : "");
  const id = row.account_id || row.field_executive_id || row.contractor_id;
  return id ? identities.get(`${type}:${id}`) ?? null : null;
}
