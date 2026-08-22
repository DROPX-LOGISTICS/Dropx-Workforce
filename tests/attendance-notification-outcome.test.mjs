import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAttendanceNotification } from "../src/lib/attendance-notification-outcome.ts";

const policy = {
  fullDayMinutes: 540,
  halfDayMinutes: 270,
  durationBasis: "shift_percentage",
  fullDayPercent: 100,
  halfDayPercent: 50,
  partialDayTreatment: "proportionate",
  singlePunchTreatment: "review",
  oddPunchTreatment: "review",
  belowHalfDayTreatment: "absent",
  unassignedShiftTreatment: "review",
  crossLocationTreatment: "review",
  overtimeThresholdMinutes: 60,
  overtimeTreatment: "review",
  maximumDailyMinutes: 960
};
const shift = { startMinutes: 540, endMinutes: 1_080, graceInMinutes: 0, graceOutMinutes: 0 };

test("six hours of a nine-hour shift produces a configurable proportionate outcome", () => {
  const result = evaluateAttendanceNotification({ inMinutes: 540, outMinutes: 900, punchOrder: 2, shift, workMinutes: 360, policy });
  assert.equal(result?.eventCode, "attendance_short_day");
  assert.equal(result?.payablePercent, 66.67);
  assert.match(result?.outcome ?? "", /Proportionate/);
});

test("the same six-hour case can be configured as half day", () => {
  const result = evaluateAttendanceNotification({ inMinutes: 540, outMinutes: 900, punchOrder: 2, shift, workMinutes: 360, policy: { ...policy, partialDayTreatment: "half_day" } });
  assert.equal(result?.eventCode, "attendance_half_day");
  assert.equal(result?.payablePercent, 50);
});

test("odd punches and cross-location punches are routed for review", () => {
  assert.equal(evaluateAttendanceNotification({ inMinutes: 540, outMinutes: 900, punchOrder: 3, shift, workMinutes: 360, policy })?.eventCode, "attendance_exception_review");
  assert.equal(evaluateAttendanceNotification({ inMinutes: 540, outMinutes: 1_080, punchOrder: 2, shift, workMinutes: 540, crossLocation: true, policy })?.eventCode, "attendance_exception_review");
});

test("overtime beyond the configurable threshold creates an overtime outcome", () => {
  const result = evaluateAttendanceNotification({ inMinutes: 540, outMinutes: 1_170, punchOrder: 2, shift, workMinutes: 630, policy });
  assert.equal(result?.eventCode, "attendance_overtime");
  assert.equal(result?.overtimeMinutes, 30);
});

test("missing shift handling follows the selected policy", () => {
  const result = evaluateAttendanceNotification({ inMinutes: 540, outMinutes: 900, punchOrder: 2, shift: null, workMinutes: 360, policy });
  assert.equal(result?.eventCode, "attendance_exception_review");
});

test("a completed one-hour day is not reported as present", () => {
  const result = evaluateAttendanceNotification({
    finalized: true,
    inMinutes: 1_328,
    outMinutes: 1_402,
    punchOrder: 2,
    shift,
    workMinutes: 74,
    policy: { ...policy, durationBasis: "fixed", unassignedShiftTreatment: "fixed_minutes" }
  });
  assert.equal(result?.eventCode, "attendance_short_day");
  assert.equal(result?.payablePercent, 0);
});

test("a finalized single punch follows the configured single-punch rule", () => {
  const result = evaluateAttendanceNotification({
    finalized: true,
    inMinutes: 540,
    outMinutes: null,
    punchOrder: 1,
    shift,
    workMinutes: 0,
    policy
  });
  assert.equal(result?.eventCode, "attendance_exception_review");
  assert.match(result?.outcome ?? "", /Single punch/);
});
