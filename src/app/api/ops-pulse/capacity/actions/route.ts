import { getAuthorization, hasPermission } from "@/lib/authorization";
import { loadCodLocations } from "@/lib/ops-pulse/cod";
import { isAmazonEdspXptLocation } from "@/lib/ops-pulse/operating-context";
import type { CapacityAiFact } from "@/components/capacity-ai-actions";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

type CacheEntry = { expiresAt: number; actions: Record<string, string> };
const actionCache = new Map<string, CacheEntry>();

function cleanActions(value: unknown, allowed: Set<string>) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([stationCode, action]) => allowed.has(stationCode) && typeof action === "string")
    .map(([stationCode, action]) => [stationCode, String(action).trim().slice(0, 180)]));
}

export async function POST(request: Request) {
  const authorization = await getAuthorization();
  if (!authorization || !hasPermission(authorization, "cps_associates", "access")) {
    return Response.json({ error: "Capacity access denied." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const facts = (Array.isArray(body.facts) ? body.facts : []).slice(0, 50) as CapacityAiFact[];
  const defaults = body.defaults && typeof body.defaults === "object" ? body.defaults as Record<string, string> : {};
  const locations = await loadCodLocations(authorization.companyId!, authorization.locationScopeIds, authorization.hasAllLocationAccess);
  const allowedCodes = new Set(locations.locations.filter(isAmazonEdspXptLocation).map((location) => location.station_code));
  if (!facts.length || facts.some((fact) => !allowedCodes.has(String(fact.stationCode)))) {
    return Response.json({ error: "No permitted station facts supplied." }, { status: 400 });
  }
  const cacheKey = `${authorization.companyId}:${JSON.stringify(facts)}`;
  const cached = actionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return Response.json({ actions: cached.actions, cached: true });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ actions: cleanActions(defaults, allowedCodes), mode: "rules" });
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content: "You are DropX Capacity AI. Return a JSON object named actions mapping every supplied stationCode to exactly one concise operational action of no more than 18 words. Use only supplied facts. Recommend permanent hiring only when status is hire_candidate and sustainedShortage is true. Treat flex, monitor, temporary_surge, low confidence, and insufficient sourceDays as non-hiring actions. Never invent a cause."
          },
          { role: "user", content: JSON.stringify(facts) }
        ],
        model: process.env.OPENAI_VALIDATION_MODEL || "gpt-4o-mini",
        response_format: { type: "json_object" },
        temperature: 0.1
      }),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      method: "POST",
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!response.ok) return Response.json({ actions: cleanActions(defaults, allowedCodes), mode: "rules" });
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(payload.choices?.[0]?.message?.content || "{}");
    const generated = cleanActions(parsed.actions ?? parsed, allowedCodes);
    const actions = Object.fromEntries(facts.map((fact) => [fact.stationCode, generated[fact.stationCode] || defaults[fact.stationCode] || "Review current capacity position."]));
    actionCache.set(cacheKey, { actions, expiresAt: Date.now() + 15 * 60 * 1000 });
    return Response.json({ actions });
  } catch {
    return Response.json({ actions: cleanActions(defaults, allowedCodes), mode: "rules" });
  }
}
