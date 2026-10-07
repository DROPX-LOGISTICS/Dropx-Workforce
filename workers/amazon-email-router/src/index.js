const MAX_RAW_BYTES = 512_000;

export function cleanPreview(raw) {
  return raw
    .replace(/=\r?\n/g, "")
    .replace(/=3D/gi, "=")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

function onboardingAction(value) {
  const cleaned = String(value ?? "").trim().replace(/[\]\)}>.,;:!?]+$/g, "");
  if (!cleaned) return null;
  try {
    const url = new URL(cleaned);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (host === "logistics.amazon.in" && url.pathname.startsWith("/account-management/invitation")) return url.toString();
    if (host === "idfy.com" || host.endsWith(".idfy.com")) return url.toString();
    return null;
  } catch {
    return null;
  }
}

export function firstOnboardingActionLink(raw) {
  const decoded = raw.replace(/=\r?\n/g, "").replace(/=3D/gi, "=");
  const links = decoded.match(/https:\/\/[^\s<>"']+/gi) ?? [];
  for (const link of links) {
    const action = onboardingAction(link);
    if (action) return action.slice(0, 2000);
  }
  return null;
}

export default {
  async email(message, env) {
    if (!env.WORKFORCE_INGEST_URL || !env.WORKFORCE_EMAIL_INGEST_SECRET) {
      message.setReject("Email onboarding route is not configured");
      return;
    }
    const raw = (await new Response(message.raw).text()).slice(0, MAX_RAW_BYTES);
    const messageId = message.headers.get("message-id") || `${Date.now()}-${crypto.randomUUID()}`;
    const response = await fetch(env.WORKFORCE_INGEST_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-dropx-email-secret": env.WORKFORCE_EMAIL_INGEST_SECRET,
      },
      body: JSON.stringify({
        actionUrl: firstOnboardingActionLink(raw),
        messageId,
        preview: cleanPreview(raw),
        receivedAt: new Date().toISOString(),
        recipient: message.to,
        sender: message.from,
        subject: message.headers.get("subject") || "",
      }),
    });
    if (response.status === 404) {
      message.setReject("Unknown onboarding address");
      return;
    }
    if (!response.ok) throw new Error(`Workforce email ingest failed (${response.status})`);
  },
};
