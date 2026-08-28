import { supabaseAdmin } from "./supabase-admin";
import type { WorkforceProfileType } from "./workforce-profiles";

type VerificationKind = "pan" | "pan_aadhaar" | "dl" | "vehicle" | "bank" | "pf_uan";
type ProfileType = WorkforceProfileType;

function text(value: unknown) {
  return String(value ?? "").trim();
}

export function isMissingVerificationTable(error: unknown) {
  const message = String((error as { message?: unknown })?.message ?? "").toLowerCase();
  return message.includes("connect_profile_verifications") || message.includes("schema cache") || message.includes("does not exist");
}

export async function saveProfileVerifications({
  accountId,
  companyId,
  profileType,
  values
}: {
  accountId: string;
  companyId: string;
  profileType: ProfileType;
  values: FormDataEntryValue[] | string[];
}) {
  if (!supabaseAdmin) return;
  const legacyIdentity = profileType === "workforce"
    ? await supabaseAdmin
      .from("workforce_identity_links")
      .select("legacy_profile_type, legacy_profile_id")
      .eq("company_id", companyId)
      .eq("target_profile_type", "workforce")
      .eq("target_profile_id", accountId)
      .eq("compatibility_active", true)
      .maybeSingle()
    : null;
  const seen = new Set<string>();
  for (const value of values) {
    const raw = text(value);
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const record = row as Record<string, unknown>;
      const kind = text(record.kind) as VerificationKind;
      if (!["pan", "pan_aadhaar", "dl", "vehicle", "bank", "pf_uan"].includes(kind)) continue;
      const inputKey = text(record.inputKey);
      if (!inputKey) continue;
      const key = `${kind}:${inputKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const verificationPayload = {
        company_id: companyId,
        profile_type: profileType,
        account_id: accountId,
        kind,
        input_key: inputKey,
        verified: record.verified === true,
        manual_review: record.manualReview === true,
        block_submit: record.blockSubmit === true,
        display_name: text(record.name || record.accountName || record.ownerName),
        message: text(record.message || record.warning),
        details: { ...record, kind },
        verified_at: record.verified === true ? new Date().toISOString() : null,
        updated_at: new Date().toISOString()
      };
      const saveResult = await supabaseAdmin.from("connect_profile_verifications").upsert(
        verificationPayload,
        { onConflict: "company_id,profile_type,account_id,kind" }
      );
      if (saveResult.error && !isMissingVerificationTable(saveResult.error)) {
        throw new Error(saveResult.error.message);
      }
      if (!saveResult.error && legacyIdentity?.data) {
        const legacySave = await supabaseAdmin.from("connect_profile_verifications").upsert({
          ...verificationPayload,
          profile_type: legacyIdentity.data.legacy_profile_type,
          account_id: legacyIdentity.data.legacy_profile_id
        }, { onConflict: "company_id,profile_type,account_id,kind" });
        if (legacySave.error && !isMissingVerificationTable(legacySave.error)) {
          throw new Error(legacySave.error.message);
        }
      }
    }
  }
}
