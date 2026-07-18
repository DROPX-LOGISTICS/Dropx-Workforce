"use server";

import { revalidatePath } from "next/cache";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId, withCompany } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

function clean(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

export async function savePaymentApprovalFlow(formData: FormData) {
  const authorization = await requirePagePermission("payment_settings", "edit");
  const companyId = requireCompanyId(authorization);
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured");

  const stepCount = Number(formData.get("step_count") ?? 0);
  const steps = Array.from({ length: stepCount }, (_, index) => clean(formData.get(`steps[${index}][role_id]`)))
    .filter(Boolean)
    .map((roleId, index, list) => withCompany({
      role_id: roleId,
      step_order: index + 1,
      is_final: index === list.length - 1
    }, companyId));

  const { error: deleteError } = await supabaseAdmin
    .from("payment_approval_flows")
    .delete()
    .eq("company_id", companyId);
  if (deleteError) throw new Error(deleteError.message);

  if (steps.length) {
    const { error } = await supabaseAdmin.from("payment_approval_flows").insert(steps);
    if (error) throw new Error(error.message);
  }

  revalidatePath("/settings/payments");
}
