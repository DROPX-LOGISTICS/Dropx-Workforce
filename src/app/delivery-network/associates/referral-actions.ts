"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

const path="/delivery-network/associates?view=referrals";
const clean=(form:FormData,key:string)=>String(form.get(key)??"").trim();
const finish=(kind:"notice"|"error",message:string):never=>redirect(`${path}&${kind}=${encodeURIComponent(message)}`);

export async function saveReferralProgram(form:FormData){
  const auth=await requirePagePermission("delivery_associates","edit");
  const company=requireCompanyId(auth);
  try{
    if(auth.readOnly||!supabaseAdmin)throw new Error("Editing is unavailable.");
    const id=clean(form,"id"),name=clean(form,"name"),stationId=clean(form,"station_id"),source=clean(form,"qualification_source"),terms=clean(form,"terms"),from=clean(form,"effective_from"),to=clean(form,"effective_to");
    const amount=Number(clean(form,"reward_amount")),days=Number(clean(form,"qualifying_days"));
    if(name.length<2||name.length>120)throw new Error("Enter a program name.");
    if(!Number.isFinite(amount)||amount<=0)throw new Error("Reward amount must be greater than zero.");
    if(!Number.isInteger(days)||days<1||days>365)throw new Error("Qualifying days must be between 1 and 365.");
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||to&&!/^\d{4}-\d{2}-\d{2}$/.test(to)||to&&to<from)throw new Error("Choose valid effective dates.");
    if(terms.length<5||terms.length>2000)throw new Error("Enter clear referral terms.");
    const sourceResult=await supabaseAdmin.from("workforce_referral_qualification_sources").select("code").eq("company_id",company).eq("code",source).eq("is_active",true).maybeSingle();
    if(sourceResult.error||!sourceResult.data)throw new Error("Choose an active qualification source.");
    if(stationId){
      let station=supabaseAdmin.from("stations").select("id").eq("company_id",company).eq("id",stationId).eq("is_active",true);
      if(!auth.hasAllLocationAccess)station=station.in("id",auth.locationScopeIds.length?auth.locationScopeIds:["00000000-0000-0000-0000-000000000000"]);
      const result=await station.maybeSingle();
      if(result.error||!result.data)throw new Error("Location is outside your access scope.");
    }
    const payload={company_id:company,station_id:stationId||null,name,reward_amount:amount,qualification_source:source,qualifying_days:days,effective_from:from,effective_to:to||null,terms,is_active:form.has("is_active"),updated_at:new Date().toISOString()};
    const result=id
      ?await supabaseAdmin.from("workforce_referral_programs").update(payload).eq("company_id",company).eq("id",id)
      :await supabaseAdmin.from("workforce_referral_programs").insert({...payload,created_by:auth.userId});
    if(result.error)throw new Error(result.error.message);
    revalidatePath("/delivery-network/associates");
  }catch(error){finish("error",error instanceof Error?error.message:"Unable to save referral program.");}
  finish("notice","Referral program saved.");
}

export async function setReferralProgramStatus(form:FormData){
  const auth=await requirePagePermission("delivery_associates","edit");
  const company=requireCompanyId(auth);
  try{
    if(auth.readOnly||!supabaseAdmin)throw new Error("Editing is unavailable.");
    const id=clean(form,"id"),isActive=clean(form,"is_active")==="true";
    const current=await supabaseAdmin.from("workforce_referral_programs").select("id,station_id").eq("company_id",company).eq("id",id).maybeSingle();
    if(current.error||!current.data)throw new Error("Referral program was not found.");
    if(!auth.hasAllLocationAccess&&current.data.station_id&&!auth.locationScopeIds.includes(current.data.station_id))throw new Error("Program is outside your location scope.");
    const result=await supabaseAdmin.from("workforce_referral_programs").update({is_active:isActive,updated_at:new Date().toISOString()}).eq("company_id",company).eq("id",id);
    if(result.error)throw new Error(result.error.message);
    revalidatePath("/delivery-network/associates");
  }catch(error){finish("error",error instanceof Error?error.message:"Unable to update referral program.");}
  finish("notice","Referral program status updated.");
}

export async function reviewReferral(form:FormData){
  const auth=await requirePagePermission("delivery_associates","edit");
  const company=requireCompanyId(auth);
  let success="Referral status refreshed.";
  try{
    if(auth.readOnly||!supabaseAdmin)throw new Error("Editing is unavailable.");
    const id=clean(form,"id"),decision=clean(form,"decision"),remarks=clean(form,"remarks");
    if(!["refresh","approve","reject"].includes(decision))throw new Error("Choose a valid referral action.");
    const current=await supabaseAdmin.from("workforce_referrals").select("*").eq("company_id",company).eq("id",id).maybeSingle();
    if(current.error||!current.data)throw new Error("Referral was not found.");
    if(!auth.hasAllLocationAccess&&current.data.preferred_station_id&&!auth.locationScopeIds.includes(current.data.preferred_station_id))throw new Error("Referral is outside your location scope.");

    if(decision==="reject"){
      if(remarks.length<3)throw new Error("Enter a rejection reason.");
      const result=await supabaseAdmin.from("workforce_referrals").update({status:"rejected",decision_remarks:remarks,approved_by:auth.userId,approved_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("company_id",company).eq("id",id).in("status",["submitted","linked","qualified"]);
      if(result.error)throw new Error(result.error.message);
      success="Referral rejected.";
    }else{
      const refreshed=await supabaseAdmin.rpc("workforce_refresh_referral",{p_company:company,p_referral:id});
      if(refreshed.error)throw new Error(refreshed.error.message);
      const state=Array.isArray(refreshed.data)?refreshed.data[0]:refreshed.data;
      const referredId=state?.referred_workforce_id as string|undefined;
      const progress=Number(state?.qualification_progress??0);
      const qualified=state?.status==="qualified";
      if(decision==="approve"){
        if(!qualified||!referredId)throw new Error(`Referral has ${progress} of ${current.data.qualifying_days_snapshot} qualifying days.`);
        const reference=`REFERRAL:${id}`;
        const existing=await supabaseAdmin.from("workforce_adjustments").select("id,status").eq("company_id",company).eq("external_reference",reference).maybeSingle();
        if(existing.error)throw new Error(existing.error.message);
        if(existing.data?.status==="rejected"||existing.data?.status==="cancelled")throw new Error("The earlier reward adjustment was closed. Review it in Adjustments before trying again.");
        let adjustmentId=existing.data?.id as string|undefined;
        if(!adjustmentId){
          const adjustment=await supabaseAdmin.from("workforce_adjustments").insert({company_id:company,workforce_id:current.data.referrer_workforce_id,adjustment_type:"earning",category:"referral_bonus",amount:current.data.reward_amount_snapshot,effective_date:new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()),reason:`Referral reward for ${current.data.referred_full_name}`,external_reference:reference,status:"pending",requested_by:auth.userId}).select("id").single();
          if(adjustment.error)throw new Error(adjustment.error.message);
          adjustmentId=adjustment.data.id;
        }
        const result=await supabaseAdmin.from("workforce_referrals").update({adjustment_id:adjustmentId,referred_workforce_id:referredId,qualification_progress:progress,status:"approved",qualified_at:current.data.qualified_at||new Date().toISOString(),approved_at:new Date().toISOString(),approved_by:auth.userId,decision_remarks:remarks||null,updated_at:new Date().toISOString()}).eq("company_id",company).eq("id",id);
        if(result.error)throw new Error(result.error.message);
        revalidatePath("/delivery-network/adjustments");
        success="Referral reward sent for maker-checker approval.";
      }
    }
    revalidatePath("/delivery-network/associates");
  }catch(error){finish("error",error instanceof Error?error.message:"Unable to review referral.");}
  finish("notice",success);
}
