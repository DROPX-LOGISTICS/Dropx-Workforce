"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { parsePaymentMethodInput } from "@/lib/payment-method-input";

function finish(result: { error?: string; notice?: string }) {
  cookies().set("dropx_payment_method_flash", JSON.stringify(result), {
    httpOnly: true, maxAge: 15, path: "/master/payment-methods", sameSite: "lax"
  });
  redirect("/master/payment-methods");
}

async function save(formData: FormData, editing: boolean) {
  const authorization = await requirePagePermission("payment_methods", editing ? "edit" : "add");
  const companyId = requireCompanyId(authorization);
  let errorMessage: string | undefined;
  try {
    if (!supabaseAdmin) throw new Error("Payment configuration is temporarily unavailable.");
    const input = parsePaymentMethodInput(formData, editing);
    const { error } = await supabaseAdmin.rpc("workforce_save_payment_method_v2", {
      p_company_id: companyId, p_method_id: input.id, p_code: input.code,
      p_name: input.name, p_field_ids: input.fieldIds, p_actor: authorization.userId,
      p_source_of_truth: input.sourceOfTruth, p_calculation_basis: input.calculationBasis
    });
    if (error) {
      if (error.code === "23505") throw new Error("That Method ID already exists. Choose a different ID.");
      if (error.code === "PGRST202") throw new Error("Payment configuration is being updated. Please retry shortly.");
      throw new Error(error.message);
    }
    for (const path of ["/master/payment-methods", "/provider-mapping", "/delivery-network/rate-mapping", "/delivery-network/associates"]) revalidatePath(path);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Unable to save payment method.";
  }
  finish(errorMessage ? { error: errorMessage } : { notice: editing ? "Payment method updated." : "Payment method created. Set associate rates in ID & Rate Mapping." });
}

export async function createPaymentMethod(formData: FormData) { return save(formData, false); }
export async function updatePaymentMethod(formData: FormData) { return save(formData, true); }

export async function deletePaymentMethod(formData: FormData) {
  const authorization = await requirePagePermission("payment_methods", "edit");
  const companyId = requireCompanyId(authorization);
  let errorMessage: string | undefined;
  try {
    if (!supabaseAdmin) throw new Error("Payment configuration is temporarily unavailable.");
    const { error } = await supabaseAdmin.rpc("workforce_delete_payment_method", { p_company_id: companyId, p_method_id: String(formData.get("id") ?? "") });
    if (error) throw new Error(error.code === "PGRST202" ? "Payment configuration is being updated. Please retry shortly." : error.message);
    revalidatePath("/master/payment-methods");
    revalidatePath("/delivery-network/rate-mapping");
  } catch (error) { errorMessage = error instanceof Error ? error.message : "Unable to delete payment method."; }
  finish(errorMessage ? { error: errorMessage } : { notice: "Unused payment method deleted." });
}
