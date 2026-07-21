import { createHash } from "crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { connectSessionCookieName, normalizeConnectMobile } from "@/lib/connect-auth";
import { loadAttendanceReportRows } from "@/lib/biometric/attendance";
import { supabaseAdmin } from "@/lib/supabase-admin";

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
  if (profileType === "employee") {
    const result = await supabaseAdmin
      .from("employees")
      .select("id, company_id, mobile, mobile_country_code, biometric_id")
      .eq("id", accountId)
      .maybeSingle();
    if (result.error) throw new Error(result.error.message);
    const row = result.data;
    if (!row) throw new Error("Employee account not found.");
    const rowMobile = String(row.mobile ?? "").replace(/\D/g, "");
    const rowCountryCode = String(row.mobile_country_code ?? countryCode).replace(/\D/g, "") || countryCode;
    if (rowCountryCode !== countryCode || (rowMobile !== mobile && rowMobile !== localMobile)) {
      throw new Error("This attendance is not available for the signed-in account.");
    }
    const enrolmentId = cleanEnrolmentId(row.biometric_id);
    return {
      companyId: row.company_id as string,
      filter: (item: Awaited<ReturnType<typeof loadAttendanceReportRows>>[number]) => Boolean(enrolmentId) && cleanEnrolmentId(item.enrolmentId) === enrolmentId
    };
  }
  if (profileType === "field_executive") {
    const result = await supabaseAdmin
      .from("field_executives")
      .select("id, company_id, mobile, mobile_country_code, biometric_id")
      .eq("id", accountId)
      .maybeSingle();
    if (result.error) throw new Error(result.error.message);
    const row = result.data;
    if (!row) throw new Error("Field executive account not found.");
    const rowMobile = String(row.mobile ?? "").replace(/\D/g, "");
    const rowCountryCode = String(row.mobile_country_code ?? countryCode).replace(/\D/g, "") || countryCode;
    if (rowCountryCode !== countryCode || (rowMobile !== mobile && rowMobile !== localMobile)) {
      throw new Error("This attendance is not available for the signed-in account.");
    }
    const enrolmentId = cleanEnrolmentId(row.biometric_id);
    return {
      companyId: row.company_id as string,
      filter: (item: Awaited<ReturnType<typeof loadAttendanceReportRows>>[number]) => Boolean(enrolmentId) && cleanEnrolmentId(item.enrolmentId) === enrolmentId
    };
  }
  throw new Error("Attendance is available for employees and field executives only.");
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
      fromDate: range.fromDate,
      toDate: range.toDate,
      reportType: "performance"
    })).filter(worker.filter);
    const present = rows.filter((row) => row.status === "P").length;
    const absent = rows.filter((row) => row.status === "A").length;
    const misPunch = rows.filter((row) => row.remark.toLowerCase().includes("single") || row.remark.toLowerCase().includes("missing")).length;

    return NextResponse.json({
      month: range.label,
      summary: {
        totalRows: rows.length,
        present,
        absent,
        misPunch
      },
      rows: rows.map((row) => ({
        date: row.punchDate,
        status: row.status,
        inTime: row.inTime,
        outTime: row.outTime,
        workHours: row.workHours,
        punchCount: row.punchCount,
        remark: row.remark
      }))
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load attendance.";
    const status = message.includes("Login") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
