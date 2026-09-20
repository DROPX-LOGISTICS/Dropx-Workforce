"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadWorkforceJoining } from "@/lib/workforce-joining-data";
import { amazonTasks, amazonTaskStates, providerStages } from "@/lib/workforce-joining";
import { isWorkforceDate, workforceToday } from "@/lib/workforce-earnings";

export async function saveJoiningPlan(form: FormData) {
  const auth = await requirePagePermission("people_review","edit");
  const person = String(form.get("workforce_id") ?? "").trim();
  const query = new URLSearchParams({person});
  try {
    if (auth.readOnly) throw new Error("Preview mode is read-only.");
    if (!supabaseAdmin) throw new Error("Database is unavailable.");
    const data = await loadWorkforceJoining(auth,{to:workforceToday(),evidence:false});
    const profile = data.profiles.find(row=>row.id===person);
    if (!profile) throw new Error("Choose a Workforce profile in your station scope.");
    const field = (name: string) => String(form.get(name) ?? "").trim();
    const date = (name: string, required=false) => {
      const value = field(name);
      if (!value && !required) return null;
      if (!isWorkforceDate(value)) throw new Error(`Choose a valid ${name.replaceAll("_"," ")}.`);
      return value;
    };
    const mode = field("mode");
    if (!["training","direct"].includes(mode)) throw new Error("Choose training or direct joining.");
    const policy=mode==="training" ? data.policies.find(row=>row.id===field("training_policy_id") && row.station_id===profile.location_id) : null;
    if (mode==="training" && !policy) throw new Error("Select a training policy from this station’s master. Configure the master first if none exists.");
    const rate = mode === "direct" ? null : Number(policy?.daily_rate);
    if (mode === "training" && (!Number.isFinite(rate) || Number(rate)<=0 || Number(rate)>9999999999.99)) throw new Error("Enter the agreed positive training amount per day.");
    const minutes = mode==="direct" ? 1 : Number(policy?.minimum_minutes);
    if (!Number.isInteger(minutes) || minutes<1 || minutes>1440) throw new Error("Eligible duration must be 1–1440 minutes.");
    const terms = field("terms_reference");
    if (terms.length<3 || terms.length>1000 || field("confirmed_terms")!=="yes") throw new Error("Record and confirm the associate's agreed terms. Do not invent or retrospectively reduce pay.");
    const stage = field("provider_stage");
    if (!Object.hasOwn(providerStages,stage)) throw new Error("Choose a valid provider stage.");
    const email = field("contact_email");
    if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254)) throw new Error("Enter the associate-controlled email address.");
    const note = field("owner_note");
    if (note.length>2000 || field("assigned_to").length>160) throw new Error("Keep the owner and next-action note concise.");
    if (["blocked","withdrawn"].includes(stage) && !note) throw new Error("Explain the blocker or withdrawal, and who will follow up.");
    const version = Number(field("version"));
    if (!Number.isInteger(version) || version<0) throw new Error("Refresh the joining plan before saving.");
    const taskStatuses = Object.fromEntries(Object.keys(amazonTasks).map(key=>{
      const value=field(`amazon_${key}`) || "pending";
      if (!Object.hasOwn(amazonTaskStates,value)) throw new Error("Choose a valid Amazon task status.");
      return [key,value];
    }));
    const profileId = field("provider_profile_id");
    for (const name of ["invitation_first_name","invitation_last_name","invitation_suffix"]) {
      if (field(name).length>(name==="invitation_suffix" ? 20:120)) throw new Error("Keep invitation name fields within the displayed limits.");
    }
    if (profileId && !/^amzn1\.flex\.provider\.v1\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(profileId)) throw new Error("Paste the Amazon profile identifier from its profile URL, not a name or email.");
    const result = await supabaseAdmin.rpc("workforce_save_joining_plan",{
      p_company:requireCompanyId(auth),p_actor:auth.userId,p_actor_name:auth.fullName || auth.email || "Workforce reviewer",
      p_workforce:person,p_expected_version:version,p_locations:auth.hasAllLocationAccess ? null : auth.locationScopeIds,
      p_plan:{station_id:profile.location_id,mode,training_policy_id:policy?.id ?? null,eligible_from:date("eligible_from",true),daily_rate:rate,minimum_minutes:minutes,
        terms_reference:terms,terms_accepted_on:date("terms_accepted_on",true),training_completed_on:date("training_completed_on"),closed_on:date("closed_on"),
        provider_stage:stage,provider_reference:field("provider_reference") || null,provider_submitted_on:date("provider_submitted_on"),provider_activated_on:date("provider_activated_on"),
        next_follow_up_on:date("next_follow_up_on"),owner_note:note || null,contact_email:email || null,assigned_to:field("assigned_to") || null,
        amazon_tasks:taskStatuses,provider_profile_id:profileId || null,invitation_first_name:field("invitation_first_name") || null,invitation_last_name:field("invitation_last_name") || null,invitation_suffix:field("invitation_suffix") || null}
    });
    if (result.error) throw new Error(result.error.message);
    query.set("notice","Joining plan saved with reviewer and timestamp. Earnings will use the agreed terms and provider mapping effective date.");
    for (const path of ["joining","associates","earnings","lifecycle","payroll"]) revalidatePath(`/delivery-network/${path}`);
  } catch(error) { query.set("error",error instanceof Error ? error.message : "Unable to save joining plan."); }
  redirect(`/delivery-network/joining?${query}`);
}
