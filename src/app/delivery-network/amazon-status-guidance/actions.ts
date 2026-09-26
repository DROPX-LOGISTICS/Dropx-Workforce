"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {requirePagePermission} from "@/lib/authorization";
import {requireCompanyId} from "@/lib/company-scope";
import {supabaseAdmin} from "@/lib/supabase-admin";
const stages=["invitation","account","basic_details","documents","licence","background_check","video_verification","learning","provisioning","activated","failed","other"];
export async function saveAmazonGuidance(form:FormData){
 const auth=await requirePagePermission("executive_id_onboarding","edit");const text=(key:string)=>String(form.get(key)??"").trim();
 try{if(auth.readOnly||!supabaseAdmin)throw new Error("Editing is unavailable.");const match=text("match_text").toLowerCase(),stage=text("stage_code"),instruction=text("instruction"),priority=Number(text("priority"));if(match.length<2||match.length>160)throw new Error("Enter a DA In-App status phrase to match.");if(!stages.includes(stage))throw new Error("Choose a valid lifecycle stage.");if(instruction.length<5||instruction.length>1000)throw new Error("Enter the associate instruction.");if(!Number.isInteger(priority)||priority<1||priority>1000)throw new Error("Priority must be 1 to 1000.");const id=text("id");const payload={company_id:requireCompanyId(auth),match_text:match,stage_code:stage,instruction,priority,is_active:form.get("is_active")==="on",updated_by:auth.userId,updated_at:new Date().toISOString()};const result=id?await supabaseAdmin.from("workforce_amazon_status_guidance").update(payload).eq("id",id).eq("company_id",payload.company_id):await supabaseAdmin.from("workforce_amazon_status_guidance").insert({...payload,created_by:auth.userId});if(result.error)throw new Error(result.error.message);revalidatePath("/delivery-network/amazon-status-guidance");revalidatePath("/delivery-network/id-onboarding");redirect("/delivery-network/amazon-status-guidance?notice=Guidance+saved");}catch(error){if(error&&typeof error==="object"&&"digest" in error)throw error;redirect(`/delivery-network/amazon-status-guidance?error=${encodeURIComponent(error instanceof Error?error.message:"Unable to save guidance.")}`);}
}
