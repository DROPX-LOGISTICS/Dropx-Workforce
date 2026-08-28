import { NextRequest, NextResponse } from "next/server";
import { createAppNotification } from "@/lib/app-notifications";
import { resolveConnectWorkforceAccount } from "@/lib/connect-workforce-account";
import { resolveReportingApprovalSteps } from "@/lib/reporting-approval-chain";
import { supabaseAdmin } from "@/lib/supabase-admin";

function inclusiveDays(from: string, to: string) {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

function currentYearRange() {
  const year = Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Kolkata", year: "numeric" }).format(new Date()));
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

async function workerContext(companyId: string, profileType: "employee" | "contractor", profileId: string) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const workerColumn = profileType === "employee" ? "employee_id" : "contractor_id";
  const engagementResult = await supabaseAdmin.from("hr_engagements")
    .select("id")
    .eq("company_id", companyId)
    .eq("worker_type", profileType)
    .eq(workerColumn, profileId)
    .eq("status", "active")
    .maybeSingle();
  if (engagementResult.error || !engagementResult.data) {
    throw new Error(engagementResult.error?.message ?? "Active People engagement is missing.");
  }
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  const assignmentResult = await supabaseAdmin.from("hr_work_assignments")
    .select("business_line")
    .eq("company_id", companyId)
    .eq("engagement_id", engagementResult.data.id)
    .eq("is_primary", true)
    .lte("effective_from", today)
    .or(`effective_to.is.null,effective_to.gte.${today}`)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (assignmentResult.error || !assignmentResult.data) {
    throw new Error(assignmentResult.error?.message ?? "Active People work assignment is missing.");
  }
  return assignmentResult.data;
}

async function applicablePolicy(companyId: string, profileType: "employee" | "contractor", businessLine: string | null, days: number) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const result = await supabaseAdmin.from("hr_leave_approval_policies")
    .select("id,name,business_line,minimum_days,maximum_days,manager_levels,priority")
    .eq("company_id", companyId)
    .eq("worker_type", profileType)
    .eq("is_active", true)
    .lte("minimum_days", days)
    .order("priority", { ascending: true })
    .order("minimum_days", { ascending: false });
  if (result.error) throw new Error(result.error.message);
  const policy = (result.data ?? []).find((item) =>
    (item.business_line === null || item.business_line === businessLine)
    && (item.maximum_days === null || Number(item.maximum_days) >= days)
  );
  if (!policy) throw new Error("No active leave approval policy matches this request.");
  return policy;
}

function peopleLeaveIdentity(worker: Awaited<ReturnType<typeof resolveConnectWorkforceAccount>>) {
  if (worker.profileType === "employee" || worker.profileType === "contractor") {
    return { profileId: worker.profileId, profileType: worker.profileType } as const;
  }
  if (worker.profileType === "workforce" && worker.legacyPeopleProfileId && worker.legacyPeopleProfileType) {
    return { profileId: worker.legacyPeopleProfileId, profileType: worker.legacyPeopleProfileType } as const;
  }
  throw new Error("Time off requires an active People approval identity for this Workforce profile.");
}

export async function GET(request: NextRequest) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const worker = await resolveConnectWorkforceAccount({
      accountId: request.nextUrl.searchParams.get("accountId") ?? "",
      profileType: request.nextUrl.searchParams.get("profileType") ?? ""
    });
    const leaveIdentity = peopleLeaveIdentity(worker);
    const profileColumn = leaveIdentity.profileType === "employee" ? "employee_id" : "contractor_id";
    const range = currentYearRange();
    const [typesResult, requestsResult, approvedResult] = await Promise.all([
      supabaseAdmin.from("hr_leave_types")
        .select("id,name,code,annual_allowance,color")
        .eq("company_id", worker.companyId).eq("is_active", true).order("name"),
      supabaseAdmin.from("hr_leave_requests")
        .select("id,leave_type_id,start_date,end_date,days,reason,status,requested_at,reviewed_at,reviewer_note,hr_leave_types(name,code,color)")
        .eq("company_id", worker.companyId).eq(profileColumn, leaveIdentity.profileId)
        .order("requested_at", { ascending: false }).limit(100),
      supabaseAdmin.from("hr_leave_requests")
        .select("leave_type_id,days")
        .eq("company_id", worker.companyId).eq(profileColumn, leaveIdentity.profileId)
        .eq("status", "approved").gte("start_date", range.from).lte("start_date", range.to)
    ]);
    if (typesResult.error || requestsResult.error || approvedResult.error) {
      throw new Error(typesResult.error?.message ?? requestsResult.error?.message ?? approvedResult.error?.message ?? "Unable to load time off.");
    }
    const usedByType = new Map<string, number>();
    for (const item of approvedResult.data ?? []) usedByType.set(item.leave_type_id, (usedByType.get(item.leave_type_id) ?? 0) + Number(item.days ?? 0));
    const types = (typesResult.data ?? []).map((item) => ({ ...item, available: Math.max(0, Number(item.annual_allowance) - (usedByType.get(item.id) ?? 0)) }));
    const requestIds = (requestsResult.data ?? []).map((item) => item.id);
    const stepsResult = requestIds.length
      ? await supabaseAdmin.from("hr_leave_approval_steps")
        .select("request_id,step_order,step_name,status,decided_at")
        .eq("company_id", worker.companyId).in("request_id", requestIds).order("step_order")
      : { data: [], error: null };
    if (stepsResult.error) throw new Error(stepsResult.error.message);
    type ApprovalStep = NonNullable<typeof stepsResult.data>[number];
    const stepsByRequest = new Map<string, ApprovalStep[]>();
    for (const step of stepsResult.data ?? []) stepsByRequest.set(step.request_id, [...(stepsByRequest.get(step.request_id) ?? []), step]);
    const requests = (requestsResult.data ?? []).map((item) => ({ ...item, approvalSteps: stepsByRequest.get(item.id) ?? [] }));
    return NextResponse.json({
      types,
      requests,
      summary: {
        available: types.reduce((sum, item) => sum + item.available, 0),
        pending: requests.filter((item) => item.status === "pending").length
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load time off.";
    return NextResponse.json({ error: message }, { status: message.includes("Login") ? 401 : 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const body = await request.json();
    const worker = await resolveConnectWorkforceAccount({ accountId: String(body.accountId ?? ""), profileType: String(body.profileType ?? "") });
    const leaveIdentity = peopleLeaveIdentity(worker);
    const leaveTypeId = String(body.leaveTypeId ?? "").trim();
    const fromDate = String(body.fromDate ?? "").trim();
    const toDate = String(body.toDate ?? "").trim();
    const reason = String(body.reason ?? "").trim();
    if (!leaveTypeId) throw new Error("Select a leave type.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) throw new Error("Select a valid leave period.");
    const days = inclusiveDays(fromDate, toDate);
    if (days < 1 || days > 365) throw new Error("Select a valid leave period.");
    if (fromDate.slice(0, 4) !== toDate.slice(0, 4)) throw new Error("A leave request must stay within one calendar year.");
    if (reason.length < 3) throw new Error("Enter a leave reason.");
    const profileColumn = leaveIdentity.profileType === "employee" ? "employee_id" : "contractor_id";
    const leaveTypeResult = await supabaseAdmin.from("hr_leave_types")
      .select("id,name,code,annual_allowance")
      .eq("company_id", worker.companyId)
      .eq("id", leaveTypeId)
      .eq("is_active", true)
      .maybeSingle();
    if (leaveTypeResult.error || !leaveTypeResult.data) {
      throw new Error(leaveTypeResult.error?.message ?? "This leave type is inactive or unavailable.");
    }
    const year = fromDate.slice(0, 4);
    const existingResult = await supabaseAdmin.from("hr_leave_requests")
      .select("id,start_date,end_date,days,status,leave_type_id")
      .eq("company_id", worker.companyId)
      .eq(profileColumn, leaveIdentity.profileId)
      .in("status", ["pending", "approved"])
      .lte("start_date", `${year}-12-31`)
      .gte("end_date", `${year}-01-01`);
    if (existingResult.error) throw new Error(existingResult.error.message);
    if ((existingResult.data ?? []).some((item) => item.start_date <= toDate && item.end_date >= fromDate)) {
      throw new Error("Another pending or approved leave request overlaps this period.");
    }
    const annualAllowance = Number(leaveTypeResult.data.annual_allowance ?? 0);
    const usedDays = (existingResult.data ?? [])
      .filter((item) => item.status === "approved" && item.leave_type_id === leaveTypeId)
      .reduce((sum, item) => sum + Number(item.days ?? 0), 0);
    if (annualAllowance > 0 && usedDays + days > annualAllowance) {
      throw new Error(`${leaveTypeResult.data.name} has only ${Math.max(0, annualAllowance - usedDays)} day(s) available.`);
    }
    const engagement = await workerContext(worker.companyId, leaveIdentity.profileType, leaveIdentity.profileId);
    const policy = await applicablePolicy(worker.companyId, leaveIdentity.profileType, engagement.business_line, days);
    const steps = await resolveReportingApprovalSteps({
      companyId: worker.companyId,
      profileId: leaveIdentity.profileId,
      profileType: leaveIdentity.profileType,
      managerLevels: Number(policy.manager_levels)
    });
    const saveResult = await supabaseAdmin.rpc("hr_create_workforce_leave_request_with_steps", {
      p_company_id: worker.companyId,
      p_worker_type: leaveIdentity.profileType,
      p_profile_id: leaveIdentity.profileId,
      p_leave_type_id: leaveTypeId,
      p_start_date: fromDate,
      p_end_date: toDate,
      p_reason: reason,
      p_steps: steps
    });
    if (saveResult.error || !saveResult.data) throw new Error(saveResult.error?.message ?? "Unable to submit leave request.");
    const requestId = String(saveResult.data);
    await createAppNotification({
      accountId: worker.profileId,
      companyId: worker.companyId,
      data: { requestId, fromDate, toDate, approvalSteps: steps.length },
      eventCode: "leave_request_submitted",
      profileType: worker.profileType,
      sourceKey: requestId,
      variables: { from_date: fromDate.split("-").reverse().join("/"), to_date: toDate.split("-").reverse().join("/") }
    });
    return NextResponse.json({ ok: true, request: { id: requestId, status: "pending", approvalSteps: steps.length } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to submit leave request.";
    return NextResponse.json({ error: message }, { status: message.includes("Login") ? 401 : 400 });
  }
}
