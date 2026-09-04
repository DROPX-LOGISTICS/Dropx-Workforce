import { createHash } from "node:crypto";

export function workforceNotificationId(companyId: string, actorId: string, submissionKey: string, recipientKey: string) {
  const hex = createHash("sha256").update(JSON.stringify([companyId, actorId, submissionKey, recipientKey])).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
