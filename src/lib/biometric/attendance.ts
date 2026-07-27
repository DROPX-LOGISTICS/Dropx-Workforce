import { supabaseAdmin } from "@/lib/supabase-admin";

export type AttendanceReportType =
  | "performance"
  | "in_out"
  | "present"
  | "absent"
  | "late_in"
  | "early_out"
  | "mis_punch";

export type AttendanceReportRow = {
  enrolmentId: string;
  workerCode: string;
  workerName: string;
  workerType: string;
  location: string;
  designation: string;
  punchDate: string;
  inTime: string;
  outTime: string;
  punchTimes: string[];
  workHours: string;
  punchCount: number;
  status: string;
  remark: string;
  deviceSerial: string;
  labels: Record<string, string>;
};

type PunchRow = {
  enrolment_id: string;
  punch_time: string;
  punch_label: string;
  device_serial: string | null;
  calculated: boolean;
};

type DailyRow = {
  enrolment_id: string;
  worker_type: string | null;
  punch_date: string;
  in_time: string | null;
  out_time: string | null;
  punch_count: number | null;
  work_minutes: number | null;
  status: string | null;
  remark: string | null;
  employee_id: string | null;
  field_executive_id: string | null;
  location_id: string | null;
  employee_code: string | null;
  station_code: string | null;
  worker_name: string | null;
};

type EmployeeLookupRow = {
  id: string;
  employee_code: string | null;
  full_name: string | null;
  designation_id: string | null;
};

type ExecutiveLookupRow = {
  id: string;
  dropx_id: string | null;
  full_name: string | null;
  designation: string | null;
};

type DesignationLookupRow = {
  id: string;
  code: string | null;
  name: string | null;
};

type LocationLookupRow = {
  id: string;
  station_code: string | null;
  station_name: string | null;
};

type DailyWorkerSnapshot = {
  workerCode: string | null;
  workerName: string | null;
  stationCode: string | null;
};

function isMissingColumnError(error: { message?: string; code?: string } | null | undefined) {
  if (!error) return false;
  const message = error.message?.toLowerCase() ?? "";
  return error.code === "42703" || message.includes("does not exist") || message.includes("schema cache");
}

function normalizeDailyRows(rows: Partial<DailyRow>[]): DailyRow[] {
  return rows.map((row) => ({
    enrolment_id: String(row.enrolment_id ?? ""),
    worker_type: row.worker_type ?? null,
    punch_date: String(row.punch_date ?? ""),
    in_time: row.in_time ?? null,
    out_time: row.out_time ?? null,
    punch_count: row.punch_count ?? 0,
    work_minutes: row.work_minutes ?? 0,
    status: row.status ?? "P",
    remark: row.remark ?? null,
    employee_id: row.employee_id ?? null,
    field_executive_id: row.field_executive_id ?? null,
    location_id: row.location_id ?? null,
    employee_code: row.employee_code ?? null,
    station_code: row.station_code ?? null,
    worker_name: row.worker_name ?? null
  })).filter((row) => row.enrolment_id && row.punch_date);
}

export function istDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Kolkata",
    year: "numeric"
  }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function formatTime(value: string | Date | null | undefined) {
  if (!value) return "--:--";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata"
  }).format(date);
}

export function formatDuration(minutes: number | null | undefined) {
  const safeMinutes = Math.max(0, Number(minutes ?? 0));
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function punchLabel(position: number) {
  return position === 1 ? "In1" : `Out${position - 1}`;
}

function summarizeFirstInLastOut(punchTimes: string[]) {
  if (punchTimes.length < 2) {
    return { lastOutTime: null, workMinutes: 0 };
  }

  const firstInTime = new Date(punchTimes[0]);
  const lastOutTime = new Date(punchTimes[punchTimes.length - 1]);
  if (Number.isNaN(firstInTime.getTime()) || Number.isNaN(lastOutTime.getTime()) || lastOutTime < firstInTime) {
    return { lastOutTime: null, workMinutes: 0 };
  }

  return {
    lastOutTime: punchTimes[punchTimes.length - 1],
    workMinutes: Math.round((lastOutTime.getTime() - firstInTime.getTime()) / 60000)
  };
}

async function loadDailyWorkerSnapshot({
  companyId,
  employeeId,
  fieldExecutiveId,
  profileType,
  accountId,
  fallbackLocationId
}: {
  companyId: string;
  employeeId?: string | null;
  fallbackLocationId?: string | null;
  fieldExecutiveId?: string | null;
  profileType?: string | null;
  accountId?: string | null;
}): Promise<DailyWorkerSnapshot> {
  if (!supabaseAdmin) return { stationCode: null, workerCode: null, workerName: null };

  let workerCode: string | null = null;
  let workerName: string | null = null;
  let locationId = fallbackLocationId ?? null;

  if (employeeId) {
    const employee = await supabaseAdmin
      .from("employees")
      .select("employee_code, full_name, location_id")
      .eq("company_id", companyId)
      .eq("id", employeeId)
      .maybeSingle();
    if (!employee.error && employee.data) {
      workerCode = employee.data.employee_code ?? null;
      workerName = employee.data.full_name ?? null;
      locationId = employee.data.location_id ?? locationId;
    }
  } else if (accountId && ["field_executive", "contractor", "vendor", "worker"].includes(profileType ?? "")) {
    const table = profileType === "contractor"
      ? "contractors"
      : profileType === "vendor"
        ? "vendors"
        : profileType === "worker"
          ? "workers"
          : "field_executives";
    const executive = await supabaseAdmin
      .from(table)
      .select("dropx_id, full_name, location_id")
      .eq("company_id", companyId)
      .eq("id", accountId)
      .maybeSingle();
    if (!executive.error && executive.data) {
      workerCode = executive.data.dropx_id ?? null;
      workerName = executive.data.full_name ?? null;
      locationId = executive.data.location_id ?? locationId;
    }
  } else if (fieldExecutiveId) {
    const executive = await supabaseAdmin
      .from("field_executives")
      .select("dropx_id, full_name, location_id")
      .eq("company_id", companyId)
      .eq("id", fieldExecutiveId)
      .maybeSingle();
    if (!executive.error && executive.data) {
      workerCode = executive.data.dropx_id ?? null;
      workerName = executive.data.full_name ?? null;
      locationId = executive.data.location_id ?? locationId;
    }
  }

  if (!locationId) return { stationCode: null, workerCode, workerName };

  const station = await supabaseAdmin
    .from("stations")
    .select("station_code")
    .eq("company_id", companyId)
    .eq("id", locationId)
    .maybeSingle();

  return {
    stationCode: station.error ? null : station.data?.station_code ?? null,
    workerCode,
    workerName
  };
}

export async function rebuildAttendanceDay(companyId: string, enrolmentId: string, punchDate: string) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

  const { data, error } = await supabaseAdmin
    .from("attendance_punches")
    .select("id, punch_time")
    .eq("company_id", companyId)
    .eq("enrolment_id", enrolmentId)
    .eq("punch_date", punchDate)
    .eq("calculated", true)
    .order("punch_time", { ascending: true });
  if (error) throw new Error(error.message);

  const punches = data ?? [];
  for (let index = 0; index < punches.length; index += 1) {
    const order = index + 1;
    await supabaseAdmin
      .from("attendance_punches")
      .update({ punch_order: order, punch_label: punchLabel(order) })
      .eq("id", punches[index].id);
  }

  const first = punches[0]?.punch_time ? new Date(punches[0].punch_time) : null;
  const punchTimes = punches.map((punch) => punch.punch_time).filter(Boolean);
  const summary = summarizeFirstInLastOut(punchTimes);
  const remark = punches.length === 0
    ? "No punch"
    : punches.length === 1
      ? "Single punch"
      : null;

  const latestPunch = await supabaseAdmin
    .from("attendance_punches")
    .select("worker_type, employee_id, field_executive_id, profile_type, account_id, location_id")
    .eq("company_id", companyId)
    .eq("enrolment_id", enrolmentId)
    .eq("punch_date", punchDate)
    .eq("calculated", true)
    .order("punch_time", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestPunch.error) throw new Error(latestPunch.error.message);

  const workerSnapshot = await loadDailyWorkerSnapshot({
    companyId,
    employeeId: latestPunch.data?.employee_id ?? null,
    fallbackLocationId: latestPunch.data?.location_id ?? null,
    fieldExecutiveId: latestPunch.data?.field_executive_id ?? null,
    profileType: latestPunch.data?.profile_type ?? null,
    accountId: latestPunch.data?.account_id ?? null
  });

  const basePayload = {
    company_id: companyId,
    enrolment_id: enrolmentId,
    worker_type: latestPunch.data?.worker_type ?? null,
    employee_id: latestPunch.data?.employee_id ?? null,
    field_executive_id: latestPunch.data?.field_executive_id ?? null,
    location_id: latestPunch.data?.location_id ?? null,
    punch_date: punchDate,
    in_time: first?.toISOString() ?? null,
    out_time: summary.lastOutTime,
    punch_count: punches.length,
    work_minutes: summary.workMinutes,
    status: punches.length ? "P" : "A",
    remark,
    updated_at: new Date().toISOString()
  };

  const enrichedPayload = {
    ...basePayload,
    employee_code: workerSnapshot.workerCode,
    station_code: workerSnapshot.stationCode,
    worker_name: workerSnapshot.workerName
  };

  const firstUpsert = await supabaseAdmin
    .from("attendance_daily")
    .upsert(enrichedPayload, { onConflict: "company_id,enrolment_id,punch_date" });

  if (isMissingColumnError(firstUpsert.error)) {
    const fallbackUpsert = await supabaseAdmin
      .from("attendance_daily")
      .upsert(basePayload, { onConflict: "company_id,enrolment_id,punch_date" });
    if (fallbackUpsert.error) throw new Error(fallbackUpsert.error.message);
    return;
  }

  if (firstUpsert.error) throw new Error(firstUpsert.error.message);
}

function reportMatchesType(row: AttendanceReportRow, type: AttendanceReportType) {
  if (type === "present") return row.status === "P";
  if (type === "absent") return row.status === "A";
  if (type === "late_in") return row.remark.toLowerCase().includes("late");
  if (type === "early_out") return row.remark.toLowerCase().includes("early out");
  if (type === "mis_punch") return row.remark.toLowerCase().includes("single") || row.remark.toLowerCase().includes("missing");
  return true;
}

export async function loadAttendanceReportRows({
  companyId,
  date,
  fromDate,
  locationIds,
  reportType,
  toDate
}: {
  companyId: string;
  date?: string;
  fromDate?: string;
  locationIds?: string[];
  reportType: AttendanceReportType;
  toDate?: string;
}) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const admin = supabaseAdmin;

  const baseSelect = `
    enrolment_id,
    worker_type,
    punch_date,
    in_time,
    out_time,
    punch_count,
    work_minutes,
    status,
    remark,
    employee_id,
    field_executive_id,
    location_id,
    employee_code,
    station_code,
    worker_name
  `;
  const fallbackSelect = `
    enrolment_id,
    punch_date,
    in_time,
    out_time,
    punch_count,
    work_minutes,
    status,
    remark
  `;
  const runDailyQuery = async (selectColumns: string, includeLocationFilter: boolean) => {
    let query = admin
      .from("attendance_daily")
      .select(selectColumns)
      .eq("company_id", companyId)
      .order("punch_date", { ascending: false })
      .order("enrolment_id", { ascending: true });

    if (fromDate && toDate) {
      query = query.gte("punch_date", fromDate).lte("punch_date", toDate);
    } else if (date) {
      query = query.eq("punch_date", date);
    }

    if (includeLocationFilter && locationIds?.length) query = query.in("location_id", locationIds);
    return query;
  };

  let dailyResult = await runDailyQuery(baseSelect, true);
  if (isMissingColumnError(dailyResult.error)) {
    dailyResult = await runDailyQuery(fallbackSelect, false);
  }
  if (dailyResult.error) throw new Error(dailyResult.error.message);

  const dailyRows = normalizeDailyRows((dailyResult.data ?? []) as Partial<DailyRow>[]);
  const employeeIds = Array.from(new Set(dailyRows.map((row) => row.employee_id).filter(Boolean))) as string[];
  const executiveIds = Array.from(new Set(dailyRows.map((row) => row.field_executive_id).filter(Boolean))) as string[];
  const dailyLocationIds = Array.from(new Set(dailyRows.map((row) => row.location_id).filter(Boolean))) as string[];
  const [employeeResult, executiveResult, locationResult] = await Promise.all([
    employeeIds.length
      ? supabaseAdmin
        .from("employees")
        .select("id, employee_code, full_name, designation_id")
        .eq("company_id", companyId)
        .in("id", employeeIds)
      : Promise.resolve({ data: [], error: null }),
    executiveIds.length
      ? supabaseAdmin
        .from("field_executives")
        .select("id, dropx_id, full_name, designation")
        .eq("company_id", companyId)
        .in("id", executiveIds)
      : Promise.resolve({ data: [], error: null }),
    dailyLocationIds.length
      ? supabaseAdmin
        .from("stations")
        .select("id, station_code, station_name")
        .eq("company_id", companyId)
        .in("id", dailyLocationIds)
      : Promise.resolve({ data: [], error: null })
  ]);
  if (employeeResult.error) throw new Error(employeeResult.error.message);
  if (executiveResult.error) throw new Error(executiveResult.error.message);
  if (locationResult.error) throw new Error(locationResult.error.message);

  const employeesById = new Map(((employeeResult.data ?? []) as EmployeeLookupRow[]).map((employee) => [employee.id, employee]));
  const executivesById = new Map(((executiveResult.data ?? []) as ExecutiveLookupRow[]).map((executive) => [executive.id, executive]));
  const locationsById = new Map(((locationResult.data ?? []) as LocationLookupRow[]).map((location) => [location.id, location]));
  const designationIds = Array.from(new Set(Array.from(employeesById.values()).map((employee) => employee.designation_id).filter(Boolean))) as string[];
  const designationResult = designationIds.length
    ? await supabaseAdmin.from("designations").select("id, code, name").in("id", designationIds)
    : { data: [], error: null };
  if (designationResult.error) throw new Error(designationResult.error.message);
  const designationsById = new Map(((designationResult.data ?? []) as DesignationLookupRow[]).map((designation) => [designation.id, designation]));

  const punchFilterDates = Array.from(new Set(dailyRows.map((row) => row.punch_date)));
  const enrolmentIds = Array.from(new Set(dailyRows.map((row) => row.enrolment_id)));
  let punchesByKey = new Map<string, PunchRow[]>();

  if (enrolmentIds.length && punchFilterDates.length) {
    let punchQuery = supabaseAdmin
      .from("attendance_punches")
      .select("enrolment_id, punch_time, punch_label, device_serial, calculated")
      .eq("company_id", companyId)
      .eq("calculated", true)
      .in("enrolment_id", enrolmentIds)
      .in("punch_date", punchFilterDates)
      .order("punch_time", { ascending: true });
    if (locationIds?.length) punchQuery = punchQuery.in("location_id", locationIds);
    const punchResult = await punchQuery;
    if (punchResult.error && !isMissingColumnError(punchResult.error)) throw new Error(punchResult.error.message);
    punchesByKey = ((punchResult.data ?? []) as PunchRow[]).reduce((map, punch) => {
      const key = `${punch.enrolment_id}:${istDate(new Date(punch.punch_time))}`;
      const rows = map.get(key) ?? [];
      rows.push(punch);
      map.set(key, rows);
      return map;
    }, new Map<string, PunchRow[]>());
  }

  return dailyRows.map((row) => {
    const employee = row.employee_id ? employeesById.get(row.employee_id) : null;
    const executive = row.field_executive_id ? executivesById.get(row.field_executive_id) : null;
    const designation = employee?.designation_id ? designationsById.get(employee.designation_id) : null;
    const station = row.location_id ? locationsById.get(row.location_id) : null;
    const punches = punchesByKey.get(`${row.enrolment_id}:${row.punch_date}`) ?? [];
    const labels = Object.fromEntries(punches.map((punch) => [punch.punch_label, formatTime(punch.punch_time)]));
    const firstDevice = punches.find((punch) => punch.device_serial)?.device_serial ?? "";
    const reportRow: AttendanceReportRow = {
      enrolmentId: row.enrolment_id,
      workerCode: employee?.employee_code ?? executive?.dropx_id ?? row.employee_code ?? row.enrolment_id,
      workerName: employee?.full_name ?? executive?.full_name ?? row.worker_name ?? "Unknown",
      workerType: row.worker_type === "employee" ? "Employee" : "Individual Contract",
      location: station?.station_code ?? row.station_code ?? "-",
      designation: designation?.code ?? executive?.designation ?? "-",
      punchDate: row.punch_date,
      inTime: formatTime(row.in_time),
      outTime: formatTime(row.out_time),
      punchTimes: punches.map((punch) => formatTime(punch.punch_time)),
      workHours: formatDuration(row.work_minutes),
      punchCount: Number(row.punch_count ?? 0),
      status: row.status ?? "P",
      remark: row.remark ?? "",
      deviceSerial: firstDevice,
      labels
    };
    return reportRow;
  }).filter((row) => reportMatchesType(row, reportType));
}
