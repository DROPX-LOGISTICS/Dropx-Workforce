"use server";

import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId, withCompany } from "@/lib/company-scope";
import {
  clean,
  clientForFormType,
  dateFromForm,
  depositSlipAttachmentFields,
  inferFormTypeFromLocation,
  numberFromForm,
  required,
  type CodAttachment,
  type CodLocationRow
} from "@/lib/ops-pulse/cod";
import { uploadOpsProof } from "@/lib/ops-pulse/upload";
import { supabaseAdmin } from "@/lib/supabase-admin";

function redirectWithFlash(params: { error?: string; notice?: string }) {
  cookies().set("dropx_cod_submission_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 25,
    path: "/ops-pulse/cod/submission",
    sameSite: "lax"
  });
  redirect("/ops-pulse/cod/submission");
}

function isNextRedirectError(error: unknown) {
  return typeof (error as { digest?: unknown })?.digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT");
}

async function stationDetails(companyId: string, locationId: string) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const { data, error } = await supabaseAdmin
    .from("stations")
    .select("id, station_code, station_name, state, providers (code, name), location_models (code, name)")
    .eq("company_id", companyId)
    .eq("id", locationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Selected station is not available.");
  return data as CodLocationRow;
}

export async function createCodSubmission(formData: FormData) {
  const authorization = await requirePagePermission("cod_submission", "add");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const locationId = required(formData.get("location_id"), "Station");
    if (!authorization.hasAllLocationAccess && !authorization.locationScopeIds.includes(locationId)) {
      throw new Error("You do not have access to the selected station.");
    }

    const station = await stationDetails(companyId, locationId);
    const inferredFormType = inferFormTypeFromLocation(station);
    const submissionId = randomUUID();
    const depositAttachments = (await Promise.all(depositSlipAttachmentFields.map(([field, label]) => uploadOpsProof({
      companyId,
      field,
      file: formData.get(field),
      label,
      section: "cod-submissions",
      submissionId
    })))).filter(Boolean) as CodAttachment[];

    const amount = numberFromForm(formData.get("deposited_amount"), "Deposited amount");
    const codPeriodFrom = dateFromForm(formData.get("cod_period_from"), "COD from date");
    const codPeriodTo = dateFromForm(formData.get("cod_period_to") || formData.get("cod_period_from"), "COD to date");

    const { error } = await supabaseAdmin.from("cod_submissions").insert(withCompany({
      id: submissionId,
      attachments: depositAttachments,
      client: inferredFormType ? clientForFormType(inferredFormType) : null,
      cod_amount: amount,
      cod_date: codPeriodFrom,
      cod_period_from: codPeriodFrom,
      cod_period_to: codPeriodTo,
      created_by: authorization.userId,
      deposit_date: dateFromForm(formData.get("deposit_date"), "Deposit date"),
      deposit_slip_attachments: depositAttachments,
      deposited_amount: amount,
      form_type: inferredFormType || null,
      location_id: locationId,
      payment_mode: "CMS / Bank",
      reference_no: clean(formData.get("remittance_code")),
      remarks: clean(formData.get("remarks")),
      remittance_amount: amount,
      remittance_code: required(formData.get("remittance_code"), "Remittance code"),
      station_code: station.station_code,
      status: "Submitted",
      submission_no: `COD-${Date.now().toString(36).toUpperCase()}`,
      submitter_name: clean(formData.get("submitter_name")),
      validation_status: "Pending",
      ai_status: depositAttachments.length ? "Queued" : "Awaiting proof",
      ai_summary: null
    }, companyId));
    if (error) throw new Error(error.message);

    revalidatePath("/ops-pulse/cod/submission");
    revalidatePath("/ops-pulse/cod/validation");
    revalidatePath("/ops-pulse/cod/reports");
    redirectWithFlash({ notice: "COD proof submitted for validation." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithFlash({ error: error instanceof Error ? error.message : "Unable to submit COD proof." });
  }
}
