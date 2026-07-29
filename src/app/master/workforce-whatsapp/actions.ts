"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { WORKFORCE_APPLICANT_EVENT, WORKFORCE_APPLICANT_TEMPLATE } from "@/lib/workforce-applicant-whatsapp";

function finish(payload: { error?: string; notice?: string }): never {
  cookies().set("dropx_workforce_whatsapp_flash", JSON.stringify(payload), {
    httpOnly: true, maxAge: 20, path: "/master/workforce-whatsapp", sameSite: "lax"
  });
  redirect("/master/workforce-whatsapp");
}

export async function saveWorkforceWhatsApp(formData: FormData) {
  const authorization = await requirePagePermission("designations", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const enabled = formData.get("is_enabled") === "on";
    const profile = await supabaseAdmin.from("whatsapp_profiles")
      .select("id").eq("company_id", companyId).eq("is_active", true)
      .order("is_default", { ascending: false }).limit(1).maybeSingle();
    if (profile.error) throw new Error(profile.error.message);
    if (enabled && !profile.data?.id) throw new Error("Create an active WhatsApp profile first.");
    const template = profile.data?.id
      ? await supabaseAdmin.from("whatsapp_template_cache")
        .select("template_id,name,language,status")
        .eq("company_id", companyId)
        .eq("whatsapp_profile_id", profile.data.id)
        .eq("name", WORKFORCE_APPLICANT_TEMPLATE)
        .eq("status", "APPROVED")
        .limit(1).maybeSingle()
      : { data: null, error: null };
    if (template.error) throw new Error(template.error.message);
    if (enabled && !template.data) throw new Error(`Approved template ${WORKFORCE_APPLICANT_TEMPLATE} was not found. Sync WhatsApp templates first.`);
    const saved = await supabaseAdmin.from("whatsapp_notification_configs").upsert({
      company_id: companyId,
      event_code: WORKFORCE_APPLICANT_EVENT,
      is_enabled: enabled,
      whatsapp_profile_id: profile.data?.id ?? null,
      template_id: template.data?.template_id ?? null,
      template_name: template.data?.name ?? WORKFORCE_APPLICANT_TEMPLATE,
      template_language: template.data?.language ?? "en",
      variable_mappings: {
        "body.1": "candidate_name",
        "body.2": "role",
        "body.3": "station_poc_mobile",
        "body.4": "station_address"
      },
      updated_by: authorization.userId,
      updated_at: new Date().toISOString()
    }, { onConflict: "company_id,event_code" });
    if (saved.error) throw new Error(saved.error.message);
    revalidatePath("/master/workforce-whatsapp");
  } catch (error) {
    finish({ error: error instanceof Error ? error.message : "Unable to save workforce WhatsApp master." });
  }
  finish({ notice: formData.get("is_enabled") === "on" ? "Applicant auto-message enabled." : "Applicant auto-message paused." });
}
