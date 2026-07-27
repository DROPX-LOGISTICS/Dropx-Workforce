import { supabaseAdmin } from "./supabase-admin";
import type { WorkforceProfileType } from "./workforce-profiles";

export const profileDraftFileSlots = [
  "aadhaar_front",
  "aadhaar_back",
  "pan_upload",
  "dl_front",
  "dl_back",
  "profile_photo"
] as const;

export type ProfileDraftFileSlot = typeof profileDraftFileSlots[number];

export type ProfileDraft = {
  data: Record<string, string>;
  verificationResults: Record<string, unknown>[];
  filePaths: Partial<Record<ProfileDraftFileSlot, string>>;
  updatedAt: string;
};

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringRecord(value: unknown) {
  return Object.fromEntries(
    Object.entries(objectValue(value)).map(([key, item]) => [key, String(item ?? "")])
  );
}

function fileRecord(value: unknown) {
  const allowed = new Set<string>(profileDraftFileSlots);
  return Object.fromEntries(
    Object.entries(objectValue(value))
      .filter(([key, item]) => allowed.has(key) && typeof item === "string" && item)
  ) as Partial<Record<ProfileDraftFileSlot, string>>;
}

function verificationRows(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)));
}

export function isMissingProfileDraftTable(error: unknown) {
  const message = String((error as { message?: unknown })?.message ?? "").toLowerCase();
  return message.includes("mob_app_registration_drafts")
    && (message.includes("schema cache") || message.includes("does not exist"));
}

export async function loadProfileDraft(params: {
  accountId: string;
  companyId: string;
  profileType: WorkforceProfileType;
}): Promise<ProfileDraft | null> {
  if (!supabaseAdmin) return null;
  const result = await supabaseAdmin
    .from("mob_app_registration_drafts")
    .select("draft_data, verification_results, file_paths, updated_at")
    .eq("company_id", params.companyId)
    .eq("profile_type", params.profileType)
    .eq("account_id", params.accountId)
    .maybeSingle();
  if (result.error) {
    if (isMissingProfileDraftTable(result.error)) return null;
    throw new Error(result.error.message);
  }
  if (!result.data) return null;
  return {
    data: stringRecord(result.data.draft_data),
    verificationResults: verificationRows(result.data.verification_results),
    filePaths: fileRecord(result.data.file_paths),
    updatedAt: String(result.data.updated_at ?? "")
  };
}

export async function deleteProfileDraft(params: {
  accountId: string;
  companyId: string;
  profileType: WorkforceProfileType;
}) {
  if (!supabaseAdmin) return;
  const result = await supabaseAdmin
    .from("mob_app_registration_drafts")
    .delete()
    .eq("company_id", params.companyId)
    .eq("profile_type", params.profileType)
    .eq("account_id", params.accountId);
  if (result.error && !isMissingProfileDraftTable(result.error)) {
    throw new Error(result.error.message);
  }
}

export function draftVerificationValues(draft: ProfileDraft | null) {
  return draft?.verificationResults?.length
    ? [JSON.stringify(draft.verificationResults)]
    : [];
}
