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

function amazonWorkerWarmupUrl(rawUrl: string | undefined) {
  const value = rawUrl?.trim();
  if (!value) throw new Error("Amazon portal worker URL is missing. Set OPS_PORTAL_WORKER_URL in Vercel and the worker host.");

  const url = new URL(value);
  if (url.pathname.endsWith("/run")) {
    url.pathname = url.pathname.replace(/\/run$/, "/warmup");
  } else if (url.pathname.endsWith("/")) {
    url.pathname += "warmup";
  } else {
    url.pathname += "/warmup";
  }
  return url.toString();
}

async function readConnectorSecret(connectorId: string, rpcName: "get_amazon_connector_password" | "get_amazon_connector_mfa_secret") {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const result = await supabaseAdmin.rpc(rpcName, { connector_uuid: connectorId });
  if (result.error) throw new Error(result.error.message);
  return typeof result.data === "string" ? result.data : null;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
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
      last_status: syncEnabled && enabledTaskCodes.has(task.code) ? "Ready" : "Paused",
      last_message: syncEnabled && enabledTaskCodes.has(task.code) ? "Ready for portal worker checks." : "Task disabled.",
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

export async function warmupAmazonPortalSession(formData: FormData) {
  const authorization = await requirePagePermission("amazon_connector", "edit");
  const companyId = requireCompanyId(authorization);

  try {
    if (!isCompanyOwner(authorization)) throw new Error("Only the owner can warm up Amazon portal sessions.");
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const portalCode = clean(formData.get("portal_code")) as AmazonPortalCode | null;
    const definition = amazonPortalDefinitions.find((portal) => portal.code === portalCode);
    if (!portalCode || !definition) throw new Error("Select a valid Amazon portal.");

    const connectorResult = await supabaseAdmin
      .from("amazon_connectors")
      .select("id, company_id, portal_code, base_url, login_url, username, auth_mode, is_enabled, status, password_secret_id, mfa_secret_id")
      .eq("company_id", companyId)
      .eq("portal_code", portalCode)
      .maybeSingle();
    if (connectorResult.error) throw new Error(connectorResult.error.message);

    const connector = connectorResult.data;
    if (!connector) throw new Error(`Save ${definition.shortName} credentials first.`);
    if (!connector.is_enabled) throw new Error(`Enable ${definition.shortName} before warming up the worker session.`);
    if (!connector.username) throw new Error(`${definition.shortName} username is missing.`);

    const password = connector.password_secret_id
      ? await readConnectorSecret(connector.id, "get_amazon_connector_password")
      : null;
    if (!password) throw new Error(`${definition.shortName} password is missing. Re-enter password and save ${definition.shortName} first.`);

    const mfaSecret = connector.mfa_secret_id
      ? await readConnectorSecret(connector.id, "get_amazon_connector_mfa_secret")
      : null;

    const workerUrl = amazonWorkerWarmupUrl(process.env.OPS_PORTAL_WORKER_URL);
    const workerSecret = process.env.OPS_PORTAL_WORKER_SECRET || "";
    const response = await fetchWithTimeout(workerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(workerSecret ? { Authorization: `Bearer ${workerSecret}` } : {})
      },
      body: JSON.stringify({
        company_id: companyId,
        portal_code: portalCode,
        portal: portalCode,
        login_url: connector.login_url || definition.loginUrl,
        base_url: connector.base_url || definition.baseUrl,
        username: connector.username,
        password,
        mfa_secret: mfaSecret || ""
      }),
      cache: "no-store"
    }, 240000);

    const workerResult = await response.json().catch(() => ({})) as {
      error?: string;
      status?: string;
      summary?: string;
    };
    if (!response.ok) {
      throw new Error(workerResult?.error || workerResult?.summary || `${definition.shortName} worker returned ${response.status}.`);
    }

    const status = String(workerResult?.status || "");
    const summary = String(workerResult?.summary || "");
    const workerApprovalHelp =
      `Amazon needs approval inside the ${definition.shortName} worker browser. Your Chrome login cannot be reused by the worker. This is separate from bio.dropxlogistics.com attendance. Click Login worker once, approve Amazon/TOTP/captcha in that worker session, then retry sync/check.`;
    if (status === "Ready") {
      await supabaseAdmin
        .from("amazon_connectors")
        .update({
          status: "Ready",
          last_checked_at: new Date().toISOString(),
          last_success_at: new Date().toISOString(),
          last_error_message: null,
          updated_by: authorization.userId
        })
        .eq("id", connector.id);
      revalidatePath("/settings");
      revalidatePath("/settings/amazon");
      amazonSettingsRedirect({ notice: summary || `${definition.shortName} worker session warmed up and saved.` });
    }

    await supabaseAdmin
      .from("amazon_connectors")
      .update({
        status: status || "Manual Review",
        last_checked_at: new Date().toISOString(),
        last_error_message: summary || workerApprovalHelp,
        updated_by: authorization.userId
      })
      .eq("id", connector.id);
    revalidatePath("/settings");
    revalidatePath("/settings/amazon");
    amazonSettingsRedirect({ error: summary || workerApprovalHelp });
  } catch (error) {
    amazonSettingsRedirect({ error: error instanceof Error ? error.message : "Unable to warm up Amazon portal session." });
  }
}

export const warmupAmazonSccSession = warmupAmazonPortalSession;
