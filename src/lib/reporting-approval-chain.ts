import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type ReportingApprovalStep = {
  step_name: string;
  approver_user_id: string;
  approver_person_id: string;
};

function db() {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  return supabaseAdmin;
}

function indiaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

async function managerMayApprove(companyId: string, userId: string, requestLocationId: string | null) {
  const today = indiaToday();
  const grantsResult = await db().from("hr_access_grants")
    .select("role_id,scope_type,scope_id")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .lte("effective_from", today)
    .or(`effective_to.is.null,effective_to.gte.${today}`);
  if (grantsResult.error) throw new Error(grantsResult.error.message);
  const grants = grantsResult.data ?? [];
  if (!grants.length) return false;
  const permissionsResult = await db().from("hr_role_page_permissions")
    .select("role_id,can_approve,hr_permission_pages!inner(code,is_active)")
    .eq("company_id", companyId)
    .in("role_id", [...new Set(grants.map((grant) => grant.role_id))])
    .eq("can_approve", true)
    .eq("hr_permission_pages.code", "approvals")
    .eq("hr_permission_pages.is_active", true);
  if (permissionsResult.error) throw new Error(permissionsResult.error.message);
  const permittedRoleIds = new Set((permissionsResult.data ?? []).map((row) => row.role_id));
  return grants.some((grant) => permittedRoleIds.has(grant.role_id) && (
    grant.scope_type === "company"
    || grant.scope_type === "direct_reports"
    || grant.scope_type === "reporting_subtree"
    || (grant.scope_type === "location" && grant.scope_id === requestLocationId)
  ));
}

export async function resolveReportingApprovalSteps(input: {
  companyId: string;
  profileId: string;
  profileType: "employee" | "contractor";
  managerLevels: number;
}) {
  const today = indiaToday();
  const workerColumn = input.profileType === "employee" ? "employee_id" : "contractor_id";
  const engagementResult = await db().from("hr_engagements")
    .select("id,person_id,status")
    .eq("company_id", input.companyId)
    .eq("worker_type", input.profileType)
    .eq(workerColumn, input.profileId)
    .eq("status", "active")
    .maybeSingle();
  if (engagementResult.error || !engagementResult.data) {
    throw new Error(engagementResult.error?.message ?? "The workforce profile does not have an active People engagement.");
  }

  const assignmentResult = await db().from("hr_work_assignments")
    .select("id,location_id,is_top_level,effective_from,effective_to")
    .eq("company_id", input.companyId)
    .eq("engagement_id", engagementResult.data.id)
    .eq("is_primary", true)
    .lte("effective_from", today)
    .or(`effective_to.is.null,effective_to.gte.${today}`)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (assignmentResult.error || !assignmentResult.data) {
    throw new Error(assignmentResult.error?.message ?? "The workforce profile does not have an active People assignment.");
  }
  if (assignmentResult.data.is_top_level) {
    throw new Error("A top-level regularization exception approver must be configured before submitting this request.");
  }

  const levels = Math.max(1, Math.min(5, Math.trunc(input.managerLevels)));
  const steps: ReportingApprovalStep[] = [];
  const seenPeople = new Set<string>([engagementResult.data.person_id]);
  let subjectAssignmentId = assignmentResult.data.id;
  for (let level = 1; level <= levels; level += 1) {
    const relationshipResult = await db().from("hr_reporting_relationships")
      .select("manager_assignment_id")
      .eq("company_id", input.companyId)
      .eq("subject_assignment_id", subjectAssignmentId)
      .eq("relationship_type", "solid_line")
      .eq("is_primary", true)
      .lte("effective_from", today)
      .or(`effective_to.is.null,effective_to.gte.${today}`)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (relationshipResult.error || !relationshipResult.data) {
      throw new Error(`Reporting manager level ${level} is not configured in People Tree.`);
    }
    const managerAssignmentResult = await db().from("hr_work_assignments")
      .select("id,engagement_id,position_title,effective_from,effective_to")
      .eq("company_id", input.companyId)
      .eq("id", relationshipResult.data.manager_assignment_id)
      .maybeSingle();
    const managerAssignment = managerAssignmentResult.data;
    if (managerAssignmentResult.error || !managerAssignment
      || managerAssignment.effective_from > today
      || (managerAssignment.effective_to && managerAssignment.effective_to < today)) {
      throw new Error(`Reporting manager level ${level} does not have an active assignment.`);
    }
    const managerEngagementResult = await db().from("hr_engagements")
      .select("person_id,status")
      .eq("company_id", input.companyId)
      .eq("id", managerAssignment.engagement_id)
      .maybeSingle();
    const managerEngagement = managerEngagementResult.data;
    if (managerEngagementResult.error || !managerEngagement || managerEngagement.status !== "active") {
      throw new Error(`Reporting manager level ${level} does not have an active engagement.`);
    }
    if (seenPeople.has(managerEngagement.person_id)) {
      throw new Error("The People Tree contains a reporting cycle and cannot route this request.");
    }
    seenPeople.add(managerEngagement.person_id);
    const [personResult, linkResult] = await Promise.all([
      db().from("hr_people").select("display_name").eq("company_id", input.companyId).eq("id", managerEngagement.person_id).maybeSingle(),
      db().from("hr_user_person_links").select("user_id,status").eq("company_id", input.companyId).eq("person_id", managerEngagement.person_id).maybeSingle()
    ]);
    if (personResult.error || linkResult.error) throw new Error(personResult.error?.message ?? linkResult.error?.message ?? "Manager account lookup failed.");
    const managerName = personResult.data?.display_name ?? `Manager level ${level}`;
    if (!linkResult.data || linkResult.data.status !== "active") {
      throw new Error(`${managerName} does not have a linked active People login.`);
    }
    if (!await managerMayApprove(input.companyId, linkResult.data.user_id, assignmentResult.data.location_id)) {
      throw new Error(`${managerName} needs Approval Inbox approval access for this reporting scope.`);
    }
    steps.push({
      step_name: `${managerAssignment.position_title} approval`,
      approver_user_id: linkResult.data.user_id,
      approver_person_id: managerEngagement.person_id
    });
    subjectAssignmentId = managerAssignment.id;
  }
  return steps;
}
