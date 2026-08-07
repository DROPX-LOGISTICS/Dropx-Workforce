import type { AuthorizationContext } from "@/lib/authorization";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type CodAuditRow = {
  id: string;
  business_date: string;
  station_code: string;
  provider_employee_id: string | null;
  associate_name: string | null;
  action: string;
  changed_fields: string[];
  actor_name: string | null;
  actor_email: string | null;
  actor_role: string | null;
  created_at: string;
};

export function canAccessCodAudit(authorization: AuthorizationContext) {
  const role = `${authorization.roleCode ?? ""} ${authorization.roleName ?? ""}`.toLowerCase();
  return authorization.isMasterOwner || authorization.isMasterCompany ||
    role.includes("manager") || role.includes("admin") || role.includes("owner");
}

function changedFields(before: Record<string, unknown>, after: Record<string, unknown>) {
  return Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
    .filter((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null));
}

export async function writeCodAudit({
  action,
  after = {},
  authorization,
  before = {},
  businessDate,
  closureId = null,
  locationId,
  providerEmployeeId = null,
  reconciliationId = null,
  associateName = null,
  stationCode
}: {
  action: string;
  after?: Record<string, unknown>;
  authorization: AuthorizationContext;
  before?: Record<string, unknown>;
  businessDate: string;
  closureId?: string | null;
  locationId: string;
  providerEmployeeId?: string | null;
  reconciliationId?: string | null;
  associateName?: string | null;
  stationCode: string;
}) {
  if (!supabaseAdmin) return;
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin.from("cod_reconciliation_audit_log").insert({
    id: crypto.randomUUID(),
    company_id: authorization.companyId,
    business_date: businessDate,
    location_id: locationId,
    station_code: stationCode,
    reconciliation_id: reconciliationId,
    closure_id: closureId,
    provider_employee_id: providerEmployeeId,
    associate_name: associateName,
    action,
    before_data: before ?? {},
    after_data: after ?? {},
    changed_fields: changedFields(before, after),
    actor_user_id: authorization.userId,
    actor_name: authorization.fullName,
    actor_email: authorization.email,
    actor_role: authorization.roleName ?? authorization.roleCode,
    created_at: now
  });
  if (error) throw new Error(`COD action completed, but audit logging failed: ${error.message}`);
}

export async function loadCodAuditRows(
  companyId: string,
  locationIds: string[],
  businessDate: string,
  locationId?: string
) {
  if (!supabaseAdmin || !locationIds.length) return [] as CodAuditRow[];
  let query = supabaseAdmin
    .from("cod_reconciliation_audit_log")
    .select("id, business_date, station_code, provider_employee_id, associate_name, action, changed_fields, actor_name, actor_email, actor_role, created_at")
    .eq("company_id", companyId)
    .eq("business_date", businessDate)
    .in("location_id", locationIds)
    .order("created_at", { ascending: false })
    .limit(250);
  if (locationId) query = query.eq("location_id", locationId);
  const { data, error } = await query;
  if (error) return [] as CodAuditRow[];
  return (data ?? []) as CodAuditRow[];
}
