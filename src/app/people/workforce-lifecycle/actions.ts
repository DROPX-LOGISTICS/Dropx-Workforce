"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isCompanyOwner, requirePagePermission } from "@/lib/authorization";
import { syncBiometricEnrolment } from "@/lib/biometric/enrolments";
import { requireCompanyId } from "@/lib/company-scope";
import { isMissingVerificationTable } from "@/lib/profile-verifications";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isNonEmployeeProfileType, workforceTable } from "@/lib/workforce-profiles";
import { firstDesignationBusinessCategory } from "@/lib/designation-business-categories";
import {loadWorkforceEarnings} from '@/lib/workforce-earnings';
import {readAllRows} from '@/lib/supabase-pagination';
import {assertFinalPayrollMatches} from '@/lib/workforce-exit-reconciliation';
import {loadRecordedExitChecks} from '@/lib/workforce-exit-recorded-loader';
import {recordedExitBlockers} from '@/lib/workforce-exit-recorded-checks';

function lifecycleRedirect(params: { error?: string; notice?: string; tab?: string }): never {
  const query = new URLSearchParams();
  if (params.error) query.set("error", params.error);
  if (params.notice) query.set("notice", params.notice);
  if (params.tab) query.set("tab", params.tab);
  let path = "/delivery-network/lifecycle";
  try {
    const referer = new URL(headers().get("referer") ?? "http://localhost");
    // Keep the operator on the same scoped profile after an existing action.
    const person = referer.searchParams.get('person');
    if(person && /^[0-9a-f-]{36}$/i.test(person)) {
      query.set('person',person);
      query.set('section',params.tab==='exits'?'exit':referer.searchParams.get('section')||'profile');
    }
    if (referer.pathname.startsWith("/people/")) {
      path = "/people/workforce-lifecycle";
    }
  } catch {
    // Keep the compatibility route when the request has no usable referrer.
  }
  redirect(`${path}${query.size ? `?${query.toString()}` : ""}`);
}

function isRedirect(error: unknown) {
  return typeof error === "object" && error !== null && "digest" in error &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT");
}

function text(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function revalidateLifecyclePages() {
  revalidatePath("/delivery-network/lifecycle");
  revalidatePath("/people/workforce-lifecycle");
}

async function requireScopedApplicant(id: string) {
  const authorization = await requirePagePermission("people_review", "edit");
  if (authorization.readOnly) throw new Error("Preview mode cannot change Workforce records.");
  const companyId = requireCompanyId(authorization);
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const result = await supabaseAdmin
    .from("workforce")
    .select("id, full_name, location_id, designation, date_of_join, biometric_id, onboarding_status, lifecycle_status, identity_exception_required, identity_exception_context")
    .is("deleted_at", null).neq("migration_state", "reclassified")
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error("Workforce applicant was not found.");
  const roles = await supabaseAdmin.from("designations").select("code,name,designation_category:designation_categories!designations_designation_category_id_fkey(people_module)").eq("company_id",companyId);
  const applicantDesignation=String(result.data.designation || "").trim().toLowerCase();
  const role = roles.data?.find(row=>[row.code,row.name].some(value=>String(value).trim().toLowerCase()===applicantDesignation));
  if (roles.error || firstDesignationBusinessCategory(role?.designation_category)?.people_module !== "delivery_network") throw new Error("Only master-classified Workforce profiles can be reviewed here.");
  if (!authorization.hasAllLocationAccess &&
      !authorization.locationScopeIds.includes(String(result.data.location_id ?? ""))) {
    throw new Error("You do not have access to this applicant location.");
  }
  return { authorization, companyId, applicant: result.data };
}

async function designationCode(companyId: string, designation: string | null) {
  if (!supabaseAdmin || !designation) return "";
  const result = await supabaseAdmin
    .from("designations")
    .select("code")
    .eq("company_id", companyId)
    .ilike("name", designation)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return String(result.data?.code ?? "").trim().toUpperCase();
}

export async function reviewWorkforceOnboarding(formData: FormData) {
  const id = text(formData.get("id"));
  const action = text(formData.get("review_action")).toLowerCase();
  const remarks = text(formData.get("remarks"));
  try {
    if (!id) throw new Error("Choose an onboarding request.");
    if (!["approve", "approve_for_joining", "return", "reject"].includes(action)) throw new Error("Choose a valid review action.");
    const joiningOnly = action === "approve_for_joining";
    if (["return", "reject"].includes(action) && !remarks) throw new Error("Review remarks are required.");
    const { authorization, companyId, applicant } = await requireScopedApplicant(id);
    if (!["under_review", "returned", "approved"].includes(String(applicant.onboarding_status))) {
      throw new Error("Only submitted or returned onboarding requests can be reviewed.");
    }
    const reviewedAt = new Date().toISOString();
    if (!["approve", "approve_for_joining"].includes(action)) {
      const toStatus = action === "return" ? "returned" : "rejected";
      const update = await supabaseAdmin!.from("workforce").update({
        onboarding_status: toStatus,
        onboarding_reviewed_at: reviewedAt,
        onboarding_reviewed_by: authorization.userId,
        onboarding_review_remarks: remarks,
        profile_return_remarks: action === "return" ? remarks : null,
        profile_returned_at: action === "return" ? reviewedAt : null,
        is_active: action === "return",
        updated_at: reviewedAt
      }).eq("company_id", companyId).eq("id", id);
      if (update.error) throw new Error(update.error.message);
      const event = await supabaseAdmin!.from("workforce_onboarding_events").insert({
        company_id: companyId,
        workforce_id: id,
        event_code: action === "return" ? "returned_for_correction" : "onboarding_rejected",
        from_status: applicant.onboarding_status,
        to_status: toStatus,
        actor_user_id: authorization.userId,
        source_portal: "workforce",
        remarks
      });
      if (event.error) throw new Error(event.error.message);
      revalidateLifecyclePages();
      lifecycleRedirect({ notice: action === "return" ? "Application returned for correction." : "Application rejected." });
    }

    const unresolved = await supabaseAdmin!.from("connect_profile_verifications")
      .select("kind")
      .eq("company_id", companyId)
      .eq("profile_type", "workforce")
      .eq("account_id", id)
      .or("manual_review.eq.true,block_submit.eq.true")
      .limit(10);
    if (unresolved.error) throw new Error(unresolved.error.message);
    if (unresolved.data?.length) {
      const fields = unresolved.data.map((row) => String(row.kind).replaceAll("_", " ").toUpperCase());
      throw new Error(`Resolve and re-verify ${fields.join(", ")} before approving this application.`);
    }

    const identityExceptionApproved = formData.get("identity_exception_approved") === "true";
    if (applicant.identity_exception_required && !identityExceptionApproved) {
      throw new Error("Confirm that you reviewed the existing employment and approve this different Workforce engagement.");
    }

    const code = await designationCode(companyId, applicant.designation);
    const master = await supabaseAdmin!.from("workforce_onboarding_checklist_master")
      .select("id, code, label, is_required, applicable_designation_codes")
      .eq("company_id", companyId).eq("is_active", true).order("sort_order");
    if (master.error) throw new Error(master.error.message);
    const applicable = (master.data ?? []).filter((item) => {
      const codes = Array.isArray(item.applicable_designation_codes) ? item.applicable_designation_codes : [];
      return !codes.length || codes.map((value) => String(value).toUpperCase()).includes(code);
    });
    if (applicable.some((item) => item.code === "agreement_accepted" && item.is_required)) {
      const acceptance = await supabaseAdmin!.from("workforce_agreement_acceptances").select("id").eq("company_id", companyId).eq("profile_type", "workforce").eq("profile_id", id).not("accepted_at", "is", null).limit(1);
      if (acceptance.error) throw new Error(acceptance.error.message);
      if (!acceptance.data?.length) throw new Error("The associate must accept the agreement in DropX One before activation.");
    }
    const providerId = text(formData.get("provider_employee_id"));
    const providerNotRequired = formData.get("provider_not_required") === "true";
    if (providerNotRequired && !isCompanyOwner(authorization)) throw new Error("Only an owner can waive the provider ID requirement.");
    if (!joiningOnly && applicable.some((item) => item.code === "provider_id_created" && item.is_required) && !providerNotRequired && !providerId) throw new Error("Enter the verified provider ID before activation. Use Approve registration while the Amazon ID is pending.");
    const results = applicable.map((item) => {
      const checked = formData.get(`checklist_${item.id}`) === "true";
      const status = item.code === "provider_id_created" && joiningOnly ? "pending" : item.code === "provider_id_created" && providerNotRequired
        ? "not_required"
        : checked ? "completed" : "pending";
      return {
        company_id: companyId,
        workforce_id: id,
        field_executive_id: null,
        checklist_item_id: item.id,
        status,
        remarks: item.code === "provider_id_created"
          ? providerId ? `Provider ID: ${providerId}` : providerNotRequired ? "Provider ID not required" : null
          : null,
        completed_by: status === "pending" ? null : authorization.userId,
        completed_at: status === "pending" ? null : reviewedAt,
        updated_at: reviewedAt
      };
    });
    const incomplete = applicable.filter((item, index) => item.is_required && results[index]?.status === "pending" && !(joiningOnly && item.code === "provider_id_created"));
    if (incomplete.length) throw new Error(`Complete the required checklist: ${incomplete.map((item) => item.label).join(", ")}.`);
    if (results.length) {
      const checklist = await supabaseAdmin!.from("workforce_onboarding_checklist_results")
        .upsert(results, { onConflict: "workforce_id,checklist_item_id" });
      if (checklist.error) throw new Error(checklist.error.message);
    }
    const approval = await supabaseAdmin!.from("workforce").update({
      onboarding_status: joiningOnly ? "approved" : "active",
      onboarding_reviewed_at: reviewedAt,
      onboarding_reviewed_by: authorization.userId,
      onboarding_review_remarks: remarks || null,
      onboarding_approved_at: reviewedAt,
      onboarding_approved_by: authorization.userId,
      provider_id_status: providerId ? "created" : joiningOnly ? "pending" : "not_required",
      provider_employee_id: providerId || null,
      identity_exception_approved_at: applicant.identity_exception_required ? reviewedAt : null,
      identity_exception_approved_by: applicant.identity_exception_required ? authorization.userId : null,
      is_active: !joiningOnly,
      lifecycle_status: joiningOnly ? "onboarding" : "active",
      updated_at: reviewedAt
    }).eq("company_id", companyId).eq("id", id);
    if (approval.error) throw new Error(approval.error.message);
    try {
      await syncBiometricEnrolment({
        accountId: id,
        companyId,
        createdBy: authorization.userId,
        effectiveFrom: applicant.date_of_join || reviewedAt.slice(0, 10),
        enrolmentId: applicant.biometric_id,
        isActive: true,
        locationId: String(applicant.location_id),
        profileType: "workforce",
        workerType: "individual_contract"
      });
    } catch (syncError) {
      await supabaseAdmin!.from("workforce").update({
        onboarding_status: "approved",
        onboarding_activated_at: null,
        is_active: false,
        lifecycle_status: "onboarding",
        updated_at: new Date().toISOString()
      }).eq("company_id", companyId).eq("id", id);
      throw new Error(`Approval was saved, but biometric activation failed. The profile remains inactive: ${syncError instanceof Error ? syncError.message : "Unknown biometric error"}`);
    }
    const event = await supabaseAdmin!.from("workforce_onboarding_events").insert({
      company_id: companyId,
      workforce_id: id,
      event_code: joiningOnly ? "approved_for_joining" : "ho_approved_and_activated",
      from_status: applicant.onboarding_status,
      to_status: joiningOnly ? "approved" : "active",
      actor_user_id: authorization.userId,
      source_portal: "workforce",
      remarks: remarks || (joiningOnly ? "Registration approved. Amazon ID activation and Provider ID mapping remain pending." : "HO checklist completed and workforce ID activated."),
      metadata: applicant.identity_exception_required ? {
        identity_exception_approved: true,
        identity_exception_context: applicant.identity_exception_context
      } : {}
    });
    if (event.error) throw new Error(event.error.message);
    revalidateLifecyclePages();
    revalidatePath("/delivery-network/joining");
    if (joiningOnly) redirect(`/delivery-network/lifecycle?person=${encodeURIComponent(id)}&section=activation&notice=${encodeURIComponent("Registration approved. Continue with Amazon ID activation.")}`);
    lifecycleRedirect({ notice: `${applicant.full_name} approved and activated.` });
  } catch (error) {
    if (isRedirect(error)) throw error;
    lifecycleRedirect({ error: error instanceof Error ? error.message : "Unable to review onboarding request." });
  }
}

export async function startWorkforceExit(formData: FormData) {
  const id = text(formData.get("id"));
  const caseType = text(formData.get("case_type")).toLowerCase();
  const effectiveDate = text(formData.get("effective_date"));
  const reasonCode = text(formData.get("reason_code"));
  const reasonDetails = text(formData.get("reason_details"));
  try {
    if (!id || !["resignation", "termination"].includes(caseType)) throw new Error("Choose a valid workforce exit.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) throw new Error("Effective date is required.");
    if (!reasonCode) throw new Error("Exit reason is required.");
    const { authorization, companyId, applicant } = await requireScopedApplicant(id);
    if (String(applicant.lifecycle_status) !== "active") throw new Error("Only active workforce can enter an exit process.");
    const created = await supabaseAdmin!.from("workforce_lifecycle_cases").insert({
      company_id: companyId,
      field_executive_id: null,
      profile_type: "workforce",
      profile_id: id,
      profile_location_id: applicant.location_id,
      case_type: caseType,
      requested_effective_date: effectiveDate,
      reason_code: reasonCode,
      reason_details: reasonDetails || null,
      initiated_by: authorization.userId,
      initiated_source: "workforce"
    }).select("id").single();
    if (created.error) throw new Error(created.error.message);
    const nextStatus = caseType === "resignation" ? "resignation_pending" : "termination_pending";
    const update = await supabaseAdmin!.from("workforce").update({ lifecycle_status: nextStatus, updated_at: new Date().toISOString() })
      .eq("company_id", companyId).eq("id", id);
    if (update.error) throw new Error(update.error.message);
    const event = await supabaseAdmin!.from("workforce_lifecycle_events").insert({
      company_id: companyId,
      lifecycle_case_id: created.data.id,
      field_executive_id: null,
      profile_type: "workforce",
      profile_id: id,
      event_code: `${caseType}_submitted`,
      from_status: "active",
      to_status: "submitted",
      actor_user_id: authorization.userId,
      source_portal: "workforce",
      remarks: reasonDetails || reasonCode
    });
    if (event.error) throw new Error(event.error.message);
    revalidateLifecyclePages();
    lifecycleRedirect({ notice: `${caseType === "resignation" ? "Resignation" : "Termination"} case created.`, tab: "exits" });
  } catch (error) {
    if (isRedirect(error)) throw error;
    lifecycleRedirect({ error: error instanceof Error ? error.message : "Unable to start workforce exit.", tab: "active" });
  }
}

export async function reviewWorkforceExit(formData: FormData) {
  const caseId = text(formData.get("case_id"));
  const action = text(formData.get("review_action")).toLowerCase();
  const remarks = text(formData.get("remarks"));
  try {
    const authorization = await requirePagePermission("people_review", "edit");
    const companyId = requireCompanyId(authorization);
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    if (!caseId || !["approve", "reject"].includes(action)) throw new Error("Choose a valid exit decision.");
    if (authorization.readOnly) throw new Error('Preview mode cannot change an exit.');
    if (!remarks) throw new Error("Decision remarks are required.");
    const current = await supabaseAdmin.from("workforce_lifecycle_cases")
      .select("id, field_executive_id, profile_type, profile_id, profile_location_id, status, requested_effective_date")
      .eq("company_id", companyId).eq("id", caseId).maybeSingle();
    if (current.error) throw new Error(current.error.message);
    if (!current.data) throw new Error("Exit case was not found.");
    if (!isNonEmployeeProfileType(current.data.profile_type)) throw new Error("This engagement type is not supported by this queue.");
    const locationId = String(current.data.profile_location_id ?? "");
    if (!authorization.hasAllLocationAccess && !authorization.locationScopeIds.includes(locationId)) throw new Error("You do not have access to this location.");
    if (!["submitted", "under_review"].includes(String(current.data.status))) throw new Error("This exit case has already been decided.");
    const now = new Date().toISOString();
    const toStatus = action === "approve" ? "settlement_pending" : "rejected";
    const update = await supabaseAdmin.from("workforce_lifecycle_cases").update({
      status: toStatus,
      reviewed_by: authorization.userId,
      reviewed_at: now,
      review_remarks: remarks,
      approved_by: action === "approve" ? authorization.userId : null,
      approved_at: action === "approve" ? now : null,
      approved_effective_date: action === "approve" ? current.data.requested_effective_date : null,
      updated_at: now
    }).eq("company_id", companyId).eq("id", caseId);
    if (update.error) throw new Error(update.error.message);
    const profileUpdate = await supabaseAdmin.from(workforceTable(current.data.profile_type)).update({
      lifecycle_status: action === "approve" ? "settlement_pending" : "active",
      ...(action === 'approve' ? {last_working_date: current.data.requested_effective_date} : {}),
      updated_at: now
    }).eq("company_id", companyId).eq("id", current.data.profile_id);
    if (profileUpdate.error) throw new Error(profileUpdate.error.message);
    const lifecycleEvent = await supabaseAdmin.from("workforce_lifecycle_events").insert({
      company_id: companyId,
      lifecycle_case_id: current.data.id,
      field_executive_id: current.data.profile_type === "field_executive" ? current.data.profile_id : null,
      profile_type: current.data.profile_type,
      profile_id: current.data.profile_id,
      event_code: action === "approve" ? "exit_approved" : "exit_rejected",
      from_status: current.data.status,
      to_status: toStatus,
      actor_user_id: authorization.userId,
      source_portal: "workforce",
      remarks
    });
    if (lifecycleEvent.error) throw new Error(lifecycleEvent.error.message);
    revalidateLifecyclePages();
    lifecycleRedirect({ notice: action === "approve" ? "Exit approved for settlement." : "Exit request rejected.", tab: "exits" });
  } catch (error) {
    if (isRedirect(error)) throw error;
    lifecycleRedirect({ error: error instanceof Error ? error.message : "Unable to review exit.", tab: "exits" });
  }
}

export async function completeWorkforceSettlement(formData: FormData) {
  const caseId = text(formData.get("case_id"));
  try {
    const authorization = await requirePagePermission("people_review", "edit");
    if (authorization.readOnly) throw new Error('Preview mode cannot complete settlement.');
    const companyId = requireCompanyId(authorization);
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const current = await supabaseAdmin.from("workforce_lifecycle_cases")
      .select("id, field_executive_id, profile_type, profile_id, profile_location_id, status, approved_effective_date, requested_effective_date")
      .eq("company_id", companyId).eq("id", caseId).maybeSingle();
    if (current.error) throw new Error(current.error.message);
    if (!current.data || !["settlement_pending", "settled"].includes(current.data.status)) throw new Error("Choose an exit awaiting settlement.");
    if (!isNonEmployeeProfileType(current.data.profile_type)) throw new Error("This engagement type is not supported by this queue.");
    const locationId = String(current.data.profile_location_id ?? "");
    if (!authorization.hasAllLocationAccess && !authorization.locationScopeIds.includes(locationId)) throw new Error("You do not have access to this location.");
    const masters = await supabaseAdmin.from("workforce_exit_checklist_master").select("id, label, is_required")
      .eq("company_id", companyId).eq("is_active", true).order("sort_order");
    if (masters.error) throw new Error(masters.error.message);
    const now = new Date().toISOString();
    const checklistRows = (masters.data ?? []).map((item) => ({
      company_id: companyId,
      lifecycle_case_id: caseId,
      checklist_item_id: item.id,
      status: formData.get(`exit_checklist_${item.id}`) === "true" ? "completed" : "pending",
      completed_by: formData.get(`exit_checklist_${item.id}`) === "true" ? authorization.userId : null,
      completed_at: formData.get(`exit_checklist_${item.id}`) === "true" ? now : null,
      updated_at: now
    }));
    const incomplete = (masters.data ?? []).filter((item, index) => item.is_required && checklistRows[index]?.status !== "completed");
    if (incomplete.length) throw new Error(`Complete the exit checklist: ${incomplete.map((item) => item.label).join(", ")}.`);
    if (!isCompanyOwner(authorization)) throw new Error("Only an owner can complete or waive a settlement.");
    if (current.data.profile_type === 'workforce') {
      const recorded=await loadRecordedExitChecks(companyId,current.data.profile_id,authorization.hasAllLocationAccess?null:authorization.locationScopeIds);
      const blockers=recordedExitBlockers(recorded);
      if(blockers.length)throw new Error(blockers.join(' · '));
      const itemId=text(formData.get('payroll_item_id'));
      const item=await supabaseAdmin.from('workforce_payroll_items').select('id,payroll_run_id,workforce_id,status').eq('company_id',companyId).eq('workforce_id',current.data.profile_id).eq('id',itemId).maybeSingle();
      if(item.error||!item.data||item.data.status!=='paid') throw new Error('Choose a Finance-paid final payroll item for this associate.');
      const run=await supabaseAdmin.from('workforce_payroll_runs').select('id,period_start,period_end').eq('company_id',companyId).eq('id',item.data.payroll_run_id).single();
      if(run.error)throw new Error('The final payroll period could not be verified.');
      const snapshot=await loadWorkforceEarnings({...authorization,hasAllLocationAccess:false,locationScopeIds:[locationId]},run.data.period_start,run.data.period_end,{payrollRunId:run.data.id});
      if(snapshot.setupRequired||snapshot.warnings.length)throw new Error('Final earnings sources could not be verified. Resolve the earnings warnings first.');
      const frozen=await readAllRows(supabaseAdmin.from('workforce_payroll_lines').select('source_type,source_id,work_date,base_amount,incentive_amount,adjustment_amount,net_amount').eq('company_id',companyId).eq('payroll_item_id',itemId).order('id'));
      if(frozen.error)throw new Error('The paid earnings snapshot could not be loaded.');
      assertFinalPayrollMatches(snapshot.lines.filter(line=>line.workforceId===current.data!.profile_id),frozen.data??[]);
      if(formData.get('sources_reviewed')!=='true')throw new Error('Confirm all periods, late imports and claims have been reviewed.');
      const reconciled=await supabaseAdmin.rpc('workforce_reconcile_exit',{p_company:companyId,p_case:caseId,p_item:itemId,p_actor:authorization.userId,p_owner:true,p_note:text(formData.get('review_note')),p_checklist:checklistRows,p_locations:authorization.hasAllLocationAccess?null:authorization.locationScopeIds});
      if(reconciled.error)throw new Error(reconciled.error.message);
      revalidateLifecyclePages();
      lifecycleRedirect({notice:'Exit reconciled to the existing Finance payment and access deactivated. No additional payment was created.',tab:'exits'});
    }
    const gross = Number(text(formData.get("gross_amount")) || 0);
    const deductions = Number(text(formData.get("deduction_amount")) || 0);
    if (!Number.isFinite(gross) || !Number.isFinite(deductions) || gross < 0 || deductions < 0) throw new Error("Settlement amounts must be finite and nonnegative.");
    const completed = await supabaseAdmin.rpc("workforce_complete_settlement", {
      p_company: companyId, p_case: caseId, p_actor: authorization.userId,
      p_status: text(formData.get("settlement_status")), p_gross: gross, p_deductions: deductions,
      p_reference: text(formData.get("payment_reference")) || null,
      p_payment_date: text(formData.get("payment_date")) || null,
      p_checklist: checklistRows, p_locations: authorization.hasAllLocationAccess ? null : authorization.locationScopeIds
    });
    if (completed.error) throw new Error(completed.error.message);
    revalidateLifecyclePages();
    lifecycleRedirect({ notice: "Final settlement recorded and workforce access deactivated.", tab: "exits" });
  } catch (error) {
    if (isRedirect(error)) throw error;
    lifecycleRedirect({ error: error instanceof Error ? error.message : "Unable to complete settlement.", tab: "exits" });
  }
}
