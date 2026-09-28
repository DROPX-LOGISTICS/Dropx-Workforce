"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {extractWhatsAppTemplateVariables,getWhatsAppTemplateHeaderMediaType} from "@/lib/whatsapp-template";
import { validAmazonEmailPattern } from "@/lib/amazon-activation";

function dest(params: Record<string, string>) {
  const query = new URLSearchParams(params);
  return `/delivery-network/amazon-onboarding-settings?${query}`;
}

function revalidateAmazonMasters() {
  revalidatePath("/delivery-network/amazon-onboarding-settings");
  revalidatePath("/delivery-network/id-onboarding");
  revalidatePath("/delivery-network/amazon-lifecycle");
}

export async function saveAmazonStation(form: FormData) {
  const auth = await requirePagePermission("executive_id_onboarding", "edit");
  const value = (name: string) => String(form.get(name) ?? "").trim();
  const station = value("station_id");
  const tab = value("tab") || "stations";
  try {
    if (auth.readOnly) throw new Error("Preview mode is read-only.");
    if (!supabaseAdmin) throw new Error("Database connection unavailable.");
    const code = value("service_area_code").toUpperCase();
    const supervisor = value("supervisor_alias") || "anbaba";
    const contract = value("contract_type");
    const emailPattern = value("associate_email_pattern").toLowerCase();
    const amazonServiceAreaId = value("amazon_service_area_id") || null;
    if (!/^[A-Z0-9_-]{2,24}$/.test(code)) throw new Error("Enter the exact Amazon service-area code for this station.");
    if (!/^[a-zA-Z0-9._-]{2,80}$/.test(supervisor)) throw new Error("Enter the Amazon supervisor badge login without @amazon.com.");
    if (!["Independent Contractor", "Subcontractor", "DSP Employed"].includes(contract)) {
      throw new Error("Choose the approved Amazon DA contract type.");
    }
    if (emailPattern && !validAmazonEmailPattern(emailPattern)) {
      throw new Error("Email pattern must include {station_code} and {first_name} or {full_name}, followed by a valid domain.");
    }
    const version = Number(value("version"));
    if (!Number.isInteger(version) || version < 0) throw new Error("Refresh the station settings first.");
    const result = await supabaseAdmin.rpc("workforce_save_amazon_station", {
      p_company: requireCompanyId(auth),
      p_actor: auth.userId,
      p_actor_name: auth.fullName || auth.email || "Workforce reviewer",
      p_station: station,
      p_version: version,
      p_locations: auth.hasAllLocationAccess ? null : auth.locationScopeIds,
      p_settings: {
        service_area_code: code,
        amazon_service_area_id: amazonServiceAreaId,
        service_type: "Amazon Logistics",
        supervisor_alias: supervisor,
        contract_type: contract,
        associate_email_pattern: emailPattern || null,
        invitation_enabled: form.get("invitation_enabled") === "on",
      },
    });
    if (result.error) throw new Error(result.error.message);
    revalidateAmazonMasters();
    redirect(dest({ tab, station, notice: "Station onboarding defaults saved." }));
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(dest({ tab, station, error: error instanceof Error ? error.message : "Unable to save station defaults." }));
  }
}

export async function saveCatalogStation(form: FormData) {
  const auth = await requirePagePermission("executive_id_onboarding", "edit");
  const value = (name: string) => String(form.get(name) ?? "").trim();
  const company = requireCompanyId(auth);
  const id = value("catalog_id");
  try {
    if (auth.readOnly || !supabaseAdmin) throw new Error("Catalog edit is unavailable.");
    const stationCode = value("station_code").toUpperCase();
    const displayName = value("display_name") || null;
    const notes = value("notes") || null;
    const sortOrder = Number(value("sort_order") || "100");
    if (!/^[A-Z0-9_-]{2,24}$/.test(stationCode)) throw new Error("Station code must be 2–24 letters/numbers.");
    if (!Number.isFinite(sortOrder)) throw new Error("Sort order must be a number.");

    const { data: opsStation } = await supabaseAdmin
      .from("stations")
      .select("id,station_name")
      .eq("company_id", company)
      .ilike("station_code", stationCode)
      .maybeSingle();

    const payload = {
      company_id: company,
      station_code: stationCode,
      display_name: displayName || opsStation?.station_name || stationCode,
      notes,
      sort_order: Math.trunc(sortOrder),
      station_id: opsStation?.id ?? null,
      is_active: form.get("is_active") === "on" || form.get("is_active") === "true" || !id ? true : form.get("is_active") === "on",
      updated_at: new Date().toISOString(),
    };

    if (id) {
      const { error } = await supabaseAdmin
        .from("workforce_amazon_station_catalog")
        .update({
          ...payload,
          is_active: form.get("is_active") === "on",
        })
        .eq("company_id", company)
        .eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("workforce_amazon_station_catalog").insert(payload);
      if (error) throw new Error(error.message);
    }
    revalidateAmazonMasters();
    redirect(dest({ tab: "catalog", notice: id ? "Station catalog updated." : "Station added to catalog." }));
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(dest({ tab: "catalog", error: error instanceof Error ? error.message : "Unable to save catalog station." }));
  }
}

export async function deleteCatalogStation(form: FormData) {
  const auth = await requirePagePermission("executive_id_onboarding", "edit");
  const company = requireCompanyId(auth);
  const id = String(form.get("catalog_id") ?? "").trim();
  try {
    if (auth.readOnly || !supabaseAdmin) throw new Error("Delete is unavailable.");
    if (!id) throw new Error("Choose a catalog row to delete.");
    const { error } = await supabaseAdmin
      .from("workforce_amazon_station_catalog")
      .delete()
      .eq("company_id", company)
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidateAmazonMasters();
    redirect(dest({ tab: "catalog", notice: "Station removed from catalog." }));
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(dest({ tab: "catalog", error: error instanceof Error ? error.message : "Unable to delete catalog station." }));
  }
}

export async function saveSupervisor(form: FormData) {
  const auth = await requirePagePermission("executive_id_onboarding", "edit");
  const value = (name: string) => String(form.get(name) ?? "").trim();
  const company = requireCompanyId(auth);
  const id = value("supervisor_id");
  try {
    if (auth.readOnly || !supabaseAdmin) throw new Error("Supervisor edit is unavailable.");
    const alias = value("supervisor_alias");
    const displayName = value("display_name") || null;
    if (!/^[a-zA-Z0-9._-]{2,80}$/.test(alias)) {
      throw new Error("Supervisor alias must be 2–80 chars without @amazon.com.");
    }
    const stationCodes = form
      .getAll("station_codes")
      .map((v) => String(v).trim().toUpperCase())
      .filter((code) => /^[A-Z0-9_-]{2,24}$/.test(code));

    let supervisorId = id;
    if (id) {
      const { error } = await supabaseAdmin
        .from("workforce_amazon_supervisors")
        .update({
          supervisor_alias: alias,
          display_name: displayName,
          is_active: form.get("is_active") === "on",
          updated_at: new Date().toISOString(),
        })
        .eq("company_id", company)
        .eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      const { data, error } = await supabaseAdmin
        .from("workforce_amazon_supervisors")
        .insert({
          company_id: company,
          supervisor_alias: alias,
          display_name: displayName,
          is_active: true,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      supervisorId = data.id as string;
    }

    await supabaseAdmin
      .from("workforce_amazon_supervisor_stations")
      .delete()
      .eq("company_id", company)
      .eq("supervisor_id", supervisorId);

    if (stationCodes.length) {
      const { error } = await supabaseAdmin.from("workforce_amazon_supervisor_stations").insert(
        stationCodes.map((station_code) => ({
          company_id: company,
          supervisor_id: supervisorId,
          station_code,
        })),
      );
      if (error) throw new Error(error.message);
    }

    await supabaseAdmin.from("workforce_amazon_supervisor_defaults").upsert(
      { company_id: company, supervisor_alias: alias, updated_at: new Date().toISOString() },
      { onConflict: "company_id" },
    );

    revalidateAmazonMasters();
    redirect(dest({ tab: "supervisors", supervisor: supervisorId, notice: "Supervisor and station coverage saved." }));
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(dest({ tab: "supervisors", error: error instanceof Error ? error.message : "Unable to save supervisor." }));
  }
}

export async function deleteSupervisor(form: FormData) {
  const auth = await requirePagePermission("executive_id_onboarding", "edit");
  const company = requireCompanyId(auth);
  const id = String(form.get("supervisor_id") ?? "").trim();
  try {
    if (auth.readOnly || !supabaseAdmin) throw new Error("Delete is unavailable.");
    if (!id) throw new Error("Choose a supervisor to delete.");
    const { error } = await supabaseAdmin
      .from("workforce_amazon_supervisors")
      .delete()
      .eq("company_id", company)
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidateAmazonMasters();
    redirect(dest({ tab: "supervisors", notice: "Supervisor deleted." }));
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(dest({ tab: "supervisors", error: error instanceof Error ? error.message : "Unable to delete supervisor." }));
  }
}

export async function savePartnerOnboardingRule(form:FormData){
 const auth=await requirePagePermission("executive_id_onboarding","edit");
 try{
  if(!supabaseAdmin||auth.readOnly||!auth.hasAllLocationAccess)throw new Error("Company-wide workflow master access is required.");
  const text=(key:string)=>String(form.get(key)??"").trim();
  const guidance=JSON.parse(text("status_guidance")||"[]");
  if(!Array.isArray(guidance)||guidance.length>50||guidance.some((s:any)=>!s.match?.trim()||!s.label?.trim()||!s.instruction?.trim()||!['background_check','video_verification','documents','learning','basic_details','account','licence','provisioning','partner_action_pending','exception'].includes(s.stage)))throw new Error("Complete every step instruction with a matching phrase, readable title and next action.");
  for(const key of ['report_source_type','report_email_field','report_status_field','report_action_field','report_id_field'])if(text(key)&&!/^[a-zA-Z0-9_]{1,80}$/.test(text(key)))throw new Error("Report field names must contain only letters, numbers and underscores.");
  const result=await supabaseAdmin.rpc("workforce_save_partner_onboarding_rule",{p_company:requireCompanyId(auth),p_actor:auth.userId,p_id:text("id")||null,p_version:text("version")||null,p_rule:{status_guidance:guidance,invite_due_days:Number(text("invite_due_days")),progress_due_days:Number(text("progress_due_days")),report_source_type:text("report_source_type")||null,report_email_field:text("report_email_field"),report_status_field:text("report_status_field"),report_action_field:text("report_action_field"),report_id_field:text("report_id_field"),completed_statuses:text("completed_statuses").toLowerCase().split(",").map(s=>s.trim()).filter(Boolean),provider_id:text("provider_id"),model_id:text("model_id"),designation_id:text("designation_id"),adapter:text("adapter"),require_station_email:form.has("require_station_email"),restrict_dropx_one:form.has("restrict_dropx_one"),is_active:form.has("is_active")}});
  if(result.error)throw new Error(result.error.message);
  revalidateAmazonMasters();redirect(dest({tab:"workflow",notice:"Partner workflow rule saved."}));
 }catch(error){if(error&&typeof error==="object"&&"digest"in error)throw error;redirect(dest({tab:"workflow",error:error instanceof Error?error.message:"Unable to save workflow rule."}));}
}

export async function savePartnerReminderRule(form:FormData){
 const auth=await requirePagePermission("executive_id_onboarding","edit");
 try{
  if(!supabaseAdmin||auth.readOnly||!auth.hasAllLocationAccess)throw new Error("Company-wide workflow master access is required.");
  const company=requireCompanyId(auth),text=(key:string)=>String(form.get(key)??"").trim();
  const template=await supabaseAdmin.from("whatsapp_template_cache").select("components,whatsapp_profile_id,status").eq("company_id",company).eq("template_id",text("template_id")).single();
  if(template.error||template.data.status!=="APPROVED")throw new Error("Choose an approved WhatsApp template.");
  if(getWhatsAppTemplateHeaderMediaType(template.data.components??[]))throw new Error("Choose a text template for automatic onboarding reminders.");
  const mappings:Record<string,{mode:string;value:string}>={};
  for(const variable of extractWhatsAppTemplateVariables(template.data.components??[])){const field=text(`mapping:${variable.key}`);if(!["full_name","dropx_id","location","email","pending_step","instruction"].includes(field))throw new Error("Map every template variable to a message detail.");mappings[variable.key]={mode:"field",value:field};}
  const stage=text("stage_code");if(!["background_check","video_verification","learning","documents","basic_details","account","licence","provisioning","partner_action_pending","mapping_pending","exception","failed"].includes(stage))throw new Error("Choose a pending step.");
  const station=text("station_id");if(station){const match=await supabaseAdmin.from("stations").select("id").eq("company_id",company).eq("id",station).single();if(match.error)throw new Error("Choose a station in this company.");}
  const workflow=await supabaseAdmin.from("workforce_partner_onboarding_rules").select("id").eq("company_id",company).eq("id",text("workflow_rule_id")).single();if(workflow.error)throw new Error("Choose a workflow in this company.");
  const values={workflow_rule_id:workflow.data.id,company_id:company,stage_code:stage,station_id:station||null,template_id:text("template_id"),whatsapp_profile_id:template.data.whatsapp_profile_id,variable_mappings:mappings,repeat_hours:Number(text("repeat_hours")),max_per_step:Number(text("max_per_step")),report_max_age_hours:Number(text("report_max_age_hours")),send_hour_start:Number(text("send_hour_start")),send_hour_end:Number(text("send_hour_end")),is_active:form.has("is_active"),updated_by:auth.userId,updated_at:new Date().toISOString()};
  const result=text("id")?await supabaseAdmin.from("workforce_partner_reminder_rules").update(values).eq("company_id",company).eq("id",text("id")).eq("updated_at",text("version")).select("id").single():await supabaseAdmin.from("workforce_partner_reminder_rules").insert(values).select("id").single();
  if(result.error)throw new Error(result.error.message);
  revalidateAmazonMasters();redirect(dest({tab:"reminders",notice:"Reminder rule saved. Enabled rules run during their configured hours."}));
 }catch(error){if(error&&typeof error==="object"&&"digest"in error)throw error;redirect(dest({tab:"reminders",error:error instanceof Error?error.message:"Unable to save reminder rule."}));}
}

export async function savePartnerDigestSetting(form:FormData){
 const auth=await requirePagePermission("executive_id_onboarding","edit");
 try{
  if(!supabaseAdmin||auth.readOnly||!auth.hasAllLocationAccess)throw new Error("Company-wide workflow master access is required.");
  const company=requireCompanyId(auth),text=(key:string)=>String(form.get(key)??"").trim();
  const groups=Object.fromEntries(['workforce_user_ids','ops_user_ids','recruit_user_ids'].map(k=>[k,[...new Set(form.getAll(k).map(String))]]));
  const ids=[...new Set(Object.values(groups).flat())];
  const [station,users]=await Promise.all([supabaseAdmin.from("stations").select("id,station_email,station_manager_email,cluster_manager_email").eq("company_id",company).eq("id",text("station_id")).single(),supabaseAdmin.from("profiles").select("id,email").eq("company_id",company).eq("is_active",true).in("id",ids.length?ids:['00000000-0000-0000-0000-000000000000'])]);
  if(station.error||users.error||users.data?.length!==ids.length)throw new Error("Choose a station and active team members in this company.");
  const recipients=[...(users.data??[]).map(u=>u.email),form.has('include_station')?station.data.station_email:null,form.has('include_station_manager')?station.data.station_manager_email:null,form.has('include_cluster_manager')?station.data.cluster_manager_email:null].filter(Boolean);
  if(form.has('is_active')&&(!recipients.length||recipients.some(e=>!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(String(e)))))throw new Error("Configure valid recipient emails before enabling the daily follow-up.");
  const values={company_id:company,station_id:station.data.id,...groups,include_station:form.has('include_station'),include_station_manager:form.has('include_station_manager'),include_cluster_manager:form.has('include_cluster_manager'),send_hour:Number(text('send_hour')),is_active:form.has('is_active'),updated_by:auth.userId,updated_at:new Date().toISOString()};
  const result=text('id')?await supabaseAdmin.from('workforce_partner_digest_settings').update(values).eq('company_id',company).eq('id',text('id')).eq('updated_at',text('version')).select('id').single():await supabaseAdmin.from('workforce_partner_digest_settings').insert(values).select('id').single();if(result.error)throw new Error(result.error.message);
  revalidateAmazonMasters();redirect(dest({tab:'reminders',notice:'Station email follow-up saved.'}));
 }catch(error){if(error&&typeof error==='object'&&'digest'in error)throw error;redirect(dest({tab:'reminders',error:error instanceof Error?error.message:'Unable to save email follow-up.'}));}
}
