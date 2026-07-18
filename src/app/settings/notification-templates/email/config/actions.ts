"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { sendEmail } from "@/lib/email";
import { supabaseAdmin } from "@/lib/supabase-admin";

function clean(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function required(value: FormDataEntryValue | null, field: string) {
  const text = clean(value);
  if (!text) throw new Error(`${field} is required.`);
  return text;
}

function redirectWithFlash(params: { error?: string; notice?: string }): never {
  cookies().set("dropx_email_config_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 20,
    path: "/settings/notification-templates/email/config",
    sameSite: "lax"
  });
  redirect("/settings/notification-templates/email/config");
}

function isNextRedirectError(error: unknown) {
  return typeof (error as { digest?: unknown })?.digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT");
}

export async function saveEmailNotificationConfig(formData: FormData) {
  const authorization = await requirePagePermission("app_settings", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const isEnabled = formData.get("is_enabled") === "on";
    const port = Number(clean(formData.get("smtp_port")) ?? "587");
    const encryption = clean(formData.get("smtp_encryption")) ?? "tls";
    if (!Number.isFinite(port) || port < 1 || port > 65535) throw new Error("SMTP port must be between 1 and 65535.");
    if (!["tls", "ssl"].includes(encryption)) throw new Error("SMTP encryption must be TLS or SSL.");
    if (encryption === "ssl" && port !== 465) throw new Error("SSL SMTP must use port 465.");
    if (encryption === "tls" && port === 465) throw new Error("TLS SMTP cannot use port 465. Use port 587 or select SSL.");
    const smtpHost = isEnabled ? required(formData.get("smtp_host"), "SMTP host") : clean(formData.get("smtp_host"));
    const smtpFrom = isEnabled ? required(formData.get("smtp_from"), "From email") : clean(formData.get("smtp_from"));

    const password = clean(formData.get("smtp_pass"));
    const existing = await supabaseAdmin
      .from("email_notification_settings")
      .select("smtp_pass")
      .eq("company_id", companyId)
      .eq("id", true)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);

    const { error } = await (supabaseAdmin.from("email_notification_settings") as any).upsert({
      id: true,
      company_id: companyId,
      is_enabled: isEnabled,
      smtp_host: smtpHost,
      smtp_port: Math.floor(port),
      smtp_secure: encryption === "ssl",
      smtp_user: clean(formData.get("smtp_user")),
      smtp_pass: password ?? existing.data?.smtp_pass ?? null,
      smtp_from: smtpFrom,
      from_name: clean(formData.get("from_name")),
      updated_at: new Date().toISOString()
    }, { onConflict: "company_id" });
    if (error) throw new Error(error.message);

    revalidatePath("/settings/notification-templates/email");
    revalidatePath("/settings/notification-templates/email/config");
    redirectWithFlash({ notice: "Email config saved." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithFlash({ error: error instanceof Error ? error.message : "Unable to save email config." });
  }
}

export async function sendTestEmailNotification(formData: FormData) {
  const authorization = await requirePagePermission("app_settings", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    const to = required(formData.get("test_to"), "To")
      .split(/[,\n;]/)
      .map((email) => email.trim())
      .filter(Boolean);
    await sendEmail({
      body: required(formData.get("test_body"), "Email body"),
      companyId,
      subject: required(formData.get("test_subject"), "Subject"),
      to
    });
    redirectWithFlash({ notice: "Test email sent." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithFlash({ error: error instanceof Error ? error.message : "Unable to send test email." });
  }
}
