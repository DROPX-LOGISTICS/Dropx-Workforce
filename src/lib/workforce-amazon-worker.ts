import { requireCompanyId } from "@/lib/company-scope";

function trimEnv(value: string | undefined) {
  return (value ?? "").trim().replace(/^["']|["']$/g, "");
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Worker responses can also contain IDfy-only observations such as `idfy:19901162`. */
export function isCanonicalWorkforceId(value: string | null | undefined) {
  return UUID_PATTERN.test((value ?? "").trim());
}

export function workforceAmazonWorkerConfig() {
  const baseUrl = trimEnv(process.env.WORKFORCE_AMAZON_WORKER_URL || process.env.WORKFORCE_WORKER_URL);
  const adminKey = trimEnv(
    process.env.WORKFORCE_AMAZON_WORKER_KEY ||
      process.env.WORKFORCE_WORKER_ADMIN_KEY ||
      process.env.ADMIN_API_KEY,
  );
  return { baseUrl: baseUrl.replace(/\/$/, ""), adminKey };
}

export async function callWorkforceAmazonWorker<T>(
  path: string,
  init?: RequestInit & { method?: string },
): Promise<T> {
  const { baseUrl, adminKey } = workforceAmazonWorkerConfig();
  if (!baseUrl || !adminKey) {
    throw new Error(
      "Amazon lifecycle worker is not configured. Set WORKFORCE_AMAZON_WORKER_URL and WORKFORCE_AMAZON_WORKER_KEY (or ADMIN_API_KEY).",
    );
  }
  const res = await fetch(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-admin-key": adminKey,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { error: text };
  }
  if (!res.ok) {
    const message =
      typeof json === "object" && json && "error" in json
        ? String((json as { error: unknown }).error)
        : `Worker HTTP ${res.status}`;
    throw new Error(message);
  }
  return json as T;
}

export function invitationNameParts(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "Associate",
    lastName: parts.slice(1).join(" ") || "NA",
  };
}

export function scopedCompanyId(auth: Parameters<typeof requireCompanyId>[0]) {
  return requireCompanyId(auth);
}
