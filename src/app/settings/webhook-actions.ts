"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

function clean(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function redirectWithFlash(params: { error?: string; notice?: string }): never {
  cookies().set("dropx_webhook_settings_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 20,
    path: "/settings",
    sameSite: "lax"
  });
  redirect("/settings/webhook");
}

export async function saveWebhookSettings(formData: FormData) {
  const authorization = await requirePagePermission("app_settings", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const webhookVerifyToken = clean(formData.get("webhook_verify_token"));
    const now = new Date().toISOString();

    const messagingResult = await supabaseAdmin.from("meta_messaging_settings").upsert({
      id: true,
      company_id: companyId,
      webhook_verify_token: webhookVerifyToken,
      updated_by: authorization.userId,
      updated_at: now
    }, { onConflict: "company_id,id" });
    if (messagingResult.error) throw new Error(messagingResult.error.message);

    const leadsResult = await supabaseAdmin.from("meta_leads_settings").upsert({
      id: true,
      company_id: companyId,
      webhook_verify_token: webhookVerifyToken,
      updated_at: now
    }, { onConflict: "company_id,id" });
    if (leadsResult.error) throw new Error(leadsResult.error.message);

    const whatsAppResult = await supabaseAdmin.from("whatsapp_settings").upsert({
      id: true,
      company_id: companyId,
      webhook_verify_token: webhookVerifyToken,
      updated_by: authorization.userId,
      updated_at: now
    }, { onConflict: "company_id,id" });
    if (whatsAppResult.error) throw new Error(whatsAppResult.error.message);

    revalidatePath("/settings");
    revalidatePath("/settings/webhook");
    revalidatePath("/settings/messaging");
    revalidatePath("/settings/meta");
    revalidatePath("/settings/ads-leads");
  } catch (error) {
    redirectWithFlash({ error: error instanceof Error ? error.message : "Unable to save webhook settings." });
  }

  redirectWithFlash({ notice: "Webhook settings saved." });
}
