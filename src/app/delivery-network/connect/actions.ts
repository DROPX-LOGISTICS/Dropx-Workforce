"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

const path = "/delivery-network/connect";

function text(value: FormDataEntryValue | null) { return String(value ?? "").trim(); }
function finish(kind: "notice" | "error", message: string): never { redirect(`${path}?${kind}=${encodeURIComponent(message)}`); }

export async function updateWorkforceConnectRequest(formData: FormData) {
  const authorization = await requirePagePermission("workforce_communications", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const id = text(formData.get("id"));
    const status = text(formData.get("status"));
    const responderNote = text(formData.get("responder_note"));
    if (!id || !["open", "in_review", "resolved", "closed"].includes(status)) throw new Error("Choose a valid request status.");
    if (responderNote.length > 2000) throw new Error("Response is limited to 2,000 characters.");
    if (["resolved", "closed"].includes(status) && responderNote.length < 3) throw new Error("Add a response before resolving or closing a request.");
    const current = await supabaseAdmin.from("workforce_connect_requests")
      .select("id,workforce_id")
      .eq("company_id", companyId)
      .eq("id", id)
      .neq("category", "speak_up")
      .maybeSingle();
    if (current.error || !current.data) throw new Error(current.error?.message ?? "Connect request was not found.");
    if (!authorization.hasAllLocationAccess) {
      const workforce = await supabaseAdmin.from("workforce").select("location_id").eq("company_id", companyId).eq("id", current.data.workforce_id).maybeSingle();
      if (workforce.error || !workforce.data || !authorization.locationScopeIds.includes(workforce.data.location_id)) throw new Error("This Connect request is outside your station access.");
    }
    const result = await supabaseAdmin.from("workforce_connect_requests").update({
      status,
      responder_note: responderNote || null,
      resolved_at: ["resolved", "closed"].includes(status) ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    }).eq("company_id", companyId).eq("id", id).neq("category", "speak_up").select("id").maybeSingle();
    if (result.error || !result.data) throw new Error(result.error?.message ?? "This request changed before it could be updated.");
    revalidatePath(path);
  } catch (error) {
    finish("error", error instanceof Error ? error.message : "Unable to update Connect request.");
  }
  finish("notice", "Connect request updated.");
}
