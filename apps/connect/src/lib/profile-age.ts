const minimumProfileAge = 18;

function dateParts(value: string) {
  const text = value.trim();
  const display = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!display && !iso) return null;

  const year = Number(display?.[3] ?? iso?.[1]);
  const month = Number(display?.[2] ?? iso?.[2]);
  const day = Number(display?.[1] ?? iso?.[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function indiaToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day") };
}

export function minimumAgeError(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.length < 10) return null;

  const birth = dateParts(text);
  if (!birth) return "Enter a valid date of birth.";

  const today = indiaToday();
  let age = today.year - birth.year;
  if (
    today.month < birth.month ||
    (today.month === birth.month && today.day < birth.day)
  ) {
    age -= 1;
  }
  return age < minimumProfileAge
    ? "Profile holder must be at least 18 years old."
    : null;
}

export function assertMinimumProfileAge(value: string | null) {
  if (!value) return;
  const error = minimumAgeError(value);
  if (error) throw new Error(error);
}
