"use server";

import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isWorkforceProfileType, workforceTable } from "@/lib/workforce-profiles";

export async function sendAppNotification(formData: FormData) {
  const authorization = await requirePagePermission("notifications_app", "add");
  if (!supabaseAdmin) redirect("/notifications/app?error=Supabase%20is%20not%20configured");

  const profileType = String(formData.get("profileType") ?? "").trim();
  const accountId = String(formData.get("accountId") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const route = String(formData.get("route") ?? "").trim();

  if (!isWorkforceProfileType(profileType) || !accountId || !title || !body) {
    redirect("/notifications/app?error=Recipient%2C%20title%20and%20message%20are%20required");
  }
  if (title.length > 120 || body.length > 1000) {
    redirect("/notifications/app?error=Notification%20text%20is%20too%20long");
  }

  const recipient = await supabaseAdmin
    .from(workforceTable(profileType))
    .select("id")
    .eq("company_id", authorization.companyId)
    .eq("id", accountId)
    .maybeSingle();
  if (recipient.error || !recipient.data) {
    redirect("/notifications/app?error=The%20selected%20recipient%20is%20not%20available");
  }

  const result = await supabaseAdmin.from("mob_app_notifications").insert({
    company_id: authorization.companyId,
    recipient_profile_type: profileType,
    recipient_account_id: accountId,
    event_code: "manual",
    title,
    body,
    route: route || null,
    created_by: authorization.userId,
    push_status: "not_configured"
  });
  if (result.error) {
    const message = result.error.message.toLowerCase().includes("mob_app_notifications")
      ? "Run scripts/mob_app_notifications_v1.sql in Supabase first"
      : result.error.message;
    redirect(`/notifications/app?error=${encodeURIComponent(message)}`);
  }
  redirect("/notifications/app?sent=1");
}
