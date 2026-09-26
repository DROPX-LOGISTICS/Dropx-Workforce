export type AmazonGuidanceRule = {
  match_text: string;
  stage_code: string;
  instruction: string;
  priority: number;
};

export type AmazonActivationState = {
  stage: string;
  label: string;
  instruction: string;
  severity: "neutral" | "warning" | "danger" | "success";
};

export function cleanAmazonText(value: unknown) {
  return String(value ?? "").trim();
}

export function amazonKey(value: unknown) {
  return cleanAmazonText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function findAmazonField(record: Record<string, unknown>, aliases: string[]) {
  const wanted = aliases.map(amazonKey);
  const exact = Object.entries(record).find(([label]) => wanted.includes(amazonKey(label)));
  if (exact) return cleanAmazonText(exact[1]);
  const partial = Object.entries(record).find(([label]) => wanted.some((alias) => amazonKey(label).includes(alias)));
  return cleanAmazonText(partial?.[1]);
}

export function isAmazonOnboardingRecord(record: Record<string, unknown>) {
  const labels = Object.keys(record).map(amazonKey);
  return labels.some((label) => label.includes("email") || label.includes("mailid") || label === "rabbitid" || label === "loginid")
    && labels.some((label) => label.includes("station") || label.includes("servicearea"))
    && labels.some((label) => label.includes("status") || label.includes("task") || label.includes("transporter"));
}

function inferredStage(status: string) {
  const value = amazonKey(status);
  if (/nofurtheractionrequired/.test(value)) return "activated";
  if (/active|completed|complete|cleared|provisioned/.test(value)) return "activated";
  if (/fail|reject|error|insufficient|mismatch|duplicate|blocked/.test(value)) return "failed";
  if (/background|bgc|idfy|video/.test(value)) return value.includes("video") || value.includes("idfy") ? "video_verification" : "background_check";
  if (/learn|course|training|lmlearning|nsda|nhda/.test(value)) return "learning";
  if (/licen|driving|dl/.test(value)) return "licence";
  if (/photo|document|pan|aadhaar|aadhar/.test(value)) return "documents";
  if (/basic|personal|profile|address/.test(value)) return "basic_details";
  if (/account|privacy|agreement|terms/.test(value)) return "account";
  if (/invite|invitation/.test(value)) return "invitation";
  if (/provision|badge|virtualid|setup/.test(value)) return "provisioning";
  return "other";
}

const labels: Record<string, string> = {
  invitation: "Invitation pending", account: "Account setup pending", basic_details: "Basic details pending",
  documents: "Documents pending", licence: "Licence verification pending", background_check: "Background check pending",
  video_verification: "Video verification pending", learning: "Amazon learning pending", provisioning: "Provisioning pending",
  activated: "Amazon ID active", failed: "Activation exception", other: "Amazon action pending"
};

export function resolveAmazonActivation(status: string, sourceAction: string, rules: AmazonGuidanceRule[]): AmazonActivationState {
  const haystack = `${status} ${sourceAction}`.toLowerCase();
  const rule = [...rules].filter((candidate) => haystack.includes(candidate.match_text.trim().toLowerCase()))
    .sort((a, b) => a.priority - b.priority || b.match_text.length - a.match_text.length)[0];
  const stage = rule?.stage_code || inferredStage(haystack);
  const instruction = rule?.instruction || sourceAction.trim() || "Review the latest Amazon onboarding task and contact the associate.";
  return { stage, label: labels[stage] || labels.other, instruction,
    severity: stage === "activated" ? "success" : stage === "failed" ? "danger" : stage === "other" ? "neutral" : "warning" };
}

export function normalizeSourcePortal(value: unknown): "workforce" | "ops_pulse" | "recruit" {
  const source = cleanAmazonText(value).toLowerCase();
  if (source.includes("recruit")) return "recruit";
  if (source.includes("ops") || source.includes("station")) return "ops_pulse";
  return "workforce";
}

function token(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
export function amazonEmailFromPattern(pattern: string, fullName: string, stationCode: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = token(parts[0] || "");
  const last = token(parts.slice(1).join(""));
  return pattern.trim().toLowerCase()
    .replaceAll("{first_name}", first)
    .replaceAll("{last_name}", last)
    .replaceAll("{full_name}", token(fullName))
    .replaceAll("{station_code}", token(stationCode));
}

export function validAmazonEmailPattern(pattern: string) {
  const value = pattern.trim().toLowerCase();
  return value.includes("@") && value.includes("{station_code}")
    && (value.includes("{first_name}") || value.includes("{full_name}"));
}
