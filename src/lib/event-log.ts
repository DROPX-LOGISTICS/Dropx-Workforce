import { requestIp } from "@/lib/connect-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type EventLogInput = {
  companyId: string;
  platform: "dashboard" | "dropx_one_android" | "dropx_one_web";
  eventCode: string;
  module?: string;
  action?: string;
  outcome?: "info" | "success" | "failed" | "warning";
  actorType?: string;
  actorUserId?: string | null;
  actorAccountId?: string | null;
  actorLabel?: string | null;
  actorIdentifier?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  subjectCode?: string | null;
  subjectLabel?: string | null;
  route?: string | null;
  method?: string | null;
  metadata?: Record<string, unknown>;
  request?: Request;
};

const sensitiveKey = /(password|pin|otp|token|secret|authorization|api.?key|aadhaar|aadhar|pan|bank|account|ifsc|document|file|photo)/i;

function cleanText(value: unknown, max = 160) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}

export function safeEventMetadata(value: Record<string, unknown> = {}) {
  const output: Record<string, string | number | boolean | null> = {};
  Object.entries(value).slice(0, 20).forEach(([key, item]) => {
    if (sensitiveKey.test(key)) return;
    if (item == null || typeof item === "number" || typeof item === "boolean") output[key] = item as number | boolean | null;
    else if (typeof item === "string") output[key] = cleanText(item, 200);
  });
  return output;
}

export async function writeEventLog(input: EventLogInput) {
  if (!supabaseAdmin) return;
  const result = await supabaseAdmin.from("dashboard_app_event_logs").insert({
    company_id: input.companyId,
    platform: input.platform,
    event_code: cleanText(input.eventCode, 80) || "unknown",
    module: cleanText(input.module, 80) || "general",
    action: cleanText(input.action, 40) || "view",
    outcome: input.outcome ?? "info",
    actor_type: cleanText(input.actorType, 40) || "dashboard_user",
    actor_user_id: input.actorUserId ?? null,
    actor_account_id: input.actorAccountId ?? null,
    actor_label: cleanText(input.actorLabel, 120) || null,
    actor_identifier: cleanText(input.actorIdentifier, 160) || null,
    subject_type: cleanText(input.subjectType, 60) || null,
    subject_id: input.subjectId ?? null,
    subject_code: cleanText(input.subjectCode, 80) || null,
    subject_label: cleanText(input.subjectLabel, 120) || null,
    route: cleanText(input.route, 240) || null,
    method: cleanText(input.method, 12) || null,
    metadata: safeEventMetadata(input.metadata),
    user_agent: cleanText(input.request?.headers.get("user-agent"), 300) || null,
    ip_address: input.request ? requestIp(input.request) : null
  });
  if (result.error && !result.error.message.toLowerCase().includes("does not exist")) {
    console.warn("Unable to write event log:", result.error.message);
  }
}
