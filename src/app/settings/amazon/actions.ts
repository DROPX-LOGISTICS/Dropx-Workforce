"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isCompanyOwner, requirePagePermission } from "@/lib/authorization";
import { amazonPortalDefinitions, amazonTaskDefinitions, type AmazonPortalCode } from "@/lib/amazon-connectors";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

function clean(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function integerValue(value: FormDataEntryValue | null, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function amazonSettingsRedirect(params: { error?: string; notice?: string }): never {
  cookies().set("dropx_amazon_connector_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 20,
    path: "/settings",
    sameSite: "lax"
  });
  redirect("/settings/amazon");
}

function isSecretPlaceholder(value: string | null) {
  return Boolean(value && /^\*+$/.test(value));
}

export async function saveAmazonConnector(formData: FormData) {
  const authorization = await requirePagePermission("amazon_connector", "edit");
  const companyId = requireCompanyId(authorization);

  try {
    if (!isCompanyOwner(authorization)) throw new Error("Only the owner can save Amazon portal credentials.");
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const portalCode = clean(formData.get("portal_code")) as AmazonPortalCode | null;
    const definition = amazonPortalDefinitions.find((portal) => portal.code === portalCode);
    if (!portalCode || !definition) throw new Error("Select a valid Amazon portal.");

    const authMode = clean(formData.get("auth_mode")) ?? "credential_login";
    const isEnabled = formData.get("is_enabled") === "on";
    const syncEnabled = formData.get("sync_enabled") === "on";
    const username = clean(formData.get("username"));
    const password = clean(formData.get("password"));
    const mfaSecret = clean(formData.get("mfa_secret"));
    const baseUrl = clean(formData.get("base_url")) ?? definition.baseUrl;
    const loginUrl = clean(formData.get("login_url")) ?? definition.loginUrl;
    const syncInterval = Math.min(Math.max(integerValue(formData.get("sync_interval_minutes"), 30), 5), 1440);
    const timezone = clean(formData.get("timezone")) ?? "Asia/Kolkata";

    const current = await supabaseAdmin
      .from("amazon_connectors")
      .select("id, password_secret_id, mfa_secret_id")
      .eq("company_id", companyId)
      .eq("portal_code", portalCode)
      .maybeSingle();
    if (current.error) throw new Error(current.error.message);

    if (isEnabled && authMode === "credential_login" && !username) {
      throw new Error(`${definition.shortName} username is required before enabling this connector.`);
    }
    if (isEnabled && authMode === "credential_login" && !password && !current.data?.password_secret_id) {
      throw new Error(`${definition.shortName} password is required before enabling this connector.`);
    }

    const { data, error } = await supabaseAdmin
      .from("amazon_connectors")
      .upsert({
        company_id: companyId,
        portal_code: portalCode,
        portal_name: clean(formData.get("portal_name")) ?? definition.name,
        base_url: baseUrl,
        login_url: loginUrl,
        username,
        auth_mode: authMode,
        is_enabled: isEnabled,
        sync_enabled: syncEnabled,
        sync_interval_minutes: syncInterval,
        timezone,
        status: isEnabled ? "Ready" : "Paused",
        notes: clean(formData.get("notes")),
        updated_by: authorization.userId
      }, { onConflict: "company_id,portal_code" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    if (password && !isSecretPlaceholder(password)) {
      const result = await supabaseAdmin.rpc("set_amazon_connector_password", {
        connector_uuid: data.id,
        secret_value: password
      });
      if (result.error) throw new Error(result.error.message);
    }

    if (mfaSecret && !isSecretPlaceholder(mfaSecret)) {
      const result = await supabaseAdmin.rpc("set_amazon_connector_mfa_secret", {
        connector_uuid: data.id,
        secret_value: mfaSecret
      });
      if (result.error) throw new Error(result.error.message);
    }

    const taskDefinitions = amazonTaskDefinitions[portalCode];
    const enabledTaskCodes = new Set(formData.getAll("enabled_tasks").map(String));
    const taskRows = taskDefinitions.map((task) => ({
      company_id: companyId,
      connector_id: data.id,
      task_code: task.code,
      task_name: task.name,
      source_url: clean(formData.get(`task_url_${task.code}`)) ?? task.sourceUrl,
      is_enabled: syncEnabled && enabledTaskCodes.has(task.code),
      sync_interval_minutes: Math.min(Math.max(integerValue(formData.get(`task_interval_${task.code}`), task.interval), 5), 1440),
      next_run_at: syncEnabled && enabledTaskCodes.has(task.code) ? new Date().toISOString() : null,
      updated_by: authorization.userId
    }));

    const taskResult = await supabaseAdmin
      .from("amazon_connector_tasks")
      .upsert(taskRows, { onConflict: "company_id,connector_id,task_code" });
    if (taskResult.error) throw new Error(taskResult.error.message);

    revalidatePath("/settings");
    revalidatePath("/settings/amazon");
  } catch (error) {
    amazonSettingsRedirect({ error: error instanceof Error ? error.message : "Unable to save Amazon connector." });
  }

  amazonSettingsRedirect({ notice: "Amazon connector saved." });
}
