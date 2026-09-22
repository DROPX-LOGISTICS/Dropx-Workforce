// Keep auth verification below the routing middleware's 25-second response limit.
// A timeout must never be treated as an authenticated or signed-out session.
export const MIDDLEWARE_AUTH_TIMEOUT_MS = 8_000;

export class MiddlewareAuthTimeout extends Error {
  constructor() {
    super("Authentication verification timed out");
    this.name = "MiddlewareAuthTimeout";
  }
}

export async function withAuthDeadline<T>(
  verify: (signal: AbortSignal) => Promise<T>,
  timeoutMs = MIDDLEWARE_AUTH_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new MiddlewareAuthTimeout());
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([verify(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export function isTemporaryAuthError(error: { name?: string; status?: number } | null) {
  return Boolean(error && (
    error.name === "AuthRetryableFetchError" ||
    error.name === "AuthUnknownError" ||
    error.status === 0 || error.status === 429 || (error.status ?? 0) >= 500
  ));
}
