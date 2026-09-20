"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

const path = "/delivery-network/speak-up";

function value(formData: FormData, name: string) { return String(formData.get(name) ?? "").trim(); }
function finish(kind: "notice" | "error", message: string): never { redirect(`${path}?${kind}=${encodeURIComponent(message)}`); }

export async function updateWorkforceSpeakUpReport(formData: FormData) {
  const authorization = await requirePagePermission("workforce_speak_up", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const id = value(formData, "id");
    const status = value(formData, "status");
    const responderNote = value(formData, "responder_note");
    if (!id || !["open", "in_review", "resolved", "closed"].includes(status)) throw new Error("Choose a valid review status.");
    if (responderNote.length > 2000) throw new Error("Response is limited to 2,000 characters.");
    if (["resolved", "closed"].includes(status) && responderNote.length < 3) throw new Error("Add a review note before resolving or closing this report.");

    const current = await supabaseAdmin.from("workforce_connect_requests")
      .select("id,workforce_id")
      .eq("company_id", companyId)
      .eq("id", id)
      .eq("category", "speak_up")
      .maybeSingle();
    if (current.error || !current.data) throw new Error(current.error?.message ?? "Speak Up report was not found.");

    const result = await supabaseAdmin.from("workforce_connect_requests").update({
      status,
      responder_note: responderNote || null,
      resolved_at: ["resolved", "closed"].includes(status) ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    }).eq("company_id", companyId).eq("id", id).eq("category", "speak_up").select("id").maybeSingle();
    if (result.error || !result.data) throw new Error(result.error?.message ?? "This report changed before it could be updated.");
    revalidatePath(path);
  } catch (error) {
    finish("error", error instanceof Error ? error.message : "Unable to update Speak Up report.");
  }
  finish("notice", "Confidential report updated.");
}
