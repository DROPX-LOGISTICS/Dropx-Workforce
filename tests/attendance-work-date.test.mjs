import assert from "node:assert/strict";
import test from "node:test";
import { previousIsoDate, shouldContinueOpenAttendanceDay, shouldUsePreviousShiftDate } from "../src/lib/biometric/work-date.ts";

test("previousIsoDate crosses month and year boundaries", () => {
  assert.equal(previousIsoDate("2027-01-01"), "2026-12-31");
  assert.equal(previousIsoDate("2026-08-01"), "2026-07-31");
});

test("an overnight checkout stays on the shift start date", () => {
  assert.equal(shouldUsePreviousShiftDate({
    elapsedFromShiftStartMinutes: 540,
    localPunchMinutes: 300,
    pairingWindowMinutes: 1080,
    shift: { startMinutes: 1200, endMinutes: 300 }
  }), true);
});

test("a daytime shift never claims a next-day punch", () => {
  assert.equal(shouldUsePreviousShiftDate({
    elapsedFromShiftStartMinutes: 1140,
    localPunchMinutes: 300,
    pairingWindowMinutes: 1080,
    shift: { startMinutes: 540, endMinutes: 1080 }
  }), false);
});

test("unassigned workers continue only an open prior attendance day within policy window", () => {
  assert.equal(shouldContinueOpenAttendanceDay({ elapsedMinutes: 600, pairingWindowMinutes: 1080, previousPunchCount: 1 }), true);
  assert.equal(shouldContinueOpenAttendanceDay({ elapsedMinutes: 600, pairingWindowMinutes: 1080, previousPunchCount: 2 }), false);
  assert.equal(shouldContinueOpenAttendanceDay({ elapsedMinutes: 1200, pairingWindowMinutes: 1080, previousPunchCount: 1 }), false);
});
