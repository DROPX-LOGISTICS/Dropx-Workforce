import "server-only";

import { formatDuration, formatTime } from "@/lib/biometric/attendance";
import { evaluateAttendanceNotification, type AttendanceNotificationPolicy, type AttendanceShift } from "@/lib/attendance-notification-outcome";
import { deliverNotificationPush } from "@/lib/firebase-push";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isWorkforceProfileType } from "@/lib/workforce-profiles";

export const attendanceNotificationEvents = [
  "attendance_punch_in",
  "attendance_punch_out",
  "attendance_late_in",
  "attendance_early_out",
  "attendance_half_day",
  "attendance_short_day",
  "attendance_overtime",
  "attendance_exception_review"
] as const;
export type AttendanceNotificationEvent = typeof attendanceNotificationEvents[number];

export const appNotificationEvents = [
  ...attendanceNotificationEvents,
  "profile_submitted",
  "profile_approved",
  "profile_returned",
  "attendance_regularization_submitted",
  "leave_request_submitted"
] as const;
export type AppNotificationEvent = typeof appNotificationEvents[number];

export const appNotificationDefaults: Record<AppNotificationEvent, {
  bodyTemplate: string;
  label: string;
  route: "attendance" | "leave" | "profile";
  titleTemplate: string;
}> = {
  attendance_punch_in: {
    label: "Punch",
    route: "attendance",
    titleTemplate: "Punch Captured",
    bodyTemplate: "Your punch was captured at {time} on {date}."
  },
  attendance_punch_out: {
    label: "Punch",
    route: "attendance",
    titleTemplate: "Punch Captured",
    bodyTemplate: "Your punch was captured at {time} on {date}."
  },
  attendance_late_in: {
    label: "Late punch-in",
    route: "attendance",
    titleTemplate: "Late punch-in",
    bodyTemplate: "Punch captured at {time}. You arrived {late_minutes} minutes after your allowed shift time."
  },
  attendance_early_out: {
    label: "Early punch-out",
    route: "attendance",
    titleTemplate: "Early punch-out",
    bodyTemplate: "Punch-out captured at {time}. You left {early_minutes} minutes before your shift end."
  },
  attendance_half_day: {
    label: "Half-day outcome",
    route: "attendance",
    titleTemplate: "Half day marked",
    bodyTemplate: "Punch-out captured at {time}. You worked {work_duration}; attendance is marked half day under the current policy."
  },
  attendance_short_day: {
    label: "Short workday outcome",
    route: "attendance",
    titleTemplate: "Short workday",
    bodyTemplate: "Punch-out captured at {time}. You worked {work_duration}; attendance is marked {outcome} under the current policy."
  },
  attendance_overtime: {
    label: "Overtime exception",
    route: "attendance",
    titleTemplate: "Overtime needs review",
    bodyTemplate: "Punch-out captured at {time}. You worked {work_duration}; {overtime_minutes} overtime minutes need review under the current policy."
  },
  attendance_exception_review: {
    label: "Attendance exception",
    route: "attendance",
    titleTemplate: "Attendance needs review",
    bodyTemplate: "Punch captured at {time}. {outcome}."
  },
  profile_submitted: {
    label: "Profile submitted",
    route: "profile",
    titleTemplate: "Profile submitted",
    bodyTemplate: "Your profile has been submitted successfully."
  },
  profile_approved: {
    label: "Profile approved",
    route: "profile",
    titleTemplate: "Profile approved",
    bodyTemplate: "Your profile has been approved and activated."
  },
  profile_returned: {
    label: "Profile returned",
    route: "profile",
    titleTemplate: "Profile returned",
    bodyTemplate: "Your profile has been returned for correction. {remarks}"
  },
  attendance_regularization_submitted: {
    label: "Regularization submitted",
    route: "attendance",
    titleTemplate: "Regularization submitted",
    bodyTemplate: "Your attendance regularization request for {date} has been submitted."
  },
  leave_request_submitted: {
    label: "Leave submitted",
    route: "leave",
    titleTemplate: "Leave request submitted",
    bodyTemplate: "Your leave request from {from_date} to {to_date} is awaiting reporting-manager approval."
  }
};

export const attendanceNotificationDefaults = {
  attendance_punch_in: appNotificationDefaults.attendance_punch_in,
  attendance_punch_out: appNotificationDefaults.attendance_punch_out,
  attendance_late_in: appNotificationDefaults.attendance_late_in,
  attendance_early_out: appNotificationDefaults.attendance_early_out,
  attendance_half_day: appNotificationDefaults.attendance_half_day,
  attendance_short_day: appNotificationDefaults.attendance_short_day,
  attendance_overtime: appNotificationDefaults.attendance_overtime,
  attendance_exception_review: appNotificationDefaults.attendance_exception_review
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

function relation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function number(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clockMinutes(value: string | null | undefined) {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
}

function localMinutes(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  return number(parts.find((part) => part.type === "hour")?.value) * 60 + number(parts.find((part) => part.type === "minute")?.value);
}

async function loadAttendanceNotificationContext({
  companyId,
  enrolmentId,
  punchDate,
  workerId,
  workerType
}: {
  companyId: string;
  enrolmentId: string;
  punchDate: string;
  workerId: string | null;
  workerType: string;
}) {
  if (!supabaseAdmin) return null;
  const [settingsResult, dayResult] = await Promise.all([
    supabaseAdmin.from("hr_company_settings").select("attendance_grace_minutes,full_day_minutes,half_day_minutes,work_duration_basis,full_day_percent,half_day_percent,partial_day_treatment,single_punch_treatment,odd_punch_treatment,below_half_day_treatment,unassigned_shift_treatment,cross_location_treatment,overtime_threshold_minutes,overtime_treatment,maximum_daily_minutes").eq("company_id", companyId).maybeSingle(),
    supabaseAdmin.from("attendance_daily").select("in_time,out_time,work_minutes,punch_count,location_id,punch_in_location_id,punch_out_location_id").eq("company_id", companyId).eq("enrolment_id", enrolmentId).eq("punch_date", punchDate).maybeSingle()
  ]);
  if (settingsResult.error) console.error("Unable to load attendance notification policy:", settingsResult.error.message);
  if (dayResult.error) console.error("Unable to load calculated attendance for notification:", dayResult.error.message);

  const settings = settingsResult.data;
  const policy: AttendanceNotificationPolicy = {
    fullDayMinutes: number(settings?.full_day_minutes, 480),
    halfDayMinutes: number(settings?.half_day_minutes, 240),
    durationBasis: ["fixed", "shift_percentage"].includes(String(settings?.work_duration_basis)) ? settings?.work_duration_basis as AttendanceNotificationPolicy["durationBasis"] : "fixed",
    fullDayPercent: number(settings?.full_day_percent, 100),
    halfDayPercent: number(settings?.half_day_percent, 50),
    partialDayTreatment: ["review", "half_day", "proportionate"].includes(String(settings?.partial_day_treatment)) ? settings?.partial_day_treatment as AttendanceNotificationPolicy["partialDayTreatment"] : "half_day",
    singlePunchTreatment: ["review", "half_day", "absent"].includes(String(settings?.single_punch_treatment)) ? settings?.single_punch_treatment as AttendanceNotificationPolicy["singlePunchTreatment"] : "review",
    oddPunchTreatment: ["review", "half_day", "absent"].includes(String(settings?.odd_punch_treatment)) ? settings?.odd_punch_treatment as AttendanceNotificationPolicy["oddPunchTreatment"] : "review",
    belowHalfDayTreatment: ["review", "absent", "proportionate"].includes(String(settings?.below_half_day_treatment)) ? settings?.below_half_day_treatment as AttendanceNotificationPolicy["belowHalfDayTreatment"] : "absent",
    unassignedShiftTreatment: ["fixed_minutes", "review", "absent"].includes(String(settings?.unassigned_shift_treatment)) ? settings?.unassigned_shift_treatment as AttendanceNotificationPolicy["unassignedShiftTreatment"] : "fixed_minutes",
    crossLocationTreatment: ["allow", "review"].includes(String(settings?.cross_location_treatment)) ? settings?.cross_location_treatment as AttendanceNotificationPolicy["crossLocationTreatment"] : "review",
    overtimeThresholdMinutes: number(settings?.overtime_threshold_minutes, 60),
    overtimeTreatment: ["allow", "review"].includes(String(settings?.overtime_treatment)) ? settings?.overtime_treatment as AttendanceNotificationPolicy["overtimeTreatment"] : "review",
    maximumDailyMinutes: number(settings?.maximum_daily_minutes, 960)
  };

  let shift: AttendanceShift | null = null;
  if (workerId) {
    const table = workerType === "employee" ? "hr_employee_shift_assignments" : "hr_contractor_shift_assignments";
    const workerColumn = workerType === "employee" ? "employee_id" : "contractor_id";
    const assignmentResult = await supabaseAdmin
      .from(table)
      .select("effective_from,effective_to,hr_shifts(start_time,end_time,grace_in_minutes,grace_out_minutes)")
      .eq("company_id", companyId)
      .eq(workerColumn, workerId)
      .lte("effective_from", punchDate)
      .or(`effective_to.is.null,effective_to.gte.${punchDate}`)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (assignmentResult.error) console.error("Unable to load assigned shift for attendance notification:", assignmentResult.error.message);
    const shiftRow = relation((assignmentResult.data as { hr_shifts?: { start_time: string; end_time: string; grace_in_minutes: number; grace_out_minutes: number } | Array<{ start_time: string; end_time: string; grace_in_minutes: number; grace_out_minutes: number }> | null } | null)?.hr_shifts ?? null);
    const startMinutes = clockMinutes(shiftRow?.start_time);
    const endMinutes = clockMinutes(shiftRow?.end_time);
    if (startMinutes !== null && endMinutes !== null) {
      shift = {
        startMinutes,
        endMinutes,
        graceInMinutes: number(shiftRow?.grace_in_minutes ?? settings?.attendance_grace_minutes),
        graceOutMinutes: number(shiftRow?.grace_out_minutes)
      };
    }
  }
  return { day: dayResult.data, policy, shift };
}

export async function createAppNotification({
  accountId,
  companyId,
  data = {},
  eventCode,
  profileType,
  sourceKey,
  variables = {}
}: {
  accountId: string;
  companyId: string;
  data?: Record<string, unknown>;
  eventCode: AppNotificationEvent;
  profileType: string;
  sourceKey: string;
  variables?: Record<string, string>;
}) {
  if (!supabaseAdmin || !isWorkforceProfileType(profileType)) return;

  const defaults = appNotificationDefaults[eventCode];
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

  const title = applyVariables(
    String(ruleResult.data?.title_template ?? defaults.titleTemplate),
    variables
  );
  const body = applyVariables(
    String(ruleResult.data?.body_template ?? defaults.bodyTemplate),
    variables
  ).replace(/\s+/g, " ").trim();
  const notificationResult = await supabaseAdmin
    .from("mob_app_notifications")
    .upsert({
      body,
      company_id: companyId,
      data,
      event_code: eventCode,
      push_status: "not_configured",
      recipient_account_id: accountId,
      recipient_profile_type: profileType,
      route: String(ruleResult.data?.route ?? defaults.route),
      source_key: sourceKey,
      title
    }, {
      ignoreDuplicates: true,
      onConflict: "company_id,event_code,source_key,recipient_account_id"
    })
    .select("id");

  if (notificationResult.error && !isMissingNotificationSchema(notificationResult.error)) {
    console.error("Unable to create app notification:", notificationResult.error.message);
  }
  const notificationId = notificationResult.data?.[0]?.id;
  if (notificationId) {
    await deliverNotificationPush({
      id: notificationId,
      companyId,
      profileType,
      accountId,
      title,
      body,
      route: String(ruleResult.data?.route ?? defaults.route),
      data
    });
  }
}

export async function createAttendancePunchNotification({
  accountId,
  companyId,
  enrolmentId,
  firstPunchTime,
  profileType,
  punchDate,
  punchId,
  punchOrder,
  punchTime,
  workerId,
  workerType
}: {
  accountId: string;
  companyId: string;
  enrolmentId: string;
  firstPunchTime: Date;
  profileType: string;
  punchDate: string;
  punchId: string;
  punchOrder: number;
  punchTime: Date;
  workerId: string | null;
  workerType: string;
}) {
  if (!supabaseAdmin || !isWorkforceProfileType(profileType)) return;

  const eventCode: AttendanceNotificationEvent =
    punchOrder === 1 ? "attendance_punch_in" : "attendance_punch_out";
  const workMinutes = punchOrder > 1
    ? Math.max(0, Math.round((punchTime.getTime() - firstPunchTime.getTime()) / 60000))
    : 0;
  const variables = {
    date: formatPunchDate(punchDate),
    punch_count: String(punchOrder),
    time: formatTime(punchTime),
    work_duration: formatDuration(workMinutes)
  };
  const notificationData = {
    punchDate,
    punchId,
    punchOrder,
    punchTime: punchTime.toISOString(),
    punchType: punchOrder === 1 ? "in" : "out",
    workDuration: variables.work_duration
  };
  await createAppNotification({ accountId, companyId, data: notificationData, eventCode, profileType, sourceKey: punchId, variables });

  const context = await loadAttendanceNotificationContext({ companyId, enrolmentId, punchDate, workerId, workerType });
  if (!context) return;
  const calculatedWorkMinutes = number(context.day?.work_minutes, workMinutes);
  const outcome = evaluateAttendanceNotification({
    inMinutes: localMinutes(context.day?.in_time ?? firstPunchTime),
    outMinutes: localMinutes(context.day?.out_time ?? (punchOrder > 1 ? punchTime : null)),
    punchOrder,
    shift: context.shift,
    workMinutes: calculatedWorkMinutes,
    crossLocation: Boolean(context.day?.location_id && (
      (context.day?.punch_in_location_id && context.day.punch_in_location_id !== context.day.location_id) ||
      (context.day?.punch_out_location_id && context.day.punch_out_location_id !== context.day.location_id)
    )),
    policy: context.policy
  });
  if (!outcome) return;
  const outcomeVariables = {
    ...variables,
    early_minutes: String(outcome.earlyMinutes),
    late_minutes: String(outcome.lateMinutes),
    overtime_minutes: String(outcome.overtimeMinutes),
    outcome: outcome.outcome,
    payable_percent: String(outcome.payablePercent),
    work_duration: formatDuration(calculatedWorkMinutes)
  };
  await createAppNotification({
    accountId,
    companyId,
    data: { ...notificationData, ...outcome, outcome: outcome.outcome, workDuration: outcomeVariables.work_duration },
    eventCode: outcome.eventCode,
    profileType,
    sourceKey: punchId,
    variables: outcomeVariables
  });
}
