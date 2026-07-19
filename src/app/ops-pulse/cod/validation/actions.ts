"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { clean, codValidationStatuses, numberFromForm, required, type CodValidationStatus } from "@/lib/ops-pulse/cod";
import { supabaseAdmin } from "@/lib/supabase-admin";

function redirectWithFlash(params: { error?: string; notice?: string }) {
  cookies().set("dropx_cod_validation_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 25,
    path: "/ops-pulse/cod/validation",
    sameSite: "lax"
  });
  redirect("/ops-pulse/cod/validation");
}

function isNextRedirectError(error: unknown) {
  return typeof (error as { digest?: unknown })?.digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT");
}

export async function validateCodSubmission(formData: FormData) {
  const authorization = await requirePagePermission("cod_validation", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const id = required(formData.get("id"), "Submission");
    const validationStatus = required(formData.get("validation_status"), "Validation status") as CodValidationStatus;
    if (!codValidationStatuses.includes(validationStatus)) throw new Error("Select a valid validation status.");

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("cod_submissions")
      .select("id, location_id")
      .eq("company_id", companyId)
      .eq("id", id)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (!existing) throw new Error("Submission not found.");
    if (!authorization.hasAllLocationAccess && existing.location_id && !authorization.locationScopeIds.includes(existing.location_id)) {
      throw new Error("You do not have access to this station submission.");
    }

    const { error } = await supabaseAdmin
      .from("cod_submissions")
      .update({
        status: validationStatus === "Rejected" ? "Rejected" : "Validated",
        validated_amount: numberFromForm(formData.get("validated_amount"), "Validated amount"),
        validated_at: new Date().toISOString(),
        validated_by: authorization.userId,
        validation_remarks: clean(formData.get("validation_remarks")),
        validation_status: validationStatus
      })
      .eq("company_id", companyId)
      .eq("id", id);
    if (error) throw new Error(error.message);

    revalidatePath("/ops-pulse/cod/validation");
    revalidatePath("/ops-pulse/cod/reports");
    redirectWithFlash({ notice: "COD submission validated." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithFlash({ error: error instanceof Error ? error.message : "Unable to validate COD submission." });
  }
}
