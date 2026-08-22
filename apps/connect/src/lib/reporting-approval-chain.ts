import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type ReportingApprovalStep = { step_name: string; approver_user_id: string; approver_person_id: string };
function db() { if (!supabaseAdmin) throw new Error("Database is unavailable."); return supabaseAdmin; }
function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }

async function managerMayApprove(companyId: string, userId: string, locationId: string | null) {
  const date = today();
  const grants = await db().from("hr_access_grants").select("role_id,scope_type,scope_id").eq("company_id", companyId).eq("user_id", userId).eq("is_active", true).lte("effective_from", date).or(`effective_to.is.null,effective_to.gte.${date}`);
  if (grants.error) throw new Error(grants.error.message);
  const roleIds = [...new Set((grants.data ?? []).map((row) => row.role_id))];
  if (!roleIds.length) return false;
  const permissions = await db().from("hr_role_page_permissions").select("role_id,hr_permission_pages!inner(code,is_active)").eq("company_id", companyId).in("role_id", roleIds).eq("can_approve", true).eq("hr_permission_pages.code", "approvals").eq("hr_permission_pages.is_active", true);
  if (permissions.error) throw new Error(permissions.error.message);
  const permitted = new Set((permissions.data ?? []).map((row) => row.role_id));
  return (grants.data ?? []).some((grant) => permitted.has(grant.role_id) && (["company","direct_reports","reporting_subtree"].includes(grant.scope_type) || (grant.scope_type === "location" && grant.scope_id === locationId)));
}

export async function resolveReportingApprovalSteps(input: { companyId: string; profileId: string; profileType: "employee" | "contractor"; managerLevels: number }) {
  const date = today(); const workerColumn = input.profileType === "employee" ? "employee_id" : "contractor_id";
  const engagement = await db().from("hr_engagements").select("id,person_id,status").eq("company_id", input.companyId).eq("worker_type", input.profileType).eq(workerColumn, input.profileId).eq("status", "active").maybeSingle();
  if (engagement.error || !engagement.data) throw new Error(engagement.error?.message ?? "The workforce profile does not have an active People engagement.");
  const assignment = await db().from("hr_work_assignments").select("id,location_id,is_top_level").eq("company_id", input.companyId).eq("engagement_id", engagement.data.id).eq("is_primary", true).lte("effective_from", date).or(`effective_to.is.null,effective_to.gte.${date}`).order("effective_from", { ascending: false }).limit(1).maybeSingle();
  if (assignment.error || !assignment.data) throw new Error(assignment.error?.message ?? "The workforce profile does not have an active People assignment.");
  if (assignment.data.is_top_level) throw new Error("A top-level exit approver must be configured before submitting this request.");
  const steps: ReportingApprovalStep[] = []; const seen = new Set([engagement.data.person_id]); let subjectAssignmentId = assignment.data.id;
  for (let level = 1; level <= Math.max(1, Math.min(4, Math.trunc(input.managerLevels))); level += 1) {
    const relation = await db().from("hr_reporting_relationships").select("manager_assignment_id").eq("company_id", input.companyId).eq("subject_assignment_id", subjectAssignmentId).eq("relationship_type", "solid_line").eq("is_primary", true).lte("effective_from", date).or(`effective_to.is.null,effective_to.gte.${date}`).order("effective_from", { ascending: false }).limit(1).maybeSingle();
    if (relation.error || !relation.data) throw new Error(`Reporting manager level ${level} is not configured in People Tree.`);
    const managerAssignment = await db().from("hr_work_assignments").select("id,engagement_id,position_title,effective_from,effective_to").eq("company_id", input.companyId).eq("id", relation.data.manager_assignment_id).maybeSingle();
    const manager = managerAssignment.data;
    if (managerAssignment.error || !manager || manager.effective_from > date || (manager.effective_to && manager.effective_to < date)) throw new Error(`Reporting manager level ${level} does not have an active assignment.`);
    const managerEngagement = await db().from("hr_engagements").select("person_id,status").eq("company_id", input.companyId).eq("id", manager.engagement_id).maybeSingle();
    if (managerEngagement.error || !managerEngagement.data || managerEngagement.data.status !== "active") throw new Error(`Reporting manager level ${level} does not have an active engagement.`);
    if (seen.has(managerEngagement.data.person_id)) throw new Error("The People Tree contains a reporting cycle and cannot route this request.");
    seen.add(managerEngagement.data.person_id);
    const [person, link] = await Promise.all([
      db().from("hr_people").select("display_name").eq("company_id", input.companyId).eq("id", managerEngagement.data.person_id).maybeSingle(),
      db().from("hr_user_person_links").select("user_id,status").eq("company_id", input.companyId).eq("person_id", managerEngagement.data.person_id).maybeSingle()
    ]);
    const managerName = person.data?.display_name ?? `Manager level ${level}`;
    if (person.error || link.error) throw new Error(person.error?.message ?? link.error?.message ?? "Manager account lookup failed.");
    if (!link.data || link.data.status !== "active") throw new Error(`${managerName} does not have a linked active People login.`);
    if (!await managerMayApprove(input.companyId, link.data.user_id, assignment.data.location_id)) throw new Error(`${managerName} needs Approval Inbox approval access for this reporting scope.`);
    steps.push({ step_name: `${manager.position_title} approval`, approver_user_id: link.data.user_id, approver_person_id: managerEngagement.data.person_id });
    subjectAssignmentId = manager.id;
  }
  return steps;
}
