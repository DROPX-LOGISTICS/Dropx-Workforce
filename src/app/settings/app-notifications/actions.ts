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

  const existing = await supabaseAdmin
    .from("mob_app_notification_rules")
    .select("event_code, title_template, body_template")
    .eq("company_id", authorization.companyId)
    .in("event_code", appNotificationEvents);
  if (existing.error) {
    const message = existing.error.message.toLowerCase().includes("mob_app_notification")
      ? "Run scripts/mob_app_notifications_v1.sql in Supabase first"
      : existing.error.message;
    redirect(`/settings/app-notifications?error=${encodeURIComponent(message)}`);
  }

  const existingByEvent = new Map(
    (existing.data ?? []).map((row) => [String(row.event_code), row])
  );
  const rows = appNotificationEvents.map((eventCode) => {
    const current = existingByEvent.get(eventCode);
    const defaults = appNotificationDefaults[eventCode];
    return {
      body_template: String(current?.body_template ?? defaults.bodyTemplate),
      company_id: authorization.companyId,
      enabled: formData.get(
        eventCode === "attendance_punch_in" || eventCode === "attendance_punch_out"
          ? "attendance_punch"
          : eventCode
      ) === "on",
      event_code: eventCode,
      route: defaults.route,
      title_template: String(current?.title_template ?? defaults.titleTemplate),
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
