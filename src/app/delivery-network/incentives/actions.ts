"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission, type AuthorizationContext } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { workforceToday, isWorkforceDate } from "@/lib/workforce-earnings";

const path = "/delivery-network/incentives";

function text(value: FormDataEntryValue | null) { return String(value ?? "").trim(); }
function required(value: FormDataEntryValue | null, label: string) { const result = text(value); if (!result) throw new Error(`${label} is required.`); return result; }
function number(value: FormDataEntryValue | null, label: string) { const parsed = Number(text(value) || 0); if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} must be zero or positive.`); return parsed; }
function finish(kind: "notice" | "error", message: string): never { redirect(`${path}?${kind}=${encodeURIComponent(message)}`); }

function requireCampaignLocationScope(authorization: AuthorizationContext, stationId: string | null) {
  if (authorization.hasAllLocationAccess) return;
  if (!stationId || !authorization.locationScopeIds.includes(stationId)) {
    throw new Error("Station-scoped users can manage incentive campaigns only for a station in their own access scope.");
  }
}

async function validateScope(companyId: string, providerId: string | null, stationId: string | null, designationId: string | null) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const [provider, station, designation] = await Promise.all([
    providerId ? supabaseAdmin.from("providers").select("id").eq("company_id", companyId).eq("id", providerId).maybeSingle() : Promise.resolve({ data: true, error: null }),
    stationId ? supabaseAdmin.from("stations").select("id").eq("company_id", companyId).eq("id", stationId).maybeSingle() : Promise.resolve({ data: true, error: null }),
    designationId ? supabaseAdmin.from("designations").select("id").eq("company_id", companyId).eq("id", designationId).maybeSingle() : Promise.resolve({ data: true, error: null })
  ]);
  if (provider.error || !provider.data) throw new Error("Provider was not found for this company.");
  if (station.error || !station.data) throw new Error("Station was not found for this company.");
  if (designation.error || !designation.data) throw new Error("Designation was not found for this company.");
}

export async function createIncentiveCampaign(formData: FormData) {
  const authorization = await requirePagePermission("workforce_incentives", "add");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const code = required(formData.get("code"), "Campaign code").toUpperCase().replace(/[^A-Z0-9_-]+/g, "_");
    const name = required(formData.get("name"), "Campaign name");
    const metric = required(formData.get("metric"), "Metric");
    const calculationType = required(formData.get("calculation_type"), "Calculation");
    const effectiveFrom = required(formData.get("effective_from"), "Effective from");
    const effectiveTo = required(formData.get("effective_to"), "Effective to");
    if (!isWorkforceDate(effectiveFrom) || !isWorkforceDate(effectiveTo)) throw new Error("Use valid campaign dates.");
    if (effectiveTo < effectiveFrom) throw new Error("Effective to cannot be before effective from.");
    if (!["total_delivery", "total_activity", "amazon_delivery", "swa_delivery", "c_return", "mfn"].includes(metric)) throw new Error("Choose a valid incentive metric.");
    if (!["flat_threshold", "per_unit_above_threshold"].includes(calculationType)) throw new Error("Choose a valid incentive calculation.");
    const providerId = text(formData.get("provider_id")) || null;
    const stationId = text(formData.get("station_id")) || null;
    const designationId = text(formData.get("designation_id")) || null;
    const thresholdValue = number(formData.get("threshold_value"), "Threshold");
    const rateValue = number(formData.get("rate_value"), "Per-unit reward");
    const flatAmount = number(formData.get("flat_amount"), "Flat reward");
    if (calculationType === "flat_threshold" && flatAmount <= 0) throw new Error("Flat-threshold campaigns require a flat reward greater than zero.");
    if (calculationType === "per_unit_above_threshold" && rateValue <= 0) throw new Error("Per-unit campaigns require a per-unit reward greater than zero.");
    requireCampaignLocationScope(authorization, stationId);
    await validateScope(companyId, providerId, stationId, designationId);
    const result = await supabaseAdmin.from("workforce_incentive_campaigns").insert({
      company_id: companyId,
      code,
      name,
      provider_id: providerId,
      station_id: stationId,
      designation_id: designationId,
      metric,
      calculation_type: calculationType,
      threshold_value: thresholdValue,
      rate_value: rateValue,
      flat_amount: flatAmount,
      maximum_amount: text(formData.get("maximum_amount")) ? number(formData.get("maximum_amount"), "Maximum reward") : null,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      status: "draft",
      description: text(formData.get("description")) || null,
      created_by: authorization.userId
    });
    if (result.error) throw new Error(result.error.message);
    revalidatePath(path);
  } catch (error) {
    finish("error", error instanceof Error ? error.message : "Unable to create incentive campaign.");
  }
  finish("notice", "Incentive campaign created as a draft.");
}

export async function changeIncentiveStatus(formData: FormData) {
  const status = text(formData.get("status"));
  const authorization = await requirePagePermission("workforce_incentives", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const id = required(formData.get("id"), "Campaign");
    if (!["active", "paused", "closed"].includes(status)) throw new Error("Choose a valid campaign action.");
    const current = await supabaseAdmin.from("workforce_incentive_campaigns").select("id, status, effective_from, effective_to, station_id").eq("company_id", companyId).eq("id", id).maybeSingle();
    if (current.error) throw new Error(current.error.message);
    if (!current.data) throw new Error("Campaign was not found.");
    requireCampaignLocationScope(authorization, current.data.station_id);
    if (current.data.status === "closed") throw new Error("Closed campaigns cannot be reopened.");
    if (status === "active" && current.data.status !== "draft") throw new Error("Create a new draft campaign to resume incentives without rewriting history.");
    const now = new Date().toISOString();
    const payload: Record<string, unknown> = { status, updated_at: now };
    if (["paused", "closed"].includes(status) && current.data.status !== "draft") {
      const today = workforceToday();
      payload.effective_to = current.data.effective_to && current.data.effective_to < today ? current.data.effective_to : today;
      if (current.data.effective_from > today) throw new Error("This policy starts in the future. Contact the owner to replace it before activation.");
    }
    if (status === "active") Object.assign(payload, { approved_by: authorization.userId, approved_at: now });
    const result = await supabaseAdmin.from("workforce_incentive_campaigns").update(payload)
      .eq("company_id", companyId).eq("id", id).eq("status", current.data.status).select("id").maybeSingle();
    if (result.error) throw new Error(result.error.message);
    if (!result.data) throw new Error("The campaign changed while you were reviewing it. Refresh and try again.");
    revalidatePath(path);
    revalidatePath("/delivery-network/earnings");
  } catch (error) {
    finish("error", error instanceof Error ? error.message : "Unable to update incentive campaign.");
  }
  finish("notice", `Campaign marked ${status}.`);
}
