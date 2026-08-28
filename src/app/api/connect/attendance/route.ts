import { createHash } from "crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { connectSessionCookieName, normalizeConnectMobile } from "@/lib/connect-auth";
import { loadAttendanceReportRows } from "@/lib/biometric/attendance";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createAppNotification, evaluateAttendanceDayForApp } from "@/lib/app-notifications";
import { resolveReportingApprovalSteps } from "@/lib/reporting-approval-chain";
import { isWorkforceProfileType, type WorkforceProfileType, workforceTable } from "@/lib/workforce-profiles";

function monthRange(month: string | null) {
  const today = new Date();
  const match = month?.match(/^(\d{4})-(\d{2})$/);
  const year = match ? Number(match[1]) : today.getUTCFullYear();
  const monthIndex = match ? Number(match[2]) - 1 : today.getUTCMonth();
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    throw new Error("Month must be in YYYY-MM format.");
  }
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0));
  return {
    label: `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
    fromDate: start.toISOString().slice(0, 10),
    toDate: end.toISOString().slice(0, 10)
  };
}

function cleanEnrolmentId(value: unknown) {
  const digits = String(value ?? "").trim().replace(/\D/g, "");
  if (!digits) return "";
  return digits.replace(/^0+/, "") || "0";
}

function isMissingRegularizationTable(message: unknown) {
  const text = String(message ?? "").toLowerCase();
  return text.includes("attendance_regularization_requests") &&
    (text.includes("does not exist") || text.includes("schema cache"));
}

function validTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function indiaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function dateDistanceInDays(fromDate: string, toDate: string) {
  return Math.floor((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000);
}

function fileExtension(name: string) {
  const match = name.toLowerCase().match(/\.[a-z0-9]{1,8}$/);
  return match?.[0] ?? "";
}

async function activeSession() {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const token = cookies().get(connectSessionCookieName)?.value;
  if (!token) throw new Error("Login required.");
  const sessionHash = createHash("sha256").update(token).digest("hex");
  const sessionResult = await supabaseAdmin
    .from("connect_login_sessions")
    .select("id, country_code, mobile_number, expires_at, revoked_at")
    .eq("session_hash", sessionHash)
    .maybeSingle();
  if (sessionResult.error) throw new Error(sessionResult.error.message);
  const session = sessionResult.data;
  if (!session || session.revoked_at || new Date(session.expires_at).getTime() < Date.now()) {
    throw new Error("Login expired.");
  }
  return session;
}

async function resolveWorker({
  accountId,
  profileType
}: {
  accountId: string;
  profileType: string;
}) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const session = await activeSession();
  const { countryCode, mobile, localMobile } = normalizeConnectMobile(session.mobile_number, session.country_code);
  if (isWorkforceProfileType(profileType)) {
    const resolvedProfileType = profileType as WorkforceProfileType;
    const table = workforceTable(resolvedProfileType);
    const idColumn = resolvedProfileType === "employee" ? "employee_code" : "dropx_id";
    const stateColumns: string = resolvedProfileType === "workforce"
      ? ", onboarding_status, lifecycle_status, deleted_at, migration_state"
      : "";
    const profileColumns: string = `id, company_id, mobile, mobile_country_code, biometric_id, full_name, ${idColumn}, is_active${stateColumns}`;
    const result = await supabaseAdmin
      .from(table)
      .select(profileColumns)
      .eq("id", accountId)
      .maybeSingle();
    if (result.error) throw new Error(result.error.message);
    const row = result.data as Record<string, any> | null;
    if (!row) throw new Error("Workforce account is inactive or unavailable.");
    if (resolvedProfileType === "workforce") {
      const terminal = new Set(["rejected", "cancelled", "terminated", "settled", "exited", "offboarded", "deactivated"]);
      if (row.deleted_at || row.migration_state === "reclassified"
        || terminal.has(String(row.onboarding_status ?? "").toLowerCase())
        || terminal.has(String(row.lifecycle_status ?? "").toLowerCase())) {
        throw new Error("Workforce account is inactive or unavailable.");
      }
    } else if (row.is_active === false) {
      throw new Error("Workforce account is inactive or unavailable.");
    }
    const rowMobile = String(row.mobile ?? "").replace(/\D/g, "");
    const rowCountryCode = String(row.mobile_country_code ?? countryCode).replace(/\D/g, "") || countryCode;
    if (rowCountryCode !== countryCode || (rowMobile !== mobile && rowMobile !== localMobile)) {
      throw new Error("This attendance is not available for the signed-in account.");
    }
    const enrolmentId = cleanEnrolmentId(row.biometric_id);
    const legacyIdentity = resolvedProfileType === "workforce"
      ? await supabaseAdmin.from("workforce_identity_links")
        .select("legacy_profile_id")
        .eq("company_id", row.company_id)
        .eq("target_profile_type", "workforce")
        .eq("target_profile_id", row.id)
        .eq("legacy_profile_type", "contractor")
        .eq("compatibility_active", true)
        .maybeSingle()
      : { data: null, error: null };
    if (legacyIdentity.error) throw new Error(legacyIdentity.error.message);
    return {
      companyId: row.company_id as string,
      profileId: row.id as string,
      profileType: resolvedProfileType,
      dropxId: String(row[idColumn as keyof typeof row] ?? ""),
      biometricId: String(row.biometric_id ?? ""),
      fullName: String(row.full_name ?? ""),
      approvalProfileId: resolvedProfileType === "workforce" ? legacyIdentity.data?.legacy_profile_id ?? null : row.id as string,
      approvalProfileType: resolvedProfileType === "workforce" ? "contractor" as const : resolvedProfileType,
      filter: (item: Awaited<ReturnType<typeof loadAttendanceReportRows>>[number]) => Boolean(enrolmentId) && cleanEnrolmentId(item.enrolmentId) === enrolmentId
    };
  }
  throw new Error("Attendance is available for workforce accounts only.");
}

export async function GET(request: NextRequest) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const accountId = request.nextUrl.searchParams.get("accountId") ?? "";
    const profileType = request.nextUrl.searchParams.get("profileType") ?? "";
    if (!accountId) throw new Error("Account is required.");
    const range = monthRange(request.nextUrl.searchParams.get("month"));
    const worker = await resolveWorker({ accountId, profileType });
    const rows = (await loadAttendanceReportRows({
      companyId: worker.companyId,
      enrolmentIds: [worker.biometricId],
      fromDate: range.fromDate,
      toDate: range.toDate,
      reportType: "performance"
    })).filter(worker.filter);
    const present = rows.filter((row) => row.status === "P").length;
    const absent = rows.filter((row) => row.status === "A").length;
    const misPunch = rows.filter((row) => row.remark.toLowerCase().includes("single") || row.remark.toLowerCase().includes("missing")).length;
    const requestsResult = await supabaseAdmin
      .from("attendance_regularization_requests")
      .select("id, attendance_date, requested_in_time, requested_out_time, reason_code, remarks, attachment_path, status, review_remarks, created_at")
      .eq("company_id", worker.companyId)
      .eq("profile_type", worker.profileType)
      .eq("profile_id", worker.profileId)
      .gte("attendance_date", range.fromDate)
      .lte("attendance_date", range.toDate)
      .order("created_at", { ascending: false });
    if (requestsResult.error && !isMissingRegularizationTable(requestsResult.error.message)) {
      throw new Error(requestsResult.error.message);
    }
    const requestByDate = new Map<string, Record<string, unknown>>();
    for (const item of requestsResult.data ?? []) {
      if (!requestByDate.has(String(item.attendance_date))) {
        requestByDate.set(String(item.attendance_date), {
          id: item.id,
          requestedInTime: String(item.requested_in_time ?? "").slice(0, 5),
          requestedOutTime: String(item.requested_out_time ?? "").slice(0, 5),
          reasonCode: item.reason_code,
          remarks: item.remarks,
          hasAttachment: Boolean(item.attachment_path),
          status: item.status,
          reviewRemarks: item.review_remarks,
          createdAt: item.created_at
        });
      }
    }

    const today = indiaToday();
    const responseRows = await Promise.all(rows.map(async (row) => ({
      date: row.punchDate,
      status: row.status,
      inTime: row.inTime,
      outTime: row.outTime,
      punches: row.punchTimes,
      workHours: row.workHours,
      punchCount: row.punchCount,
      remark: row.remark,
      outcome: await evaluateAttendanceDayForApp({
        companyId: worker.companyId,
        enrolmentId: worker.biometricId,
        finalized: row.punchDate < today || row.punchCount > 1,
        punchDate: row.punchDate,
        workerId: worker.profileId,
        workerType: worker.profileType
      }),
      regularization: requestByDate.get(row.punchDate) ?? null
    })));
    const attendanceDates = new Set(responseRows.map((row) => row.date));
    for (const [date, regularization] of requestByDate) {
      if (!attendanceDates.has(date)) {
        responseRows.push({
          date,
          status: "",
          inTime: "",
          outTime: "",
          punches: [],
          workHours: "",
          punchCount: 0,
          remark: "",
          outcome: null,
          regularization
        });
      }
    }
    responseRows.sort((left, right) => left.date.localeCompare(right.date));

    return NextResponse.json({
      month: range.label,
      summary: {
        totalRows: rows.length,
        present,
        absent,
        misPunch,
        fullDay: responseRows.filter((row) => row.outcome?.code === "full_day").length,
        halfDay: responseRows.filter((row) => row.outcome?.code === "half_day").length,
        needsReview: responseRows.filter((row) => row.outcome?.code === "needs_review").length,
        shortDay: responseRows.filter((row) => row.outcome?.code === "short_day").length,
        late: responseRows.filter((row) => row.outcome?.code === "late" || Boolean(row.outcome?.lateMinutes)).length,
        early: responseRows.filter((row) => row.outcome?.code === "early" || Boolean(row.outcome?.earlyMinutes)).length
      },
      rows: responseRows
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load attendance.";
    const status = message.includes("Login") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const formData = await request.formData();
    const accountId = String(formData.get("accountId") ?? "").trim();
    const profileType = String(formData.get("profileType") ?? "").trim();
    const attendanceDate = String(formData.get("attendanceDate") ?? "").trim();
    const requestedInTime = String(formData.get("requestedInTime") ?? "").trim();
    const requestedOutTime = String(formData.get("requestedOutTime") ?? "").trim();
    const reasonCode = String(formData.get("reasonCode") ?? "").trim();
    const remarks = String(formData.get("remarks") ?? "").trim();
    const currentInTime = String(formData.get("currentInTime") ?? "").trim();
    const currentOutTime = String(formData.get("currentOutTime") ?? "").trim();
    if (!accountId) throw new Error("Account is required.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate)) throw new Error("Attendance date is required.");
    const today = indiaToday();
    if (attendanceDate > today) throw new Error("Future attendance cannot be regularized.");
    if (!validTime(requestedInTime) || !validTime(requestedOutTime)) {
      throw new Error("Requested IN and OUT times are required.");
    }
    if (requestedOutTime === requestedInTime) throw new Error("Requested IN and OUT times cannot be the same.");
    if (!["missed_in", "missed_out", "missed_both", "incorrect_in", "incorrect_out", "other"].includes(reasonCode)) {
      throw new Error("Select a regularization reason.");
    }
    if (remarks.length < 5) throw new Error("Enter a short explanation.");
    const worker = await resolveWorker({ accountId, profileType });
    if (!worker.approvalProfileId || (worker.approvalProfileType !== "employee" && worker.approvalProfileType !== "contractor")) {
      throw new Error("Attendance regularization requires an active People approval identity for this Workforce profile.");
    }
    const settingsResult = await supabaseAdmin.from("hr_company_settings")
      .select("regularization_manager_levels,regularization_max_backdate_days")
      .eq("company_id", worker.companyId)
      .maybeSingle();
    if (settingsResult.error) throw new Error(settingsResult.error.message);
    const managerLevels = Number(settingsResult.data?.regularization_manager_levels ?? 2);
    const maxBackdateDays = Number(settingsResult.data?.regularization_max_backdate_days ?? 30);
    if (dateDistanceInDays(attendanceDate, today) > maxBackdateDays) {
      throw new Error(`Regularization can be requested only within ${maxBackdateDays} days of attendance.`);
    }
    const approvalSteps = await resolveReportingApprovalSteps({
      companyId: worker.companyId,
      profileId: worker.approvalProfileId,
      profileType: worker.approvalProfileType,
      managerLevels
    });

    let attachmentPath: string | null = null;
    const attachment = formData.get("attachment");
    if (attachment instanceof File && attachment.size > 0) {
      if (attachment.size > 8 * 1024 * 1024) throw new Error("Attachment must be 8 MB or smaller.");
      const allowedTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
      if (!allowedTypes.has(attachment.type)) throw new Error("Attach a PDF, JPG, PNG or WebP file only.");
      const safeName = attachment.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      attachmentPath = `${worker.companyId}/${worker.profileId}/attendance-regularization-${attendanceDate}-${Date.now()}${fileExtension(safeName)}`;
      const uploadResult = await supabaseAdmin.storage
        .from("employee-profile-documents")
        .upload(attachmentPath, Buffer.from(await attachment.arrayBuffer()), {
          contentType: attachment.type || "application/octet-stream",
          upsert: false
        });
      if (uploadResult.error) throw new Error(uploadResult.error.message);
    }

    const saveResult = await supabaseAdmin.rpc("hr_create_attendance_regularization_with_steps", {
      p_company_id: worker.companyId,
      p_profile_type: worker.profileType,
      p_profile_id: worker.profileId,
      p_dropx_id: worker.dropxId || null,
      p_biometric_id: worker.biometricId || null,
      p_full_name: worker.fullName || null,
      p_attendance_date: attendanceDate,
      p_current_in_time: currentInTime || null,
      p_current_out_time: currentOutTime || null,
      p_requested_in_time: requestedInTime,
      p_requested_out_time: requestedOutTime,
      p_reason_code: reasonCode,
      p_remarks: remarks,
      p_attachment_path: attachmentPath,
      p_steps: approvalSteps
    });
    if (saveResult.error || !saveResult.data) {
      if (attachmentPath) await supabaseAdmin.storage.from("employee-profile-documents").remove([attachmentPath]);
      throw new Error(saveResult.error?.message ?? "Unable to create regularization request.");
    }
    const requestId = String(saveResult.data);
    const requestStatus = "pending_manager";
    await createAppNotification({
      accountId: worker.profileId,
      companyId: worker.companyId,
      data: {
        attendanceDate,
        regularizationRequestId: requestId,
        status: requestStatus,
        approvalSteps: approvalSteps.length
      },
      eventCode: "attendance_regularization_submitted",
      profileType: worker.profileType,
      sourceKey: `${requestId}:${Date.now()}`,
      variables: { date: attendanceDate.split("-").reverse().join("/") }
    });
    return NextResponse.json({ ok: true, request: { id: requestId, status: requestStatus, approvalSteps: approvalSteps.length } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to submit regularization request.";
    const status = message.includes("Login") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
