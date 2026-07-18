"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId, withCompany } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

function clean(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

function required(value: FormDataEntryValue | null, field: string) {
  const text = clean(value);
  if (!text) {
    throw new Error(`${field} is required`);
  }
  return text;
}

function paymentMethodRedirect(params: { error?: string; notice?: string }) {
  cookies().set("dropx_payment_method_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 15,
    path: "/master/payment-methods",
    sameSite: "lax"
  });
  redirect("/master/payment-methods");
}

export async function createPaymentMethod(formData: FormData) {
  const authorization = await requirePagePermission("payment_methods", "add");
  const companyId = requireCompanyId(authorization);
  if (!supabaseAdmin) {
    throw new Error("Supabase service role key is not configured");
  }

  const code = required(formData.get("code"), "Method ID").toUpperCase();
  const name = required(formData.get("name"), "Method name");
  const componentCount = Number(formData.get("component_count") ?? 0);
  const components = Array.from({ length: componentCount }, (_, index) => {
    const type = clean(formData.get(`components[${index}][type]`));
    const componentCode = clean(formData.get(`components[${index}][code]`))?.toUpperCase();
    const label = clean(formData.get(`components[${index}][label]`));
    const paySchedule = clean(formData.get(`components[${index}][pay_schedule]`));
    if (!type && !componentCode && !label) return null;
    if (type !== "amount" && type !== "production") {
      throw new Error("Each component must be Amount or Production.");
    }
    if (!componentCode) {
      throw new Error("Each component needs a Field ID.");
    }
    if (!label) {
      throw new Error("Each component needs a field label.");
    }
    if (type === "amount" && !["per_hour", "per_day", "per_month"].includes(paySchedule ?? "")) {
      throw new Error(`${label} needs a Pay Schedule.`);
    }
    return {
      component_code: componentCode,
      component_type: type,
      label,
      pay_schedule: type === "amount" ? paySchedule : null,
      sort_order: index + 1,
      is_active: true
    };
  }).filter(Boolean) as Array<{
    component_code: string;
    component_type: "amount" | "production";
    label: string;
    pay_schedule: string | null;
    sort_order: number;
    is_active: boolean;
  }>;

  if (!components.length) {
    throw new Error("Add at least one payment field.");
  }

  const { data: method, error } = await supabaseAdmin
    .from("payment_methods")
    .insert(withCompany({ code, name, is_active: true }, companyId))
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  const { error: componentError } = await supabaseAdmin
    .from("payment_method_components")
    .insert(components.map((component) => ({
      ...component,
      payment_method_id: method.id
    })));

  if (componentError) throw new Error(componentError.message);

  revalidatePath("/master/payment-methods");
}

function parseComponents(formData: FormData) {
  const componentCount = Number(formData.get("component_count") ?? 0);
  const components = Array.from({ length: componentCount }, (_, index) => {
    const id = clean(formData.get(`components[${index}][id]`));
    const type = clean(formData.get(`components[${index}][type]`));
    const componentCode = clean(formData.get(`components[${index}][code]`))?.toUpperCase();
    const label = clean(formData.get(`components[${index}][label]`));
    const paySchedule = clean(formData.get(`components[${index}][pay_schedule]`));
    if (type !== "amount" && type !== "production") throw new Error("Each component must be Amount or Production.");
    if (!componentCode) throw new Error("Each component needs a Field ID.");
    if (!label) throw new Error("Each component needs a field label.");
    if (type === "amount" && !["per_hour", "per_day", "per_month"].includes(paySchedule ?? "")) {
      throw new Error(`${label} needs a Pay Schedule.`);
    }
    return {
      id,
      component_code: componentCode,
      component_type: type,
      label,
      pay_schedule: type === "amount" ? paySchedule : null,
      sort_order: index + 1,
      is_active: true
    };
  });
  if (!components.length) throw new Error("Add at least one payment field.");
  return components;
}

export async function updatePaymentMethod(formData: FormData) {
  const authorization = await requirePagePermission("payment_methods", "edit");
  const companyId = requireCompanyId(authorization);
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured");
  const admin = supabaseAdmin;

  const id = required(formData.get("id"), "Payment method");
  const code = required(formData.get("code"), "Method ID").toUpperCase();
  const name = required(formData.get("name"), "Method name");
  const components = parseComponents(formData);

  const existingMethod = await admin
    .from("payment_methods")
    .select("id")
    .eq("id", id)
    .eq("company_id", companyId)
    .single();
  if (existingMethod.error) throw new Error("Payment method not found for this company.");

  const { error: methodError } = await admin
    .from("payment_methods")
    .update({ code, name, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("company_id", companyId);
  if (methodError) throw new Error(methodError.message);

  const retainedIds = await Promise.all(components.map(async (component) => {
    const payload = {
      payment_method_id: id,
      component_code: component.component_code,
      component_type: component.component_type,
      label: component.label,
      pay_schedule: component.pay_schedule,
      sort_order: component.sort_order,
      is_active: true,
      updated_at: new Date().toISOString()
    };

    if (component.id) {
      const { error } = await admin.from("payment_method_components").update(payload).eq("id", component.id).eq("payment_method_id", id);
      if (error) throw new Error(error.message);
      return component.id;
    } else {
      const { data, error } = await admin.from("payment_method_components").insert(payload).select("id").single();
      if (error) throw new Error(error.message);
      return data.id as string;
    }
  }));

  const existing = await admin.from("payment_method_components").select("id").eq("payment_method_id", id);
  if (existing.error) throw new Error(existing.error.message);
  const removedIds = (existing.data ?? []).map((item) => item.id).filter((componentId) => !retainedIds.includes(componentId));
  if (removedIds.length) {
    const { error } = await admin.from("payment_method_components").delete().in("id", removedIds);
    if (error) throw new Error(error.message);
  }

  revalidatePath("/master/payment-methods");
  revalidatePath("/provider-mapping");
  redirect("/master/payment-methods");
}

export async function deletePaymentMethod(formData: FormData) {
  const authorization = await requirePagePermission("payment_methods", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured");
    const id = required(formData.get("id"), "Payment method");

    const usage = await supabaseAdmin
      .from("field_executive_provider_mappings")
      .select("id", { count: "exact", head: true })
      .eq("payment_method_id", id)
      .eq("company_id", companyId);
    if (usage.error) throw new Error(usage.error.message);
    if ((usage.count ?? 0) > 0) {
      throw new Error(`This payment method is used in ${usage.count} mapping${usage.count === 1 ? "" : "s"} and cannot be deleted.`);
    }

    const { error } = await supabaseAdmin.from("payment_methods").delete().eq("id", id).eq("company_id", companyId);
    if (error) throw new Error(error.message);
    revalidatePath("/master/payment-methods");
  } catch (error) {
    paymentMethodRedirect({ error: error instanceof Error ? error.message : "Unable to delete payment method." });
  }

  paymentMethodRedirect({ notice: "Payment method deleted." });
}
