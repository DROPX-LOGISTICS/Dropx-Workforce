import "server-only";

type CloudflareRule = {
  id?: string;
  actions?: Array<{ type?: string; value?: string[] }>;
  matchers?: Array<{ field?: string; type?: string; value?: string }>;
};

type CloudflareResponse<T> = {
  errors?: Array<{ message?: string }>;
  result?: T;
  success?: boolean;
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function errorMessage(payload: CloudflareResponse<unknown>, status: number) {
  return payload.errors?.map((item) => item.message).filter(Boolean).join("; ") || `Cloudflare returned ${status}`;
}

export async function ensureAmazonEmailRoute(aliasEmail: string) {
  const provider = required("AMAZON_EMAIL_ROUTING_PROVIDER").toLowerCase();
  if (provider === "resend") {
    const domain = required("RESEND_INBOUND_DOMAIN").toLowerCase();
    const alias = aliasEmail.trim().toLowerCase();
    if (!alias.endsWith(`@${domain}`) || alias.length > 90) {
      throw new Error(`Generated address must use the configured ${domain} inbound domain`);
    }
    return `resend:${domain}`;
  }
  if (provider !== "cloudflare") throw new Error(`Unsupported email routing provider: ${provider}`);
  const token = required("CLOUDFLARE_EMAIL_ROUTING_API_TOKEN");
  const zoneId = required("CLOUDFLARE_EMAIL_ROUTING_ZONE_ID");
  const domain = required("CLOUDFLARE_EMAIL_ROUTING_DOMAIN").toLowerCase();
  const worker = process.env.CLOUDFLARE_EMAIL_ROUTING_WORKER?.trim() || "dropx-amazon-email-router";
  const alias = aliasEmail.trim().toLowerCase();
  if (!alias.endsWith(`@${domain}`) || alias.length > 90) {
    throw new Error(`Generated address must use the configured ${domain} routing domain`);
  }
  const endpoint = `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zoneId)}/email/routing/rules`;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const existingResponse = await fetch(`${endpoint}?page=1&per_page=100`, { headers, cache: "no-store" });
  const existingPayload = await existingResponse.json() as CloudflareResponse<CloudflareRule[]>;
  if (!existingResponse.ok || !existingPayload.success) {
    throw new Error(errorMessage(existingPayload, existingResponse.status));
  }
  const existing = existingPayload.result?.find((rule) =>
    rule.matchers?.some((matcher) => matcher.type === "literal" && matcher.field === "to" && matcher.value?.toLowerCase() === alias)
    && rule.actions?.some((action) => action.type === "worker" && action.value?.includes(worker))
  );
  if (existing?.id) return existing.id;

  const createResponse = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      actions: [{ type: "worker", value: [worker] }],
      enabled: true,
      matchers: [{ field: "to", type: "literal", value: alias }],
      name: `Amazon onboarding · ${alias}`,
      source: "api",
    }),
    cache: "no-store",
  });
  const createPayload = await createResponse.json() as CloudflareResponse<CloudflareRule>;
  if (!createResponse.ok || !createPayload.success || !createPayload.result?.id) {
    throw new Error(errorMessage(createPayload, createResponse.status));
  }
  return createPayload.result.id;
}
