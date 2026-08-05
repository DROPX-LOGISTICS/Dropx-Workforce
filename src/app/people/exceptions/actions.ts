"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

function value(entry: FormDataEntryValue | null) {
  return String(entry ?? "").trim();
}

export async function clearPeopleException(formData: FormData) {
  const authorization = await requirePagePermission("people_exceptions", "edit");
  const companyId = requireCompanyId(authorization);
  if (!supabaseAdmin) redirect("/people/exceptions?error=Database+connection+is+not+configured");

  const profileType = value(formData.get("profile_type"));
  const profileId = value(formData.get("profile_id"));
  const ruleCode = value(formData.get("rule_code"));
  const sourceUpdatedAt = value(formData.get("source_updated_at"));
  const remarks = value(formData.get("remarks"));
  if (!profileType || !profileId || !ruleCode || !sourceUpdatedAt) redirect("/people/exceptions?error=Exception+details+are+missing");

  const { error } = await supabaseAdmin.from("people_exception_resolutions").upsert({
    company_id: companyId,
    profile_type: profileType,
    profile_id: profileId,
    rule_code: ruleCode,
    source_updated_at: sourceUpdatedAt,
    cleared_by: authorization.userId,
    cleared_at: new Date().toISOString(),
    remarks: remarks || null
  }, { onConflict: "company_id,profile_type,profile_id,rule_code" });
  if (error) redirect(`/people/exceptions?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/people/exceptions");
  redirect("/people/exceptions?notice=Exception+cleared");
}
