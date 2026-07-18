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

function settingsRedirect(params: { error?: string; notice?: string }): never {
  cookies().set("dropx_messaging_settings_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 20,
    path: "/settings",
    sameSite: "lax"
  });
  redirect("/settings/messaging");
}

export async function saveMessagingWebhookSettings(formData: FormData) {
  const authorization = await requirePagePermission("app_settings", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const webhookVerifyToken = clean(formData.get("webhook_verify_token"));
    const now = new Date().toISOString();

    const metaResult = await supabaseAdmin.from("meta_messaging_settings").upsert({
      id: true,
      company_id: companyId,
      webhook_verify_token: webhookVerifyToken,
      updated_by: authorization.userId,
      updated_at: now
    }, { onConflict: "company_id,id" });
    if (metaResult.error) throw new Error(metaResult.error.message);

    const whatsAppResult = await supabaseAdmin.from("whatsapp_settings").upsert({
      id: true,
      company_id: companyId,
      webhook_verify_token: webhookVerifyToken,
      updated_by: authorization.userId,
      updated_at: now
    }, { onConflict: "company_id,id" });
    if (whatsAppResult.error) throw new Error(whatsAppResult.error.message);

    revalidatePath("/settings");
    revalidatePath("/settings/messaging");
    revalidatePath("/settings/meta");
  } catch (error) {
    settingsRedirect({ error: error instanceof Error ? error.message : "Unable to save messaging webhook settings." });
  }
  settingsRedirect({ notice: "Messaging webhook settings saved." });
}
