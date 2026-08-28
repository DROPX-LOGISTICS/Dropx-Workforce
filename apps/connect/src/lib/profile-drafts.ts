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

async function legacyWorkforceIdentity(params: {
  accountId: string;
  companyId: string;
  profileType: WorkforceProfileType;
}) {
  if (!supabaseAdmin || params.profileType !== "workforce") return null;
  const result = await supabaseAdmin
    .from("workforce_identity_links")
    .select("legacy_profile_type, legacy_profile_id")
    .eq("company_id", params.companyId)
    .eq("target_profile_type", "workforce")
    .eq("target_profile_id", params.accountId)
    .eq("compatibility_active", true)
    .maybeSingle();
  if (result.error) return null;
  return result.data;
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
  let draftRow = result.data;
  if (!draftRow) {
    const legacy = await legacyWorkforceIdentity(params);
    if (legacy) {
      const legacyResult = await supabaseAdmin
        .from("mob_app_registration_drafts")
        .select("draft_data, verification_results, file_paths, updated_at")
        .eq("company_id", params.companyId)
        .eq("profile_type", legacy.legacy_profile_type)
        .eq("account_id", legacy.legacy_profile_id)
        .maybeSingle();
      if (legacyResult.error && !isMissingProfileDraftTable(legacyResult.error)) {
        throw new Error(legacyResult.error.message);
      }
      draftRow = legacyResult.data;
    }
  }
  if (!draftRow) return null;
  return {
    data: stringRecord(draftRow.draft_data),
    verificationResults: verificationRows(draftRow.verification_results),
    filePaths: fileRecord(draftRow.file_paths),
    updatedAt: String(draftRow.updated_at ?? "")
  };
}

export async function deleteLegacyWorkforceDraft(params: {
  accountId: string;
  companyId: string;
  profileType: WorkforceProfileType;
}) {
  if (!supabaseAdmin) return;
  const legacy = await legacyWorkforceIdentity(params);
  if (!legacy) return;
  const result = await supabaseAdmin
    .from("mob_app_registration_drafts")
    .delete()
    .eq("company_id", params.companyId)
    .eq("profile_type", legacy.legacy_profile_type)
    .eq("account_id", legacy.legacy_profile_id);
  if (result.error && !isMissingProfileDraftTable(result.error)) {
    throw new Error(result.error.message);
  }
}

export async function mirrorLegacyWorkforceDraft(params: {
  accountId: string;
  companyId: string;
  draftData: Record<string, unknown>;
  filePaths: Partial<Record<ProfileDraftFileSlot, string>>;
  profileType: WorkforceProfileType;
  updatedAt: string;
  verificationResults: Record<string, unknown>[];
}) {
  if (!supabaseAdmin) return;
  const legacy = await legacyWorkforceIdentity(params);
  if (!legacy) return;
  const result = await supabaseAdmin.from("mob_app_registration_drafts").upsert({
    company_id: params.companyId,
    profile_type: legacy.legacy_profile_type,
    account_id: legacy.legacy_profile_id,
    draft_data: params.draftData,
    verification_results: params.verificationResults,
    file_paths: params.filePaths,
    updated_at: params.updatedAt
  }, { onConflict: "company_id,profile_type,account_id" });
  if (result.error && !isMissingProfileDraftTable(result.error)) {
    throw new Error(result.error.message);
  }
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
  await deleteLegacyWorkforceDraft(params);
}

export function draftVerificationValues(draft: ProfileDraft | null) {
  return draft?.verificationResults?.length
    ? [JSON.stringify(draft.verificationResults)]
    : [];
}
