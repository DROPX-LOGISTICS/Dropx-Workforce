"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isCompanyOwner, requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isWorkforceDate } from "@/lib/workforce-earnings";

const path = "/delivery-network/adjustments";
const adjustmentCategories = new Set(["id_exception", "delivery_correction", "joining_bonus", "referral_bonus", "reimbursement", "asset_recovery", "cash_recovery", "other"]);
function text(value: FormDataEntryValue | null) { return String(value ?? "").trim(); }
function finish(kind: "notice" | "error", message: string): never { redirect(`${path}?${kind}=${encodeURIComponent(message)}`); }

export async function createWorkforceAdjustment(formData: FormData) {
  const authorization = await requirePagePermission("workforce_adjustments", "add");
  const companyId = requireCompanyId(authorization);
  try {
    if (authorization.readOnly) throw new Error('Preview mode is read-only.');
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const workforceId = text(formData.get("workforce_id"));
    const adjustmentType = text(formData.get("adjustment_type"));
    const category = text(formData.get("category"));
    const amount = Number(text(formData.get("amount")));
    const effectiveDate = text(formData.get("effective_date"));
    const reason = text(formData.get("reason"));
    if (/^(MILEAGE|OPS-LOSS):/i.test(text(formData.get('external_reference')))) throw new Error('Use the dedicated mileage or station loss desk for controlled claim references.');
    if (!workforceId || !category || !reason || !isWorkforceDate(effectiveDate)) throw new Error("Associate, category, effective date and reason are required.");
    if (!["earning", "deduction"].includes(adjustmentType)) throw new Error("Choose earning or deduction.");
    if (!adjustmentCategories.has(category)) throw new Error("Choose a valid adjustment category.");
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be greater than zero.");
    if (reason.length > 2000 || text(formData.get("external_reference")).length > 250) throw new Error("Reason or reference is too long.");
    let workerQuery = supabaseAdmin.from("workforce").select("id, location_id").eq("company_id", companyId).eq("id", workforceId).is("deleted_at", null);
    if (!authorization.hasAllLocationAccess) workerQuery = workerQuery.in("location_id", authorization.locationScopeIds.length ? authorization.locationScopeIds : ["00000000-0000-0000-0000-000000000000"]);
    const worker = await workerQuery.maybeSingle();
    if (worker.error) throw new Error(worker.error.message);
    if (!worker.data) throw new Error("Workforce associate was not found in your scope.");
    const result = await supabaseAdmin.from("workforce_adjustments").insert({
      company_id: companyId,
      workforce_id: workforceId,
      adjustment_type: adjustmentType,
      category,
      amount,
      effective_date: effectiveDate,
      reason,
      external_reference: text(formData.get("external_reference")) || null,
      status: "pending",
      requested_by: authorization.userId
    });
    if (result.error) throw new Error(result.error.message);
    revalidatePath(path);
  } catch (error) {
    finish("error", error instanceof Error ? error.message : "Unable to create adjustment.");
  }
  finish("notice", "Adjustment submitted for owner approval.");
}

export async function reviewWorkforceAdjustment(formData: FormData) {
  const decision = text(formData.get("decision"));
  const authorization = await requirePagePermission("workforce_adjustments", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!isCompanyOwner(authorization)) throw new Error("Only the company owner can approve or reject payroll adjustments.");
    if (authorization.readOnly) throw new Error('Preview mode cannot review an adjustment.');
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const id = text(formData.get("id"));
    const remarks = text(formData.get("review_remarks"));
    if (!id || !["approved", "rejected"].includes(decision)) throw new Error("Choose a valid review decision.");
    if (decision === "rejected" && !remarks) throw new Error("Rejection remarks are required.");
    const current = await supabaseAdmin.from("workforce_adjustments").select("id, workforce_id, external_reference, status, requested_by").eq("company_id", companyId).eq("id", id).maybeSingle();
    if (current.error) throw new Error(current.error.message);
    if (!current.data || !["draft", "pending"].includes(current.data.status)) throw new Error("This adjustment has already been reviewed.");
    if (current.data.requested_by === authorization.userId) throw new Error("Maker-checker control does not allow you to review your own adjustment request.");
    if (current.data.external_reference?.startsWith('MILEAGE:')) throw new Error('Open Mileage Claims to inspect distance evidence and record the decision.');
    const person=await supabaseAdmin.from('workforce').select('location_id').eq('company_id',companyId).eq('id',current.data.workforce_id).maybeSingle();
    if(person.error||!person.data||(!authorization.hasAllLocationAccess&&!authorization.locationScopeIds.includes(person.data.location_id)))throw new Error('Associate is outside your review scope.');
    const loss=current.data.external_reference?.startsWith('OPS-LOSS:');
    const postingDate=text(formData.get('review_posting_date'));
    if(loss&&decision==='approved'&&!isWorkforceDate(postingDate))throw new Error('Choose a valid payroll posting date for the loss.');
    const result = await supabaseAdmin.from("workforce_adjustments").update({
      ...(loss&&decision==='approved'?{effective_date:postingDate}:{}),
      status: decision,
      reviewed_by: authorization.userId,
      reviewed_at: new Date().toISOString(),
      review_remarks: remarks || null,
      updated_at: new Date().toISOString()
    }).eq("company_id", companyId).eq("id", id).in("status", ["draft", "pending"]).select("id").maybeSingle();
    if (result.error) throw new Error(result.error.message);
    if (!result.data) throw new Error("This adjustment was reviewed by another user. Refresh to see the latest status.");
    revalidatePath(path);
    revalidatePath("/delivery-network/earnings");
  } catch (error) {
    finish("error", error instanceof Error ? error.message : "Unable to review adjustment.");
  }
  finish("notice", `Adjustment ${decision}.`);
}
