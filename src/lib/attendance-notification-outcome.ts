export type AttendanceNotificationPolicy = {
  fullDayMinutes: number;
  halfDayMinutes: number;
  durationBasis: "fixed" | "shift_percentage";
  fullDayPercent: number;
  halfDayPercent: number;
  partialDayTreatment: "review" | "half_day" | "proportionate";
  singlePunchTreatment: "review" | "half_day" | "absent";
  oddPunchTreatment: "review" | "half_day" | "absent";
  belowHalfDayTreatment: "review" | "absent" | "proportionate";
  unassignedShiftTreatment: "fixed_minutes" | "review" | "absent";
  crossLocationTreatment: "allow" | "review";
  overtimeThresholdMinutes: number;
  overtimeTreatment: "allow" | "review";
  maximumDailyMinutes: number;
};

export type AttendanceShift = {
  startMinutes: number;
  endMinutes: number;
  graceInMinutes: number;
  graceOutMinutes: number;
};

export type AttendanceNotificationOutcome = {
  eventCode: "attendance_late_in" | "attendance_early_out" | "attendance_half_day" | "attendance_short_day" | "attendance_overtime" | "attendance_exception_review";
  lateMinutes: number;
  earlyMinutes: number;
  overtimeMinutes: number;
  payablePercent: number;
  outcome: string;
};

function relative(value: number, start: number) {
  return value < start - 720 ? value + 1_440 : value;
}

function shiftDuration(shift: AttendanceShift | null) {
  if (!shift) return null;
  const duration = relative(shift.endMinutes, shift.startMinutes) - shift.startMinutes;
  return duration > 0 ? duration : null;
}

export function evaluateAttendanceNotification(input: {
  finalized?: boolean;
  inMinutes: number | null;
  outMinutes: number | null;
  punchOrder: number;
  shift: AttendanceShift | null;
  workMinutes: number;
  crossLocation?: boolean;
  policy: AttendanceNotificationPolicy;
}): AttendanceNotificationOutcome | null {
  const lateMinutes = input.inMinutes !== null && input.shift
    ? Math.max(0, relative(input.inMinutes, input.shift.startMinutes) - (input.shift.startMinutes + Math.max(0, input.shift.graceInMinutes)))
    : 0;
  const earlyMinutes = input.outMinutes !== null && input.shift
    ? Math.max(0, (relative(input.shift.endMinutes, input.shift.startMinutes) - Math.max(0, input.shift.graceOutMinutes)) - relative(input.outMinutes, input.shift.startMinutes))
    : 0;

  if (input.punchOrder === 1 && !input.finalized) {
    return lateMinutes ? { eventCode: "attendance_late_in", lateMinutes, earlyMinutes: 0, overtimeMinutes: 0, payablePercent: 100, outcome: "Late arrival" } : null;
  }

  const workMinutes = Math.max(0, Math.round(input.workMinutes));
  const scheduledMinutes = shiftDuration(input.shift);
  if (workMinutes > input.policy.maximumDailyMinutes) {
    return { eventCode: "attendance_exception_review", lateMinutes, earlyMinutes, overtimeMinutes: 0, payablePercent: 100, outcome: "Worked duration exceeds the configured safety limit" };
  }
  if (input.crossLocation && input.policy.crossLocationTreatment === "review") {
    return { eventCode: "attendance_exception_review", lateMinutes, earlyMinutes, overtimeMinutes: 0, payablePercent: 100, outcome: "Punch received from another location" };
  }
  if (input.punchOrder === 1) {
    if (input.policy.singlePunchTreatment === "half_day") return { eventCode: "attendance_half_day", lateMinutes, earlyMinutes, overtimeMinutes: 0, payablePercent: 50, outcome: "Half day — single punch" };
    if (input.policy.singlePunchTreatment === "absent") return { eventCode: "attendance_short_day", lateMinutes, earlyMinutes, overtimeMinutes: 0, payablePercent: 0, outcome: "Absent — single punch" };
    return { eventCode: "attendance_exception_review", lateMinutes, earlyMinutes, overtimeMinutes: 0, payablePercent: 100, outcome: "Single punch needs review" };
  }
  if (input.punchOrder % 2 === 1) {
    if (input.policy.oddPunchTreatment === "half_day") return { eventCode: "attendance_half_day", lateMinutes, earlyMinutes, overtimeMinutes: 0, payablePercent: 50, outcome: "Half day — odd punch count" };
    if (input.policy.oddPunchTreatment === "absent") return { eventCode: "attendance_short_day", lateMinutes, earlyMinutes, overtimeMinutes: 0, payablePercent: 0, outcome: "Absent — odd punch count" };
    return { eventCode: "attendance_exception_review", lateMinutes, earlyMinutes, overtimeMinutes: 0, payablePercent: 100, outcome: "Odd punch count needs review" };
  }

  const percentageBasis = input.policy.durationBasis === "shift_percentage" && scheduledMinutes !== null;
  if (input.policy.durationBasis === "shift_percentage" && scheduledMinutes === null && input.policy.unassignedShiftTreatment !== "fixed_minutes") {
    const absent = input.policy.unassignedShiftTreatment === "absent";
    return { eventCode: absent ? "attendance_short_day" : "attendance_exception_review", lateMinutes, earlyMinutes, overtimeMinutes: 0, payablePercent: absent ? 0 : 100, outcome: absent ? "Absent — no shift assigned" : "No assigned shift; attendance needs review" };
  }
  const requiredFull = percentageBasis ? Math.max(1, Math.round(scheduledMinutes! * input.policy.fullDayPercent / 100)) : input.policy.fullDayMinutes;
  const requiredHalf = percentageBasis ? Math.max(1, Math.min(requiredFull - 1, Math.round(scheduledMinutes! * input.policy.halfDayPercent / 100))) : input.policy.halfDayMinutes;
  const payablePercent = Math.round(Math.min(100, Math.max(0, workMinutes / Math.max(1, requiredFull) * 100)) * 100) / 100;

  if (workMinutes < requiredHalf) {
    if (input.policy.belowHalfDayTreatment === "proportionate") return { eventCode: "attendance_short_day", lateMinutes, earlyMinutes, overtimeMinutes: 0, payablePercent, outcome: `Proportionate day (${payablePercent}%)` };
    if (input.policy.belowHalfDayTreatment === "review") return { eventCode: "attendance_exception_review", lateMinutes, earlyMinutes, overtimeMinutes: 0, payablePercent: 100, outcome: "Short workday needs review" };
    return { eventCode: "attendance_short_day", lateMinutes, earlyMinutes, overtimeMinutes: 0, payablePercent: 0, outcome: "Absent" };
  }
  if (workMinutes < requiredFull) {
    if (input.policy.partialDayTreatment === "proportionate") return { eventCode: "attendance_short_day", lateMinutes, earlyMinutes, overtimeMinutes: 0, payablePercent, outcome: `Proportionate day (${payablePercent}%)` };
    if (input.policy.partialDayTreatment === "review") return { eventCode: "attendance_exception_review", lateMinutes, earlyMinutes, overtimeMinutes: 0, payablePercent: 100, outcome: "Partial workday needs review" };
    return { eventCode: "attendance_half_day", lateMinutes, earlyMinutes, overtimeMinutes: 0, payablePercent: 50, outcome: "Half day" };
  }

  const overtimeMinutes = scheduledMinutes === null ? 0 : Math.max(0, workMinutes - scheduledMinutes - Math.max(0, input.policy.overtimeThresholdMinutes));
  if (overtimeMinutes && input.policy.overtimeTreatment === "review") {
    return { eventCode: "attendance_overtime", lateMinutes, earlyMinutes, overtimeMinutes, payablePercent: 100, outcome: "Overtime needs review" };
  }
  if (earlyMinutes) {
    return { eventCode: "attendance_early_out", lateMinutes, earlyMinutes, overtimeMinutes, payablePercent: 100, outcome: "Early departure" };
  }
  return null;
}
