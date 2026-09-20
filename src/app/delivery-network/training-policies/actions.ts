"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isWorkforceDate } from "@/lib/workforce-earnings";

export async function saveTrainingPolicy(form:FormData) {
  const auth=await requirePagePermission("people_review","edit");
  const value=(name:string)=>String(form.get(name) ?? "").trim();
  const query=new URLSearchParams();
  try {
    if(auth.readOnly) throw new Error("Preview mode is read-only.");
    if(!supabaseAdmin) throw new Error("Database is unavailable.");
    const retire=value("retire_id") || null;
    const name=value("name"), rate=Number(value("daily_rate")),minutes=Number(value("minimum_minutes"));
    if(!retire) {
      if(name.length<3 || name.length>120) throw new Error("Enter a policy name of 3–120 characters.");
      if(!Number.isFinite(rate) || rate<=0 || rate>9999999999.99) throw new Error("Enter an approved positive daily amount.");
      if(!Number.isInteger(minutes) || minutes<1 || minutes>1440) throw new Error("Enter the agreed minimum minutes, between 1 and 1440.");
      if(value("policy_reference").length<3 || value("policy_reference").length>1000) throw new Error("Provide the approved policy reference.");
      if(!isWorkforceDate(value("effective_from")) || value("effective_to") && (!isWorkforceDate(value("effective_to")) || value("effective_to")<value("effective_from"))) throw new Error("Choose a valid policy date range.");
    }
    const result=await supabaseAdmin.rpc("workforce_save_training_policy",{p_company:requireCompanyId(auth),p_actor:auth.userId,p_policy:retire,p_locations:auth.hasAllLocationAccess ? null:auth.locationScopeIds,
      p_payload:retire ? {} : {station_id:value("station_id"),name,daily_rate:rate,minimum_minutes:minutes,policy_reference:value("policy_reference"),effective_from:value("effective_from"),effective_to:value("effective_to") || null}});
    if(result.error) throw new Error(result.error.message);
    query.set("notice",retire ? "Policy retired for new selection. Existing agreed joining terms are unchanged." : "Training policy created. Select it for an approved associate in Joining & Training.");
    revalidatePath("/delivery-network/training-policies");revalidatePath("/delivery-network/joining");
  } catch(error) {query.set("error",error instanceof Error ? error.message:"Unable to save policy.");}
  redirect(`/delivery-network/training-policies?${query}`);
}
