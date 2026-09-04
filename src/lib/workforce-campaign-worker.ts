import { createHmac, timingSafeEqual } from "node:crypto";

function signature(campaignId: string, timestamp: string, secret: string) {
  return createHmac("sha256", secret).update(`workforce-campaign:${campaignId}:${timestamp}`).digest("hex");
}

export function campaignWorkerHeaders(campaignId: string) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Campaign worker authentication is not configured.");
  const timestamp = String(Date.now());
  return {
    "x-workforce-campaign": campaignId,
    "x-workforce-worker-time": timestamp,
    "x-workforce-worker-signature": signature(campaignId, timestamp, secret)
  };
}

/** Only a configured cron or a short-lived, campaign-bound internal request can process messages. */
export function authorizeCampaignWorker(request: Request): { campaignId: string | null } | null {
  const cron = process.env.CRON_SECRET?.trim();
  if (cron && request.headers.get("authorization") === `Bearer ${cron}`) return { campaignId: null };
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const campaignId = request.headers.get("x-workforce-campaign") ?? "";
  const timestamp = request.headers.get("x-workforce-worker-time") ?? "";
  const supplied = request.headers.get("x-workforce-worker-signature") ?? "";
  if (!secret || !/^[0-9a-f-]{36}$/i.test(campaignId) || !/^\d+$/.test(timestamp)
    || Math.abs(Date.now() - Number(timestamp)) > 60000 || !/^[0-9a-f]{64}$/.test(supplied)) return null;
  const expected = signature(campaignId, timestamp, secret);
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)) ? { campaignId } : null;
}
