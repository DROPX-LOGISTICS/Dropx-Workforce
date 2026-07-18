"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId, withCompany } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

function clean(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

function required(value: FormDataEntryValue | null, field: string) {
  const text = clean(value);
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function normalizeIfsc(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export async function createPaymentBank(formData: FormData) {
  const authorization = await requirePagePermission("master_payment_banks", "add");
  const companyId = requireCompanyId(authorization);
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured");

  const payload = {
    bank_code: required(formData.get("bank_code"), "Bank").toUpperCase(),
    display_name: required(formData.get("display_name"), "Display name"),
    account_no: required(formData.get("account_no"), "Bank account no"),
    ifsc: normalizeIfsc(required(formData.get("ifsc"), "IFSC")),
    is_active: true
  };

  const { error } = await supabaseAdmin.from("payment_banks").insert(withCompany(payload, companyId));
  if (error) throw new Error(error.message);

  revalidatePath("/master/payment-banks");
}

export async function updatePaymentBank(formData: FormData) {
  const authorization = await requirePagePermission("master_payment_banks", "edit");
  const companyId = requireCompanyId(authorization);
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured");

  const id = required(formData.get("id"), "Payment bank");
  const payload = {
    bank_code: required(formData.get("bank_code"), "Bank").toUpperCase(),
    display_name: required(formData.get("display_name"), "Display name"),
    account_no: required(formData.get("account_no"), "Bank account no"),
    ifsc: normalizeIfsc(required(formData.get("ifsc"), "IFSC")),
    is_active: formData.get("is_active") !== "false",
    updated_at: new Date().toISOString()
  };

  const { error } = await supabaseAdmin
    .from("payment_banks")
    .update(payload)
    .eq("id", id)
    .eq("company_id", companyId);
  if (error) throw new Error(error.message);

  revalidatePath("/master/payment-banks");
  redirect("/master/payment-banks");
}
