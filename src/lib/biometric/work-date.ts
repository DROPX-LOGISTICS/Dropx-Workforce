export type OvernightShift = {
  startMinutes: number;
  endMinutes: number;
};

export function previousIsoDate(date: string) {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

export function shouldUsePreviousShiftDate({
  elapsedFromShiftStartMinutes,
  localPunchMinutes,
  pairingWindowMinutes,
  shift
}: {
  elapsedFromShiftStartMinutes: number;
  localPunchMinutes: number;
  pairingWindowMinutes: number;
  shift: OvernightShift | null;
}) {
  if (!shift || shift.endMinutes > shift.startMinutes) return false;
  if (localPunchMinutes > shift.endMinutes && elapsedFromShiftStartMinutes > pairingWindowMinutes) return false;
  return elapsedFromShiftStartMinutes >= 0 && elapsedFromShiftStartMinutes <= pairingWindowMinutes;
}

export function shouldContinueOpenAttendanceDay({
  elapsedMinutes,
  pairingWindowMinutes,
  previousPunchCount
}: {
  elapsedMinutes: number;
  pairingWindowMinutes: number;
  previousPunchCount: number;
}) {
  return previousPunchCount % 2 === 1 && elapsedMinutes >= 0 && elapsedMinutes <= pairingWindowMinutes;
}
