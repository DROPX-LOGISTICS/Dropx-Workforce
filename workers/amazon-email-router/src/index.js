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

export function firstAmazonLink(raw) {
  const decoded = raw.replace(/=\r?\n/g, "").replace(/=3D/gi, "=");
  const links = decoded.match(/https:\/\/[^\s<>"']+/gi) ?? [];
  return links.find((link) => /(^|\.)amazon\.|(^|\.)amzn\.|amazonlogistics|flex/i.test(link))?.slice(0, 2000) ?? null;
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
        actionUrl: firstAmazonLink(raw),
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
