"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAuthorization, isCompanyOwner } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { dynamicWorkforceTable, isCustomWorkforceCategoryCode, normalizeWorkforceCategoryCode } from "@/lib/dynamic-workforce";
import { writeEventLog } from "@/lib/event-log";
import { profileDocumentBucket } from "@/lib/profile-document-storage";
import { supabaseAdmin } from "@/lib/supabase-admin";

const documentPathColumns = [
  "aadhaar_front_path",
  "aadhaar_back_path",
  "pan_upload_path",
  "dl_front_path",
  "dl_back_path",
  "profile_photo_path"
] as const;

const systemSources = {
  employees: { table: "employees", label: "employee", codeField: "employee_code" },
  field_executives: { table: "field_executives", label: "field executive", codeField: "dropx_id" },
  contractors: { table: "contractors", label: "independent contractor", codeField: "dropx_id" },
  vendors: { table: "vendors", label: "vendor", codeField: "dropx_id" },
  workers: { table: "workers", label: "worker", codeField: "dropx_id" }
} as const;

type ProfileSource = {
  table: string;
  label: string;
  codeField: string;
};

function required(value: FormDataEntryValue | null, field: string) {
  const clean = String(value ?? "").trim();
  if (!clean) throw new Error(`${field} is required.`);
  return clean;
}

function allPeopleRedirect(params: { error?: string; notice?: string }): never {
  const search = new URLSearchParams();
  if (params.error) search.set("error", params.error);
  if (params.notice) search.set("notice", params.notice);
  redirect(`/people/all${search.size ? `?${search.toString()}` : ""}`);
}

function isNextRedirectError(error: unknown) {
  return typeof (error as { digest?: unknown })?.digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT");
}

function friendlyDeleteError(error: unknown) {
  const code = String((error as { code?: unknown })?.code ?? "");
  const message = String((error as { message?: unknown })?.message ?? "");
  if (code === "23503" || message.toLowerCase().includes("foreign key constraint")) {
    return "This profile has linked attendance, payroll, leave, mapping, or lifecycle history and cannot be permanently deleted. Deactivate or offboard the person instead.";
  }
  if (message === "Profile was not found.") return message;
  return "Unable to delete the profile. Please try again.";
}

async function resolveProfileSource(companyId: string, categoryCode: string): Promise<ProfileSource> {
  const systemSource = systemSources[categoryCode as keyof typeof systemSources];
  if (systemSource) return systemSource;
  if (!isCustomWorkforceCategoryCode(categoryCode) || !supabaseAdmin) {
    throw new Error("Profile category is invalid.");
  }

  const { data, error } = await supabaseAdmin
    .from("workforce_categories")
    .select("name")
    .eq("company_id", companyId)
    .eq("code", categoryCode)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Profile category is invalid.");

  return {
    table: dynamicWorkforceTable(categoryCode),
    label: String(data.name ?? "workforce profile").trim().toLowerCase() || "workforce profile",
    codeField: "dropx_id"
  };
}

async function removeProfileDocuments(paths: string[]) {
  if (!supabaseAdmin || !paths.length) return null;
  const { error } = await supabaseAdmin.storage.from(profileDocumentBucket).remove(paths);
  return error?.message ?? null;
}

export async function deletePeopleProfile(formData: FormData) {
  const authorization = await getAuthorization();
  if (!authorization) redirect("/login");
  if (!isCompanyOwner(authorization)) redirect("/unauthorized?page=people_all&action=delete");
  const companyId = requireCompanyId(authorization);

  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const profileId = required(formData.get("profile_id"), "Profile");
    const categoryCode = normalizeWorkforceCategoryCode(required(formData.get("category_code"), "Profile category"));
    const source = await resolveProfileSource(companyId, categoryCode);
    const selectColumns = ["id", "full_name", source.codeField, ...documentPathColumns].join(", ");

    const { data: profile, error: loadError } = await supabaseAdmin
      .from(source.table)
      .select(selectColumns)
      .eq("company_id", companyId)
      .eq("id", profileId)
      .maybeSingle();
    if (loadError) throw loadError;
    if (!profile) throw new Error("Profile was not found.");
    const profileRecord = profile as unknown as Record<string, unknown>;

    const { data: deleted, error: deleteError } = await supabaseAdmin
      .from(source.table)
      .delete()
      .eq("company_id", companyId)
      .eq("id", profileId)
      .select("id")
      .maybeSingle();
    if (deleteError) throw deleteError;
    if (!deleted) throw new Error("Profile was not found.");

    const documentPaths = documentPathColumns
      .map((column) => String(profileRecord[column] ?? "").trim())
      .filter(Boolean);
    const documentCleanupError = await removeProfileDocuments(Array.from(new Set(documentPaths)));
    const profileName = String(profileRecord.full_name ?? "").trim() || "Profile";
    const profileCode = String(profileRecord[source.codeField] ?? "").trim() || null;

    await writeEventLog({
      companyId,
      platform: "dashboard",
      eventCode: "workforce.profile_deleted",
      module: "people",
      action: "delete",
      outcome: documentCleanupError ? "warning" : "success",
      actorUserId: authorization.userId,
      actorLabel: authorization.fullName,
      actorIdentifier: authorization.email,
      subjectType: categoryCode,
      subjectId: profileId,
      subjectCode: profileCode,
      subjectLabel: profileName,
      route: "/people/all",
      method: "POST",
      metadata: {
        category: source.label,
        document_cleanup_failed: Boolean(documentCleanupError)
      }
    });

    if (documentCleanupError) {
      console.warn(`Profile ${profileId} was deleted, but document cleanup failed: ${documentCleanupError}`);
    }
    revalidatePath("/people/all");
    allPeopleRedirect({ notice: `${profileName} was permanently deleted.` });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    console.error("Unable to delete workforce profile:", error);
    allPeopleRedirect({ error: friendlyDeleteError(error) });
  }
}
