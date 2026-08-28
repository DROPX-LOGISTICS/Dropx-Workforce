"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { firstDesignationBusinessCategory } from "@/lib/designation-business-categories";
import { writeEventLog } from "@/lib/event-log";
import { supabaseAdmin } from "@/lib/supabase-admin";

const routingPath = "/delivery-network/designation-routing";

function clean(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function required(value: FormDataEntryValue | null, label: string) {
  const text = clean(value);
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function routingRedirect(params: { error?: string; notice?: string }): never {
  cookies().set("dropx_workforce_designation_routing_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 30,
    path: routingPath,
    sameSite: "lax"
  });
  redirect(routingPath);
}

function isNextRedirectError(error: unknown) {
  return typeof (error as { digest?: unknown })?.digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT");
}

export async function saveDesignationRoute(formData: FormData) {
  const authorization = await requirePagePermission("designations", "edit");
  const companyId = requireCompanyId(authorization);

  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const designationId = required(formData.get("designation_id"), "Designation");
    const registerId = clean(formData.get("register_id"));
    const designationResult = await supabaseAdmin
      .from("designations")
      .select("id, designation_category:designation_categories!designations_designation_category_id_fkey(id, code, name, people_module, is_active)")
      .eq("id", designationId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (designationResult.error) throw new Error(designationResult.error.message);
    if (firstDesignationBusinessCategory(designationResult.data?.designation_category)?.people_module !== "delivery_network") {
      throw new Error("Only Workforce designations can be routed from Workforce Master.");
    }
    if (registerId) {
      const registerResult = await supabaseAdmin
        .from("workforce_register_master")
        .select("id, table_name, is_active")
        .eq("id", registerId)
        .eq("company_id", companyId)
        .maybeSingle();
      if (registerResult.error) throw new Error(registerResult.error.message);
      if (!registerResult.data?.is_active || !["workforce", "vendors"].includes(registerResult.data.table_name)) {
        throw new Error("Workforce designations can route only to Workforce or Vendors.");
      }
    }
    const registrationEnabled = Boolean(registerId && formData.has("registration_enabled"));
    const result = await supabaseAdmin.rpc("set_designation_register_route", {
      p_actor_user_id: authorization.userId,
      p_company_id: companyId,
      p_designation_id: designationId,
      p_reconcile: Boolean(registerId),
      p_register_id: registerId,
      p_registration_enabled: registrationEnabled
    });
    if (result.error) throw new Error(result.error.message);

    const payload = (result.data ?? {}) as {
      status?: string;
      reconciliation?: { moved?: number; retained?: number; failed?: number };
    };
    const reconciliation = payload.reconciliation ?? {};
    await writeEventLog({
      companyId,
      platform: "dashboard",
      eventCode: registerId ? "designation_register_route_saved" : "designation_register_route_unmapped",
      module: "workforce_master",
      action: "update",
      outcome: payload.status === "failed" ? "failed" : payload.status === "needs_review" ? "warning" : "success",
      actorUserId: authorization.userId,
      actorLabel: authorization.fullName,
      actorIdentifier: authorization.email,
      subjectType: "designation",
      subjectId: designationId,
      route: routingPath,
      method: "POST",
      metadata: {
        access_surface: "workforce",
        register_id: registerId,
        registration_enabled: registrationEnabled,
        reconciliation_status: payload.status ?? null,
        moved: reconciliation.moved ?? 0,
        retained: reconciliation.retained ?? 0,
        failed: reconciliation.failed ?? 0
      }
    });

    revalidatePath(routingPath);
    revalidatePath("/delivery-network/designations");
    revalidatePath("/delivery-network/associates");
    revalidatePath("/delivery-network/onboarding");
    revalidatePath("/delivery-network/lifecycle");
    if (!registerId) routingRedirect({ notice: "Designation left unmapped. New registrations are blocked." });
    routingRedirect({
      notice: `Route saved and records reconciled: ${reconciliation.moved ?? 0} moved, ${reconciliation.retained ?? 0} already in place, ${reconciliation.failed ?? 0} need review.`
    });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    routingRedirect({ error: error instanceof Error ? error.message : "Unable to save the designation route." });
  }
}

export async function updateRegisterMaster(formData: FormData) {
  const authorization = await requirePagePermission("designations", "edit");
  const companyId = requireCompanyId(authorization);

  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const registerId = required(formData.get("register_id"), "Register");
    const name = required(formData.get("name"), "Register name");
    const current = await supabaseAdmin
      .from("workforce_register_master")
      .select("id, code, name, table_name, is_active")
      .eq("id", registerId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (current.error) throw new Error(current.error.message);
    if (!current.data) throw new Error("Register was not found.");
    if (!["workforce", "vendors"].includes(current.data.table_name)) {
      throw new Error("People registers are managed by onboarding type and cannot be changed from Workforce Master.");
    }

    const update = await supabaseAdmin
      .from("workforce_register_master")
      .update({
        name,
        is_active: formData.has("is_active"),
        updated_at: new Date().toISOString(),
        updated_by: authorization.userId
      })
      .eq("id", registerId)
      .eq("company_id", companyId);
    if (update.error) throw new Error(update.error.message);

    await writeEventLog({
      companyId,
      platform: "dashboard",
      eventCode: "workforce_register_master_updated",
      module: "workforce_master",
      action: "update",
      outcome: "success",
      actorUserId: authorization.userId,
      actorLabel: authorization.fullName,
      actorIdentifier: authorization.email,
      subjectType: "workforce_register",
      subjectId: registerId,
      subjectCode: current.data.code,
      subjectLabel: name,
      route: routingPath,
      method: "POST",
      metadata: {
        access_surface: "workforce",
        previous_name: current.data.name,
        is_active: formData.has("is_active")
      }
    });

    revalidatePath(routingPath);
    routingRedirect({ notice: "Register Master updated." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    routingRedirect({ error: error instanceof Error ? error.message : "Unable to update Register Master." });
  }
}
