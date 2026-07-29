import "server-only";

import { supabaseAdmin } from "./supabase-admin";
import { isWorkforceProfileType } from "./workforce-profiles";

type AppNotificationEvent = "profile_submitted";

const defaults = {
  profile_submitted: {
    body: "Your profile has been submitted successfully.",
    route: "profile",
    title: "Profile submitted"
  }
} satisfies Record<AppNotificationEvent, { body: string; route: string; title: string }>;

function isMissingNotificationSchema(error: { code?: string; message?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? "";
  return error?.code === "42P01" ||
    message.includes("mob_app_notification") ||
    message.includes("schema cache") ||
    message.includes("does not exist");
}

export async function createProfileSubmittedNotification({
  accountId,
  companyId,
  profileType,
  sourceKey
}: {
  accountId: string;
  companyId: string;
  profileType: string;
  sourceKey: string;
}) {
  if (!supabaseAdmin || !isWorkforceProfileType(profileType)) return;

  const eventCode: AppNotificationEvent = "profile_submitted";
  const eventDefaults = defaults[eventCode];
  const ruleResult = await supabaseAdmin
    .from("mob_app_notification_rules")
    .select("enabled, title_template, body_template, route")
    .eq("company_id", companyId)
    .eq("event_code", eventCode)
    .maybeSingle();
  if (ruleResult.error && !isMissingNotificationSchema(ruleResult.error)) {
    console.error("Unable to load app notification rule:", ruleResult.error.message);
  }
  if (ruleResult.data?.enabled === false) return;

  const result = await supabaseAdmin
    .from("mob_app_notifications")
    .upsert({
      body: String(ruleResult.data?.body_template ?? eventDefaults.body),
      company_id: companyId,
      data: {},
      event_code: eventCode,
      push_status: "not_configured",
      recipient_account_id: accountId,
      recipient_profile_type: profileType,
      route: String(ruleResult.data?.route ?? eventDefaults.route),
      source_key: sourceKey,
      title: String(ruleResult.data?.title_template ?? eventDefaults.title)
    }, {
      ignoreDuplicates: true,
      onConflict: "company_id,event_code,source_key,recipient_account_id"
    });
  if (result.error && !isMissingNotificationSchema(result.error)) {
    console.error("Unable to create app notification:", result.error.message);
  }
}
