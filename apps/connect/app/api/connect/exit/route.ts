import { NextResponse } from "next/server";
import { requireConnectAccount, type ConnectAccount } from "../../../../src/lib/connect-auth";
import { notifyEmployeeExitSubmitted, notifyEmployeeExitWithdrawal } from "../../../../src/lib/connect-exit-notifications";
import { resolveReportingApprovalSteps } from "../../../../src/lib/reporting-approval-chain";
import { supabaseAdmin } from "../../../../src/lib/supabase-admin";
import { workforceTable, type WorkforceProfileType } from "../../../../src/lib/workforce-profiles";

type AppProfileType = ConnectAccount["profileType"];
type PeopleProfileType = "employee" | "contractor";
type FieldProfileType = "workforce" | "field_executive" | "vendor" | "worker";

function db() { if (!supabaseAdmin) throw new Error("Database is unavailable."); return supabaseAdmin; }
function clean(value: unknown) { return String(value ?? "").trim(); }
function peopleProfile(value: AppProfileType): value is PeopleProfileType { return value === "employee" || value === "contractor"; }
function fieldProfile(value: AppProfileType): value is FieldProfileType { return value === "workforce" || value === "field_executive" || value === "vendor" || value === "worker"; }
function identityColumn(profileType: PeopleProfileType) { return profileType === "employee" ? "employee_id" : "contractor_id"; }
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const requested = new Date(`${value}T00:00:00`);
  const limit = new Date(today); limit.setFullYear(limit.getFullYear() + 1);
  return requested >= today && requested <= limit;
}

async function roleUser(companyId: string, role: string) {
  if (["HR_MANAGER", "HRMS_ADMIN"].includes(role)) {
    const { data } = await db().from("hr_user_access").select("user_id").eq("company_id", companyId).eq("role_code", role).eq("is_active", true).limit(1).maybeSingle();
    return data?.user_id ?? null;
  }
  if (role === "OWNER") {
    const { data } = await db().from("profiles").select("id").eq("company_id", companyId).eq("is_master_owner", true).eq("is_active", true).limit(1).maybeSingle();
    return data?.id ?? null;
  }
  return null;
}

async function serializePeopleCase(row: Record<string, any>) {
  const [{ data: tasks }, { data: documents }] = await Promise.all([
    db().from("hr_exit_tasks").select("id, category, name, due_date, status, is_required").eq("case_id", row.id).order("created_at"),
    db().from("hr_exit_documents").select("id, document_type, file_name, status, generated_at, storage_path").eq("case_id", row.id).neq("status", "void").order("generated_at", { ascending: false })
  ]);
  const safeDocuments = await Promise.all((documents ?? []).map(async (document) => {
    const { data } = await db().storage.from("hr-exit-documents").createSignedUrl(document.storage_path, 15 * 60);
    return { id: document.id, type: document.document_type, name: document.file_name, status: document.status, generatedAt: document.generated_at, downloadUrl: data?.signedUrl ?? "" };
  }));
  const reason = Array.isArray(row.hr_exit_reasons) ? row.hr_exit_reasons[0] : row.hr_exit_reasons;
  return {
    queue: "people", id: row.id, caseNumber: row.case_number, scenario: row.scenario,
    status: row.status, stage: row.current_stage, reason: reason?.name ?? "",
    comments: row.employee_reason ?? "", requestedLastWorkingDate: row.requested_last_working_date,
    approvedLastWorkingDate: row.approved_last_working_date, submittedAt: row.submitted_at,
    settlementStatus: row.settlement_status, tasks: tasks ?? [], documents: safeDocuments
  };
}

function serializeFieldCase(row: Record<string, any>) {
  return {
    queue: "workforce", id: row.id, caseNumber: `WF-${String(row.id).slice(0, 8).toUpperCase()}`,
    scenario: row.case_type, status: row.status, stage: row.status === "settled" ? "closed" : row.status,
    reason: String(row.reason_code ?? "").replaceAll("_", " "), comments: row.reason_details ?? "",
    requestedLastWorkingDate: row.requested_effective_date, approvedLastWorkingDate: row.approved_effective_date,
    submittedAt: row.created_at, settlementStatus: row.status === "settled" ? "paid" : row.status === "settlement_pending" ? "draft" : "not_started",
    tasks: [], documents: []
  };
}

async function loadPeoplePayload(account: ConnectAccount, profileType: PeopleProfileType) {
  const column = identityColumn(profileType);
  const [{ data: policy }, { data: reasons }, { data: exitCase }] = await Promise.all([
    db().from("hr_exit_policies").select("resignation_notice_days, withdrawal_allowed, manager_approval_levels").eq("company_id", account.companyId).maybeSingle(),
    db().from("hr_exit_reasons").select("id, name, comment_required").eq("company_id", account.companyId).eq("scenario", "resignation").eq("employee_selectable", true).eq("is_active", true).order("display_order"),
    db().from("hr_exit_cases").select("*, hr_exit_reasons(name)").eq("company_id", account.companyId).eq("worker_type", profileType).eq(column, account.id).order("submitted_at", { ascending: false }).limit(1).maybeSingle()
  ]);
  return {
    policy: policy ?? { resignation_notice_days: 30, withdrawal_allowed: true, manager_approval_levels: 2 },
    reasons: reasons ?? [], exitCase: exitCase ? await serializePeopleCase(exitCase) : null,
    queueLabel: "People Exit Management"
  };
}

async function loadFieldPayload(account: ConnectAccount, profileType: FieldProfileType) {
  const { data, error } = await db().from("workforce_lifecycle_cases")
    .select("id, case_type, status, requested_effective_date, approved_effective_date, reason_code, reason_details, review_remarks, created_at")
    .eq("company_id", account.companyId).eq("profile_type", profileType).eq("profile_id", account.id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return {
    policy: { resignation_notice_days: 0, withdrawal_allowed: true, manager_approval_levels: 1 },
    reasons: [{ id: "voluntary", name: "Voluntary resignation", comment_required: true }],
    exitCase: data ? serializeFieldCase(data) : null, queueLabel: "Workforce Lifecycle"
  };
}

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const accountId = query.get("accountId") ?? "";
    const profileType = clean(query.get("profileType")) as AppProfileType;
    if (profileType === "user") throw new Error("Choose a workforce account to manage an exit.");
    const account = await requireConnectAccount(profileType, accountId);
    if (peopleProfile(profileType)) return NextResponse.json({ ok: true, ...(await loadPeoplePayload(account, profileType)) });
    if (fieldProfile(profileType)) return NextResponse.json({ ok: true, ...(await loadFieldPayload(account, profileType)) });
    throw new Error("This workforce account cannot submit an exit request.");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load exit request." }, { status: 400 });
  }
}

async function withdrawPeople(account: ConnectAccount, profileType: PeopleProfileType) {
  const column = identityColumn(profileType);
  const [{ data: policy }, { data: exitCase }] = await Promise.all([
    db().from("hr_exit_policies").select("withdrawal_allowed").eq("company_id", account.companyId).maybeSingle(),
    db().from("hr_exit_cases").select("id, case_number, status, requested_last_working_date").eq("company_id", account.companyId).eq("worker_type", profileType).eq(column, account.id).not("status", "in", '("closed","rejected","withdrawn","cancelled")').order("submitted_at", { ascending: false }).limit(1).maybeSingle()
  ]);
  if (!policy?.withdrawal_allowed) throw new Error("Withdrawal requests are disabled by company policy.");
  if (!exitCase || ["documents_ready", "closed"].includes(exitCase.status)) throw new Error("This exit request can no longer be withdrawn.");
  const updated = await db().from("hr_exit_cases").update({ status: "withdrawal_requested", updated_at: new Date().toISOString() }).eq("id", exitCase.id);
  if (updated.error) throw new Error(updated.error.message);
  await db().from("hr_exit_events").insert({ company_id: account.companyId, case_id: exitCase.id, event_code: "WITHDRAWAL_REQUESTED", title: `${profileType === "employee" ? "Employee" : "Contractor"} requested resignation withdrawal`, actor_name: account.name ?? "Worker", details: {} });
  if (profileType === "employee") {
    const { data: employee } = await db().from("employees").select("employee_code, full_name, email").eq("company_id", account.companyId).eq("id", account.id).single();
    if (employee) await notifyEmployeeExitWithdrawal({ companyId: account.companyId, caseId: exitCase.id, employee, requestedDate: exitCase.requested_last_working_date ?? "" });
  }
  return "Withdrawal request sent for approval.";
}

async function withdrawField(account: ConnectAccount, profileType: FieldProfileType) {
  const { data: exitCase } = await db().from("workforce_lifecycle_cases").select("id,status")
    .eq("company_id", account.companyId).eq("profile_type", profileType).eq("profile_id", account.id)
    .in("status", ["submitted", "under_review"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!exitCase) throw new Error("This exit request can no longer be withdrawn.");
  const now = new Date().toISOString();
  const update = await db().from("workforce_lifecycle_cases").update({ status: "cancelled", updated_at: now }).eq("id", exitCase.id);
  if (update.error) throw new Error(update.error.message);
  const profileUpdate = await db().from(workforceTable(profileType as WorkforceProfileType)).update({ lifecycle_status: "active", updated_at: now }).eq("company_id", account.companyId).eq("id", account.id);
  if (profileUpdate.error) throw new Error(profileUpdate.error.message);
  await db().from("workforce_lifecycle_events").insert({ company_id: account.companyId, lifecycle_case_id: exitCase.id, field_executive_id: profileType === "field_executive" ? account.id : null, profile_type: profileType, profile_id: account.id, event_code: "resignation_withdrawn", from_status: exitCase.status, to_status: "cancelled", source_portal: "connect", remarks: "Withdrawn by worker" });
  return "Resignation withdrawn.";
}

async function submitPeople(account: ConnectAccount, profileType: PeopleProfileType, body: Record<string, unknown>) {
  const reasonId = clean(body.reasonId); const comments = clean(body.comments);
  const requestedDate = clean(body.requestedLastWorkingDate);
  if (!validDate(requestedDate)) throw new Error("Requested last working date must be between today and one year from today.");
  const table = profileType === "employee" ? "employees" : "contractors";
  const code = profileType === "employee" ? "employee_code" : "dropx_id";
  const column = identityColumn(profileType);
  const [{ data: worker }, { data: reason }, { data: policy }, { data: existing }] = await Promise.all([
    db().from(table).select(`id, company_id, ${code}, full_name, email, mobile, is_active`).eq("company_id", account.companyId).eq("id", account.id).maybeSingle(),
    db().from("hr_exit_reasons").select("id, name, comment_required, default_rehire_eligible").eq("company_id", account.companyId).eq("scenario", "resignation").eq("employee_selectable", true).eq("is_active", true).eq("id", reasonId).maybeSingle(),
    db().from("hr_exit_policies").select("*").eq("company_id", account.companyId).maybeSingle(),
    db().from("hr_exit_cases").select("id").eq("company_id", account.companyId).eq("worker_type", profileType).eq(column, account.id).not("status", "in", '("closed","rejected","withdrawn","cancelled")').limit(1)
  ]);
  if (!worker?.is_active || !reason) throw new Error("Workforce profile or resignation reason is unavailable.");
  if (reason.comment_required && comments.length < 3) throw new Error("Comments are required for this resignation reason.");
  if (existing?.length) throw new Error("An active exit request already exists.");
  const managerLevels = Math.max(1, Math.min(4, Number(policy?.manager_approval_levels ?? 2)));
  const managerSteps = await resolveReportingApprovalSteps({ companyId: account.companyId, profileId: account.id, profileType, managerLevels });
  const { data: caseNumber, error: numberError } = await db().rpc("hr_next_exit_case_number", { p_company_id: account.companyId, p_prefix: policy?.case_number_prefix ?? "EXIT" });
  if (numberError) throw new Error(numberError.message);
  const identity = profileType === "employee" ? { employee_id: account.id, contractor_id: null } : { employee_id: null, contractor_id: account.id };
  const { data: exitCase, error } = await db().from("hr_exit_cases").insert({
    company_id: account.companyId, case_number: caseNumber, worker_type: profileType, ...identity,
    source: "employee", scenario: "resignation", reason_id: reason.id, employee_reason: comments || null,
    requested_last_working_date: requestedDate, notice_days: policy?.resignation_notice_days ?? 30,
    status: "submitted", current_stage: "review", manager_user_id: managerSteps[0]?.approver_user_id ?? null,
    personal_email: clean(body.personalEmail) || worker.email || null, personal_mobile: clean(body.personalMobile) || worker.mobile || null,
    rehire_eligible: reason.default_rehire_eligible
  }).select("id").single();
  if (error) throw new Error(error.message);
  const approvals = managerSteps.map((step, index) => ({ company_id: account.companyId, case_id: exitCase.id, step_order: index + 1, step_name: step.step_name, approver_role: "REPORTING_MANAGER", assigned_user_id: step.approver_user_id, is_required: true }));
  const hrApprover = await roleUser(account.companyId, "HR_MANAGER") ?? await roleUser(account.companyId, "HRMS_ADMIN") ?? await roleUser(account.companyId, "OWNER");
  approvals.push({ company_id: account.companyId, case_id: exitCase.id, step_order: approvals.length + 1, step_name: "HR final approval", approver_role: "HR_MANAGER", assigned_user_id: hrApprover, is_required: true });
  const approvalInsert = await db().from("hr_exit_approvals").insert(approvals);
  if (approvalInsert.error) throw new Error(approvalInsert.error.message);
  if (policy?.auto_create_tasks !== false) {
    const { data: templates } = await db().from("hr_exit_task_templates").select("*").eq("company_id", account.companyId).eq("is_active", true).in("scenario", ["resignation", "all"]).order("display_order");
    if (templates?.length) {
      const rows = templates.map((template) => { const due = new Date(`${requestedDate}T00:00:00Z`); due.setUTCDate(due.getUTCDate() + template.due_offset_days); return { company_id: account.companyId, case_id: exitCase.id, template_id: template.id, category: template.category, code: template.code, name: template.name, instructions: template.instructions, owner_role: template.owner_role, due_date: due.toISOString().slice(0, 10), is_required: template.is_required }; });
      const inserted = await db().from("hr_exit_tasks").insert(rows); if (inserted.error) throw new Error(inserted.error.message);
    }
  }
  if (profileType === "employee") {
    const issuedAssets = await db().from("asset_assignments").select("id,asset_id").eq("company_id", account.companyId).eq("employee_id", account.id).eq("status", "issued");
    if (issuedAssets.error) throw new Error(issuedAssets.error.message);
    if (issuedAssets.data?.length) {
      const clearance = await db().from("asset_exit_clearances").insert(issuedAssets.data.map((assignment) => ({ company_id: account.companyId, exit_case_id: exitCase.id, employee_id: account.id, assignment_id: assignment.id, asset_id: assignment.asset_id, due_date: requestedDate })));
      if (clearance.error) throw new Error(clearance.error.message);
      const assetTask = await db().from("hr_exit_tasks").insert({ company_id: account.companyId, case_id: exitCase.id, category: "assets", code: "RETURN_COMPANY_ASSETS", name: `Return ${issuedAssets.data.length} company asset${issuedAssets.data.length === 1 ? "" : "s"}`, instructions: "Every issued asset must be returned, recorded as lost/deductible, or explicitly waived before final documents.", owner_role: "ASSET_CUSTODIAN", due_date: requestedDate, is_required: true });
      if (assetTask.error) throw new Error(assetTask.error.message);
    }
  }
  await db().from("hr_exit_events").insert({ company_id: account.companyId, case_id: exitCase.id, event_code: "CASE_SUBMITTED", title: "Resignation submitted in DropX One", actor_name: account.name ?? "Worker", details: { worker_type: profileType, requested_last_working_date: requestedDate } });
  if (profileType === "employee") {
    const employeeWorker = worker as { employee_code: string | null; full_name: string; email: string | null };
    await notifyEmployeeExitSubmitted({ companyId: account.companyId, caseId: exitCase.id, employee: employeeWorker, requestedDate });
  }
  return `Resignation submitted successfully. Case ${caseNumber} has been sent for two-level manager and HR approval.`;
}

async function submitField(account: ConnectAccount, profileType: FieldProfileType, body: Record<string, unknown>) {
  const requestedDate = clean(body.requestedLastWorkingDate); const reason = clean(body.comments);
  if (!validDate(requestedDate)) throw new Error("Select a valid requested last working date.");
  if (reason.length < 5) throw new Error("Provide a clear resignation reason.");
  const table = workforceTable(profileType as WorkforceProfileType);
  const [{ data: profile, error: profileError }, { data: existing }] = await Promise.all([
    db().from(table).select("id, lifecycle_status, location_id, is_active").eq("company_id", account.companyId).eq("id", account.id).maybeSingle(),
    db().from("workforce_lifecycle_cases").select("id").eq("company_id", account.companyId).eq("profile_type", profileType).eq("profile_id", account.id).not("status", "in", '("rejected","settled","cancelled")').limit(1)
  ]);
  if (profileError) throw new Error(profileError.message);
  if (!profile?.is_active || profile.lifecycle_status !== "active") throw new Error("Only active workforce can submit a resignation.");
  if (existing?.length) throw new Error("An active exit request already exists.");
  const { data: created, error } = await db().from("workforce_lifecycle_cases").insert({
    company_id: account.companyId, field_executive_id: profileType === "field_executive" ? account.id : null,
    profile_type: profileType, profile_id: account.id, profile_location_id: profile.location_id,
    case_type: "resignation", requested_effective_date: requestedDate, reason_code: "voluntary",
    reason_details: reason, initiated_source: "connect"
  }).select("id").single();
  if (error) throw new Error(error.message);
  const now = new Date().toISOString();
  const update = await db().from(table).update({ lifecycle_status: "resignation_pending", updated_at: now }).eq("company_id", account.companyId).eq("id", account.id);
  if (update.error) throw new Error(update.error.message);
  const event = await db().from("workforce_lifecycle_events").insert({ company_id: account.companyId, lifecycle_case_id: created.id, field_executive_id: profileType === "field_executive" ? account.id : null, profile_type: profileType, profile_id: account.id, event_code: "resignation_submitted", from_status: "active", to_status: "submitted", source_portal: "connect", remarks: reason });
  if (event.error) throw new Error(event.error.message);
  return "Resignation submitted to the Workforce Lifecycle team.";
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const accountId = clean(body.accountId); const profileType = clean(body.profileType) as AppProfileType;
    if (profileType === "user") throw new Error("Choose a workforce account to manage an exit.");
    const account = await requireConnectAccount(profileType, accountId);
    const action = clean(body.action || "submit");
    if (action === "withdraw") {
      const notice = peopleProfile(profileType) ? await withdrawPeople(account, profileType) : fieldProfile(profileType) ? await withdrawField(account, profileType) : "";
      return NextResponse.json({ ok: true, notice });
    }
    const notice = peopleProfile(profileType) ? await submitPeople(account, profileType, body) : fieldProfile(profileType) ? await submitField(account, profileType, body) : "";
    return NextResponse.json({ ok: true, notice });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to submit exit request." }, { status: 400 });
  }
}
