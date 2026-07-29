import "server-only";

import { formatDuration, formatTime } from "@/lib/biometric/attendance";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isWorkforceProfileType } from "@/lib/workforce-profiles";

export const attendanceNotificationEvents = ["attendance_punch_in", "attendance_punch_out"] as const;
export type AttendanceNotificationEvent = typeof attendanceNotificationEvents[number];

export const attendanceNotificationDefaults: Record<AttendanceNotificationEvent, {
  bodyTemplate: string;
  titleTemplate: string;
}> = {
  attendance_punch_in: {
    titleTemplate: "Punch In recorded",
    bodyTemplate: "Your Punch In was recorded at {time} on {date}."
  },
  attendance_punch_out: {
    titleTemplate: "Punch Out recorded",
    bodyTemplate: "Your Punch Out was recorded at {time}. Work duration: {work_duration}."
  }
};

function isMissingNotificationSchema(error: { code?: string; message?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? "";
  return error?.code === "42P01" ||
    message.includes("mob_app_notification") ||
    message.includes("schema cache") ||
    message.includes("does not exist");
}

function formatPunchDate(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function applyVariables(template: string, variables: Record<string, string>) {
  return Object.entries(variables).reduce(
    (message, [key, value]) => message.replaceAll(`{${key}}`, value),
    template
  );
}

export async function createAttendancePunchNotification({
  accountId,
  companyId,
  firstPunchTime,
  profileType,
  punchDate,
  punchId,
  punchOrder,
  punchTime
}: {
  accountId: string;
  companyId: string;
  firstPunchTime: Date;
  profileType: string;
  punchDate: string;
  punchId: string;
  punchOrder: number;
  punchTime: Date;
}) {
  if (!supabaseAdmin || !isWorkforceProfileType(profileType)) return;

  const eventCode: AttendanceNotificationEvent =
    punchOrder === 1 ? "attendance_punch_in" : "attendance_punch_out";
  const defaults = attendanceNotificationDefaults[eventCode];
  const ruleResult = await supabaseAdmin
    .from("mob_app_notification_rules")
    .select("enabled, title_template, body_template")
    .eq("company_id", companyId)
    .eq("event_code", eventCode)
    .maybeSingle();

  if (ruleResult.error && !isMissingNotificationSchema(ruleResult.error)) {
    console.error("Unable to load app notification rule:", ruleResult.error.message);
  }
  if (ruleResult.data?.enabled === false) return;

  const workMinutes = punchOrder > 1
    ? Math.max(0, Math.round((punchTime.getTime() - firstPunchTime.getTime()) / 60000))
    : 0;
  const variables = {
    date: formatPunchDate(punchDate),
    punch_count: String(punchOrder),
    time: formatTime(punchTime),
    work_duration: formatDuration(workMinutes)
  };
  const title = applyVariables(
    String(ruleResult.data?.title_template ?? defaults.titleTemplate),
    variables
  );
  const body = applyVariables(
    String(ruleResult.data?.body_template ?? defaults.bodyTemplate),
    variables
  );

  const notificationResult = await supabaseAdmin
    .from("mob_app_notifications")
    .upsert({
      body,
      company_id: companyId,
      data: {
        punchDate,
        punchId,
        punchOrder,
        punchTime: punchTime.toISOString(),
        punchType: punchOrder === 1 ? "in" : "out",
        workDuration: variables.work_duration
      },
      event_code: eventCode,
      push_status: "not_configured",
      recipient_account_id: accountId,
      recipient_profile_type: profileType,
      route: "attendance",
      source_key: punchId,
      title
    }, {
      ignoreDuplicates: true,
      onConflict: "company_id,event_code,source_key,recipient_account_id"
    });

  if (notificationResult.error && !isMissingNotificationSchema(notificationResult.error)) {
    console.error("Unable to create attendance notification:", notificationResult.error.message);
  }
}
