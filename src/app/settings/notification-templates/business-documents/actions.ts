"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
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

const allowedRecipients = new Set(["compliance_manager", "location_email", "location_manager"]);

function recipients(formData: FormData, field: string) {
  return formData
    .getAll(field)
    .map((value) => String(value).trim())
    .filter((value) => allowedRecipients.has(value));
}

function emails(formData: FormData, field: string) {
  return Array.from(new Set(
    String(formData.get(field) ?? "")
      .split(/[,\n;]/)
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.includes("@"))
  ));
}

function redirectWithFlash(params: { error?: string; notice?: string }): never {
  cookies().set("dropx_notification_templates_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 20,
    path: "/settings/notification-templates/business-documents",
    sameSite: "lax"
  });
  redirect("/settings/notification-templates/business-documents");
}

function isNextRedirectError(error: unknown) {
  return typeof (error as { digest?: unknown })?.digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT");
}

export async function saveBusinessDocumentNotificationTemplate(formData: FormData) {
  const authorization = await requirePagePermission("app_settings", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const toRecipients = recipients(formData, "to_recipients");
    const ccRecipients = recipients(formData, "cc_recipients").filter((value) => !toRecipients.includes(value));
    const customToEmails = emails(formData, "custom_to_emails");
    const customCcEmails = emails(formData, "custom_cc_emails").filter((email) => !customToEmails.includes(email));
    if (!toRecipients.length && !customToEmails.length) throw new Error("Select at least one To recipient or custom To email.");
    const { error } = await (supabaseAdmin.from("business_document_notification_templates") as any).upsert({
      id: true,
      company_id: companyId,
      is_enabled: formData.get("is_enabled") === "on",
      to_recipients: toRecipients,
      cc_recipients: ccRecipients,
      custom_to_emails: customToEmails,
      custom_cc_emails: customCcEmails,
      subject_template: required(formData.get("subject_template"), "Subject template"),
      body_template: required(formData.get("body_template"), "Body template"),
      updated_at: new Date().toISOString()
    }, { onConflict: "company_id,id" });
    if (error) throw new Error(error.message);

    revalidatePath("/settings/notification-templates");
    revalidatePath("/settings/notification-templates/business-documents");
    redirectWithFlash({ notice: "Notification template saved." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithFlash({ error: error instanceof Error ? error.message : "Unable to save notification template." });
  }
}
