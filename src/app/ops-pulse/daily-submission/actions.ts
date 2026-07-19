"use server";

import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId, withCompany } from "@/lib/company-scope";
import { clean, dailySubmissionAttachmentFields, dailySubmissionChecklistFields, dateFromForm, required, type CodAttachment } from "@/lib/ops-pulse/cod";
import { uploadOpsProof } from "@/lib/ops-pulse/upload";
import { supabaseAdmin } from "@/lib/supabase-admin";

function redirectWithFlash(params: { error?: string; notice?: string }) {
  cookies().set("dropx_daily_submission_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 25,
    path: "/ops-pulse/daily-submission",
    sameSite: "lax"
  });
  redirect("/ops-pulse/daily-submission");
}

function isNextRedirectError(error: unknown) {
  return typeof (error as { digest?: unknown })?.digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT");
}

async function stationDetails(companyId: string, locationId: string) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const { data, error } = await supabaseAdmin
    .from("stations")
    .select("id, station_code")
    .eq("company_id", companyId)
    .eq("id", locationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Selected station is not available.");
  return data;
}

export async function createDailySubmission(formData: FormData) {
  const authorization = await requirePagePermission("daily_submission", "add");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const locationId = required(formData.get("location_id"), "Station");
    if (!authorization.hasAllLocationAccess && !authorization.locationScopeIds.includes(locationId)) {
      throw new Error("You do not have access to the selected station.");
    }

    const station = await stationDetails(companyId, locationId);
    const submissionId = randomUUID();
    const attachments = (await Promise.all(dailySubmissionAttachmentFields.map(([field, label]) => uploadOpsProof({
      companyId,
      field,
      file: formData.get(field),
      label,
      section: "daily-submissions",
      submissionId
    })))).filter(Boolean) as CodAttachment[];
    const checklistPayload = Object.fromEntries(
      dailySubmissionChecklistFields.map((item) => [item.key, clean(formData.get(item.key))])
    );
    const remittanceCodes = String(formData.get("remittance_codes") ?? "")
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);

    const { error } = await supabaseAdmin.from("ops_daily_submissions").insert(withCompany({
      id: submissionId,
      attachments,
      business_date: dateFromForm(formData.get("business_date"), "Business date"),
      checklist_payload: checklistPayload,
      created_by: authorization.userId,
      location_id: locationId,
      manager_status: "Pending",
      remittance_codes: remittanceCodes,
      station_code: station.station_code,
      status: "Submitted",
      submission_no: `DS-${Date.now().toString(36).toUpperCase()}`,
      submitter_name: clean(formData.get("submitter_name")),
      ai_status: attachments.length ? "Queued" : "Awaiting proof",
      ai_summary: null
    }, companyId));
    if (error) throw new Error(error.message);

    revalidatePath("/ops-pulse/daily-submission");
    redirectWithFlash({ notice: "Daily submission saved for validation." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithFlash({ error: error instanceof Error ? error.message : "Unable to save daily submission." });
  }
}
