import { createHash, randomInt, randomUUID } from "crypto";

export function cleanPhone(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

export function normalizeMobile(value: unknown, countryCode = "91") {
  const digits = cleanPhone(value);
  const normalizedCountry = cleanPhone(countryCode) || "91";
  if (!digits) return "";
  if (digits.startsWith(normalizedCountry) && digits.length > 10) return digits;
  if (digits.length === 10) return `${normalizedCountry}${digits}`;
  return digits;
}

export function generateOtp() {
  return String(randomInt(100000, 1000000));
}

export function createOtpHash(otp: string, salt: string) {
  return createHash("sha256").update(`${salt}:${otp}`).digest("hex");
}

export function createOtpSecretHash(otp: string) {
  const salt = randomUUID();
  return `${salt}:${createOtpHash(otp, salt)}`;
}

export function verifyOtpHash(otp: string, storedHash: string) {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;
  return createOtpHash(otp, salt) === hash;
}

export function clampOtpExpiryMinutes(value: unknown) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return 10;
  return Math.min(30, Math.max(1, parsed));
}
