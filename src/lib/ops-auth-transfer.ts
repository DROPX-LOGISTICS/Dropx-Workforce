import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

type OpsAuthTransferPayload = {
  access_token: string;
  expires_at: number;
  refresh_token: string;
};

function transferKey() {
  const secret = process.env.OPS_AUTH_TRANSFER_SECRET ??
    process.env.OPS_PORTAL_WORKER_SECRET ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Ops authentication transfer is not configured.");
  return createHash("sha256").update(`dropx-ops-auth:${secret}`).digest();
}

export function createOpsAuthTransfer(accessToken: string, refreshToken: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", transferKey(), iv);
  const payload: OpsAuthTransferPayload = {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: Date.now() + 2 * 60 * 1000
  };
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function readOpsAuthTransfer(token: string): OpsAuthTransferPayload {
  const value = Buffer.from(token, "base64url");
  if (value.length < 29) throw new Error("Invalid Ops authentication transfer.");
  const iv = value.subarray(0, 12);
  const tag = value.subarray(12, 28);
  const encrypted = value.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", transferKey(), iv);
  decipher.setAuthTag(tag);
  const payload = JSON.parse(
    Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")
  ) as OpsAuthTransferPayload;
  if (!payload.access_token || !payload.refresh_token || payload.expires_at < Date.now()) {
    throw new Error("Ops authentication transfer expired.");
  }
  return payload;
}
