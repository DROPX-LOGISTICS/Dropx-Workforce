"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function saveAmazonStation(form:FormData) {
  const auth = await requirePagePermission("executive_id_onboarding","edit");
  const value = (name:string)=>String(form.get(name) ?? "").trim();
  const station = value("station_id");
  const query = new URLSearchParams({station});
  try {
    if (auth.readOnly) throw new Error("Preview mode is read-only.");
    if (!supabaseAdmin) throw new Error("Database connection unavailable.");
    const code = value("service_area_code").toUpperCase();
    const supervisor = value("supervisor_alias");
    const contract = value("contract_type");
    if (!/^[A-Z0-9_-]{2,24}$/.test(code)) throw new Error("Enter the exact Amazon service-area code for this station.");
    if (!/^[a-zA-Z0-9._-]{2,80}$/.test(supervisor)) throw new Error("Enter the Amazon supervisor badge login without @amazon.com.");
    if (!["Independent Contractor","Subcontractor","DSP Employed"].includes(contract)) throw new Error("Choose the approved Amazon DA contract type.");
    const version = Number(value("version"));
    if (!Number.isInteger(version) || version<0) throw new Error("Refresh the station settings first.");
    const result = await supabaseAdmin.rpc("workforce_save_amazon_station",{p_company:requireCompanyId(auth),p_actor:auth.userId,p_actor_name:auth.fullName || auth.email || "Workforce reviewer",p_station:station,p_version:version,p_locations:auth.hasAllLocationAccess ? null : auth.locationScopeIds,
      p_settings:{service_area_code:code,service_type:"Amazon Logistics",supervisor_alias:supervisor,contract_type:contract}});
    if (result.error) throw new Error(result.error.message);
    query.set("notice","Station onboarding defaults saved. No Amazon profile was changed or invitation sent.");
    revalidatePath("/delivery-network/amazon-onboarding-settings");revalidatePath("/delivery-network/joining");
  } catch(error) { query.set("error",error instanceof Error ? error.message : "Unable to save station defaults."); }
  redirect(`/delivery-network/amazon-onboarding-settings?${query}`);
}
