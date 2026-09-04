"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission, type AuthorizationContext } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { workforceToday, isWorkforceDate } from "@/lib/workforce-earnings";

const path = "/delivery-network/rate-cards";

function text(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function required(value: FormDataEntryValue | null, label: string) {
  const valueText = text(value);
  if (!valueText) throw new Error(`${label} is required.`);
  return valueText;
}

function numeric(value: FormDataEntryValue | null, label: string) {
  const valueText = text(value);
  if (!valueText) return 0;
  const number = Number(valueText);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be zero or a positive amount.`);
  return number;
}

function finish(kind: "notice" | "error", message: string): never {
  redirect(`${path}?${kind}=${encodeURIComponent(message)}`);
}

function requireRateCardLocationScope(authorization: AuthorizationContext, stationId: string | null) {
  if (authorization.hasAllLocationAccess) return;
  if (!stationId || !authorization.locationScopeIds.includes(stationId)) {
    throw new Error("Station-scoped users can manage rate cards only for a station in their own access scope.");
  }
}

async function validateScope(companyId: string, providerId: string, stationId: string | null, designationId: string | null) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const [provider, station, designation] = await Promise.all([
    supabaseAdmin.from("providers").select("id").eq("company_id", companyId).eq("id", providerId).maybeSingle(),
    stationId ? supabaseAdmin.from("stations").select("id").eq("company_id", companyId).eq("id", stationId).maybeSingle() : Promise.resolve({ data: true, error: null }),
    designationId ? supabaseAdmin.from("designations").select("id").eq("company_id", companyId).eq("id", designationId).maybeSingle() : Promise.resolve({ data: true, error: null })
  ]);
  if (provider.error || !provider.data) throw new Error("Provider was not found for this company.");
  if (station.error || !station.data) throw new Error("Station was not found for this company.");
  if (designation.error || !designation.data) throw new Error("Designation was not found for this company.");
}

export async function saveRateCard(formData: FormData) {
  const id = text(formData.get("id"));
  const authorization = await requirePagePermission("workforce_rate_cards", id ? "edit" : "add");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const name = required(formData.get("name"), "Rate card name");
    const providerId = required(formData.get("provider_id"), "Provider");
    const stationId = text(formData.get("station_id")) || null;
    const designationId = text(formData.get("designation_id")) || null;
    const payType = required(formData.get("pay_type"), "Payment type");
    const effectiveFrom = required(formData.get("effective_from"), "Effective from");
    const effectiveTo = text(formData.get("effective_to")) || null;
    if (!isWorkforceDate(effectiveFrom) || (effectiveTo && !isWorkforceDate(effectiveTo))) throw new Error("Use a valid effective date.");
    if (effectiveTo && effectiveTo < effectiveFrom) throw new Error("Effective to cannot be before effective from.");
    if (!["per_shipment", "per_activity", "fixed_daily", "fixed_monthly", "hybrid"].includes(payType)) throw new Error("Choose a valid payment type.");
    const payload = {
      company_id: companyId,
      name,
      provider_id: providerId,
      station_id: stationId,
      designation_id: designationId,
      pay_type: payType,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      delivery_rate: numeric(formData.get("delivery_rate"), "Delivery rate"),
      return_rate: numeric(formData.get("return_rate"), "Return rate"),
      mfn_rate: numeric(formData.get("mfn_rate"), "MFN rate"),
      mfn_return_rate: numeric(formData.get("mfn_return_rate"), "MFN return rate"),
      fuel_rate: numeric(formData.get("fuel_rate"), "Fuel rate"),
      fixed_amount: numeric(formData.get("fixed_amount"), "Fixed amount"),
      guarantee_amount: numeric(formData.get("guarantee_amount"), "Guarantee amount"),
      notes: text(formData.get("notes")) || null,
      updated_at: new Date().toISOString()
    };
    if (["fixed_daily", "fixed_monthly"].includes(payType) && payload.fixed_amount <= 0) throw new Error("Fixed payment types require a fixed amount.");
    if (["per_shipment", "per_activity", "hybrid"].includes(payType) && payload.delivery_rate <= 0) throw new Error("This payment type requires a delivery/activity rate.");
    requireRateCardLocationScope(authorization, stationId);
    await validateScope(companyId, providerId, stationId, designationId);

    if (id) {
      const existing = await supabaseAdmin.from("workforce_rate_cards").select("id, status, station_id").eq("company_id", companyId).eq("id", id).maybeSingle();
      if (existing.error) throw new Error(existing.error.message);
      if (!existing.data) throw new Error("Rate card was not found.");
      if (existing.data.status !== "draft") throw new Error("Active or historical rate cards are immutable. Close it and create a new version.");
      requireRateCardLocationScope(authorization, existing.data.station_id);
      const result = await supabaseAdmin.from("workforce_rate_cards").update(payload).eq("company_id", companyId).eq("id", id).eq("status", "draft").select("id").maybeSingle();
      if (!result.error && !result.data) throw new Error("This version changed during editing. Refresh before saving.");
      if (result.error) throw new Error(result.error.message);
    } else {
      const result = await supabaseAdmin.from("workforce_rate_cards").insert({ ...payload, status: "draft", created_by: authorization.userId });
      if (result.error) throw new Error(result.error.message);
    }
    revalidatePath(path);
  } catch (error) {
    finish("error", error instanceof Error ? error.message : "Unable to save rate card.");
  }
  finish("notice", id ? "Draft rate card updated." : "Draft rate card created. Activate it after review.");
}

export async function changeRateCardStatus(formData: FormData) {
  const id = text(formData.get("id"));
  const status = text(formData.get("status"));
  const authorization = await requirePagePermission("workforce_rate_cards", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    if (!id || !["active", "paused", "closed"].includes(status)) throw new Error("Choose a valid rate card action.");
    const current = await supabaseAdmin.from("workforce_rate_cards").select("id, provider_id, station_id, designation_id, effective_from, effective_to, status").eq("company_id", companyId).eq("id", id).maybeSingle();
    if (current.error) throw new Error(current.error.message);
    if (!current.data) throw new Error("Rate card was not found.");
    requireRateCardLocationScope(authorization, current.data.station_id);
    if (current.data.status === "closed") throw new Error("A closed rate card cannot be reopened.");
    if (status === "active" && current.data.status !== "draft") throw new Error("Create a new draft version to resume this policy. Historical periods remain preserved.");
    if (status === "active") {
      let overlapQuery = supabaseAdmin.from("workforce_rate_cards").select("id, name").eq("company_id", companyId).eq("provider_id", current.data.provider_id).not("approved_at", "is", null).neq("id", id)
        .lte("effective_from", current.data.effective_to ?? "9999-12-31").or(`effective_to.is.null,effective_to.gte.${current.data.effective_from}`).limit(1);
      overlapQuery = current.data.station_id ? overlapQuery.eq("station_id", current.data.station_id) : overlapQuery.is("station_id", null);
      overlapQuery = current.data.designation_id ? overlapQuery.eq("designation_id", current.data.designation_id) : overlapQuery.is("designation_id", null);
      const overlap = await overlapQuery;
      if (overlap.error) throw new Error(overlap.error.message);
      if (overlap.data?.length) throw new Error(`This scope overlaps active rate card ${overlap.data[0].name}. Choose a period after that version ends to preserve its history.`);
    }
    const now = new Date().toISOString();
    const payload: Record<string, unknown> = { status, updated_at: now };
    if (["paused", "closed"].includes(status) && current.data.status !== "draft") {
      const today = workforceToday();
      payload.effective_to = current.data.effective_to && current.data.effective_to < today ? current.data.effective_to : today;
      if (current.data.effective_from > today) throw new Error("This policy starts in the future. Contact the owner to replace it before activation.");
    }
    if (status === "active") Object.assign(payload, { approved_by: authorization.userId, approved_at: now });
    const result = await supabaseAdmin.from("workforce_rate_cards").update(payload)
      .eq("company_id", companyId).eq("id", id).eq("status", current.data.status).select("id").maybeSingle();
    if (result.error) throw new Error(result.error.message);
    if (!result.data) throw new Error("The rate card changed while you were reviewing it. Refresh and try again.");
    revalidatePath(path);
    revalidatePath("/delivery-network/earnings");
  } catch (error) {
    finish("error", error instanceof Error ? error.message : "Unable to update rate card.");
  }
  finish("notice", `Rate card marked ${status}.`);
}
