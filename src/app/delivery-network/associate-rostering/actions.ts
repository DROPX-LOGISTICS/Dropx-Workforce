"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isWorkforceDate } from "@/lib/workforce-earnings";

export async function assignWorkforceShift(form: FormData) {
  const authorization = await requirePagePermission("workforce_activity", "edit");
  const companyId = requireCompanyId(authorization);
  const from = String(form.get("effective_from") ?? "");
  const to = String(form.get("effective_to") ?? "");
  const path = "/delivery-network/associate-rostering";
  let error: string | null = null;
  try {
    if (!supabaseAdmin) throw new Error("Roster storage is unavailable.");
    if (!isWorkforceDate(from) || !isWorkforceDate(to) || from > to) throw new Error("Choose a valid shift period.");
    const result = await supabaseAdmin.rpc("workforce_assign_shift", {
      p_company: companyId, p_actor: authorization.userId,
      p_workforce: String(form.get("workforce_id") ?? ""), p_shift: String(form.get("shift_id") ?? ""),
      p_from: from, p_to: to, p_notes: String(form.get("notes") ?? "").trim().slice(0, 500) || null,
      p_locations: authorization.hasAllLocationAccess ? null : authorization.locationScopeIds
    });
    if (result.error) throw new Error(result.error.message);
    revalidatePath(path);
  } catch (cause) { error = cause instanceof Error ? cause.message : "Unable to assign shift."; }
  const params = new URLSearchParams({ date: isWorkforceDate(from) ? from : "", [error ? "error" : "notice"]: error ?? "Shift assignment saved." });
  redirect(`${path}?${params}`);
}
