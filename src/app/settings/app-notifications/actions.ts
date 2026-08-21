"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  appNotificationDefaults,
  appNotificationEvents
} from "@/lib/app-notifications";
import { requirePagePermission } from "@/lib/authorization";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function saveAppNotificationSettings(formData: FormData) {
  const authorization = await requirePagePermission("app_settings", "access");
  const permission = authorization.permissions.app_settings;
  if (!permission.canEdit && !permission.canAdd) {
    redirect("/unauthorized?page=app_settings&action=edit");
  }
  if (!supabaseAdmin) {
    redirect("/settings/app-notifications?error=Supabase%20is%20not%20configured");
  }

  const rows = appNotificationEvents.map((eventCode) => {
    const defaults = appNotificationDefaults[eventCode];
    const titleTemplate = String(formData.get(`${eventCode}_title`) ?? defaults.titleTemplate).trim();
    const bodyTemplate = String(formData.get(`${eventCode}_body`) ?? defaults.bodyTemplate).trim();
    if (!titleTemplate || titleTemplate.length > 120 || !bodyTemplate || bodyTemplate.length > 1000) {
      redirect(`/settings/app-notifications?error=${encodeURIComponent(`Invalid title or message for ${defaults.label}.`)}`);
    }
    return {
      body_template: bodyTemplate,
      company_id: authorization.companyId,
      enabled: formData.get(`${eventCode}_enabled`) === "on",
      event_code: eventCode,
      route: defaults.route,
      title_template: titleTemplate,
      updated_at: new Date().toISOString()
    };
  });

  const result = await supabaseAdmin
    .from("mob_app_notification_rules")
    .upsert(rows, { onConflict: "company_id,event_code" });
  if (result.error) {
    redirect(`/settings/app-notifications?error=${encodeURIComponent(result.error.message)}`);
  }

  revalidatePath("/settings/app-notifications");
  redirect("/settings/app-notifications?saved=1");
}
