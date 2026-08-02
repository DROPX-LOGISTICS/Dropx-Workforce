import { requestIp } from "@/lib/connect-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

const sensitiveKey = /(password|pin|otp|token|secret|authorization|api.?key|aadhaar|aadhar|pan|bank|account|ifsc|document|file|photo)/i;

function cleanText(value: unknown, max = 160) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}

function safeMetadata(value: Record<string, unknown> = {}) {
  const output: Record<string, string | number | boolean | null> = {};
  Object.entries(value).slice(0, 20).forEach(([key, item]) => {
    if (sensitiveKey.test(key)) return;
    if (item == null || typeof item === "number" || typeof item === "boolean") output[key] = item as number | boolean | null;
    else if (typeof item === "string") output[key] = cleanText(item, 200);
  });
  return output;
}

export async function writeConnectEvent(input: {
  companyId: string;
  platform: "dropx_one_android" | "dropx_one_web";
  eventCode: string;
  module: string;
  action: string;
  actorType: string;
  actorAccountId: string;
  actorLabel?: string | null;
  actorIdentifier?: string | null;
  subjectCode?: string | null;
  route?: string | null;
  metadata?: Record<string, unknown>;
  request: Request;
}) {
  if (!supabaseAdmin) return;
  const result = await supabaseAdmin.from("dashboard_app_event_logs").insert({
    company_id: input.companyId,
    platform: input.platform,
    event_code: cleanText(input.eventCode, 80) || "app_action",
    module: cleanText(input.module, 80) || "dropx_one",
    action: cleanText(input.action, 40) || "view",
    outcome: "info",
    actor_type: cleanText(input.actorType, 40),
    actor_account_id: input.actorAccountId,
    actor_label: cleanText(input.actorLabel, 120) || null,
    actor_identifier: cleanText(input.actorIdentifier, 160) || null,
    subject_type: cleanText(input.actorType, 60),
    subject_id: input.actorAccountId,
    subject_code: cleanText(input.subjectCode, 80) || null,
    subject_label: cleanText(input.actorLabel, 120) || null,
    route: cleanText(input.route, 240) || null,
    method: input.request.method,
    metadata: safeMetadata(input.metadata),
    user_agent: cleanText(input.request.headers.get("user-agent"), 300) || null,
    ip_address: requestIp(input.request)
  });
  if (result.error && !result.error.message.toLowerCase().includes("does not exist")) {
    console.warn("Unable to write connect event log:", result.error.message);
  }
}
