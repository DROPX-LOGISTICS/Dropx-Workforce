import { workforceAmazonWorkerConfig } from "@/lib/workforce-amazon-worker";

export async function callMarshWorker<T>(path: string, init?: RequestInit): Promise<T> {
  const { baseUrl, adminKey } = workforceAmazonWorkerConfig();
  if (!baseUrl || !adminKey) {
    throw new Error("Workforce worker is not configured. Set WORKFORCE_AMAZON_WORKER_URL and WORKFORCE_AMAZON_WORKER_KEY.");
  }
  const res = await fetch(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-admin-key": adminKey,
      ...(init?.headers ?? {})
    },
    cache: "no-store"
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

export type MarshSessionView = {
  ok?: boolean;
  credentialsConfigured: boolean;
  status: string;
  challengeId: string | null;
  lastError: string | null;
  updatedAt: string | null;
  uploadedAt: string | null;
  cookiePresent: boolean;
  cookieAgeSeconds: number | null;
  driveConfigured?: boolean;
};
