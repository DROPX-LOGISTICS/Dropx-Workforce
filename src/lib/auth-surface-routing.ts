export const DASHBOARD_ORIGIN = "https://dashboard.dropxlogistics.com";
export const WORKFORCE_ORIGIN = "https://workforce.dropxlogistics.com";
export const OPS_ORIGIN = "https://ops.dropxlogistics.com";
export const PLATFORM_ADMIN_ORIGIN = "https://admin-panel.dropxlogistics.com";

const TRUSTED_ORIGINS = new Set([
  DASHBOARD_ORIGIN,
  WORKFORCE_ORIGIN,
  OPS_ORIGIN,
  PLATFORM_ADMIN_ORIGIN
]);

function cleanHost(value: string | null) {
  return String(value ?? "")
    .split(",")[0]
    .trim()
    .split(":")[0]
    .toLowerCase();
}

function trustedOrigin(value: string | null) {
  if (!value) return "";
  try {
    const parsed = new URL(value);
    return TRUSTED_ORIGINS.has(parsed.origin) ? parsed.origin : "";
  } catch {
    return "";
  }
}

export function authOriginFromHeaders(requestHeaders: Headers) {
  const origin = trustedOrigin(requestHeaders.get("origin"));
  if (origin) return origin;

  const referer = trustedOrigin(requestHeaders.get("referer"));
  if (referer) return referer;

  for (const header of ["x-forwarded-host", "host"] as const) {
    const host = cleanHost(requestHeaders.get(header));
    const candidate = trustedOrigin(`https://${host}`);
    if (candidate) return candidate;
  }

  return "http://localhost:3000";
}

export function safeAuthNextPath(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text || !text.startsWith("/") || text.startsWith("//")) return "";

  try {
    const parsed = new URL(text, DASHBOARD_ORIGIN);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "";
  }
}

export function isWorkforceHost(host: string) {
  const normalized = cleanHost(host);
  return normalized === "workforce.dropxlogistics.com" ||
    normalized.startsWith("workforce-") ||
    (normalized.endsWith(".vercel.app") && normalized.includes("workforce"));
}

export function isWorkforceAuthSurface(host: string, surface: string | null) {
  const normalized = cleanHost(host);
  return isWorkforceHost(normalized) ||
    (normalized === "dashboard.dropxlogistics.com" && surface === "workforce");
}

export function authSurfaceOrigin(host: string, surface: string | null, fallbackOrigin: string) {
  return isWorkforceAuthSurface(host, surface) ? WORKFORCE_ORIGIN : fallbackOrigin;
}

export function isWorkforceDestination(path: string) {
  const pathname = safeAuthNextPath(path).split("?")[0];
  return pathname === "/" ||
    pathname === "/delivery-network" || pathname.startsWith("/delivery-network/") ||
    pathname === "/users" || pathname.startsWith("/users/") ||
    pathname === "/unauthorized" ||
    pathname === "/settings/amazon-onboarding" ||
    pathname === "/master/payment-methods";
}

export function workforceDestination(nextPath: string) {
  if (!nextPath) return "/delivery-network";
  if (isWorkforceDestination(nextPath)) return nextPath;
  const denied = new URLSearchParams({ reason: "surface", requested: nextPath });
  return `/unauthorized?${denied.toString()}`;
}
