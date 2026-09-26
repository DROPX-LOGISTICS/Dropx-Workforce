"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { normalizeSourcePortal } from "@/lib/amazon-activation";
import { supabaseAdmin } from "@/lib/supabase-admin";

function destination(form: FormData, params: Record<string,string>) {
  const query = new URLSearchParams(params);
  const view = String(form.get("view") ?? "pending");
  if (["pending","active","all","errors"].includes(view)) query.set("view",view);
  const station = String(form.get("station") ?? "");
  if (station) query.set("station",station);
  return `/delivery-network/id-onboarding?${query}`;
}

export async function queueAmazonInvitation(form: FormData) {
  const auth = await requirePagePermission("executive_id_onboarding","edit");
  try {
    if (auth.readOnly || !supabaseAdmin) throw new Error("Invitation queue is unavailable.");
    const result = await supabaseAdmin.rpc("workforce_queue_amazon_invitation",{
      p_company:requireCompanyId(auth),p_actor:auth.userId,p_actor_name:auth.fullName||auth.email||"Workforce",
      p_workforce:String(form.get("workforce_id")??""),p_email:String(form.get("amazon_email")??"").trim().toLowerCase(),
      p_source_portal:normalizeSourcePortal(form.get("source_portal")),p_locations:auth.hasAllLocationAccess?null:auth.locationScopeIds
    });
    if (result.error) throw new Error(result.error.message);
    revalidatePath("/delivery-network/id-onboarding");revalidatePath("/delivery-network/associates");
    redirect(destination(form,{notice:"Amazon invitation queued for the worker."}));
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(destination(form,{error:error instanceof Error?error.message:"Unable to queue the Amazon invitation."}));
  }
}

export async function retryAmazonInvitation(form: FormData) {
  const auth = await requirePagePermission("executive_id_onboarding","edit");
  try {
    if (auth.readOnly || !supabaseAdmin) throw new Error("Invitation queue is unavailable.");
    const result=await supabaseAdmin.rpc("workforce_retry_amazon_invitation",{p_company:requireCompanyId(auth),p_actor:auth.userId,p_request:String(form.get("request_id")??""),p_locations:auth.hasAllLocationAccess?null:auth.locationScopeIds});
    if(result.error)throw new Error(result.error.message);
    revalidatePath("/delivery-network/id-onboarding");
    redirect(destination(form,{notice:"Invitation retry queued."}));
  }catch(error){
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(destination(form,{error:error instanceof Error?error.message:"Unable to retry the invitation."}));
  }
}
