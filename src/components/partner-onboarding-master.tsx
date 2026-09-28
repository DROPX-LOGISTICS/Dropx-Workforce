import {PartnerStepGuidance} from "./partner-step-guidance";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { savePartnerOnboardingRule } from "@/app/delivery-network/amazon-onboarding-settings/actions";
import { SubmitButton } from "@/components/submit-button";

export async function PartnerOnboardingMaster({companyId,canEdit}:{companyId:string;canEdit:boolean}) {
 if(!supabaseAdmin)return null;
 const [rules,providers,models,designations]=await Promise.all([
  supabaseAdmin.from("workforce_partner_onboarding_rules").select("*").eq("company_id",companyId).order("updated_at",{ascending:false}),
  supabaseAdmin.from("providers").select("id,code,name").eq("company_id",companyId).eq("is_active",true).order("name"),
  supabaseAdmin.from("location_models").select("id,code,name").eq("company_id",companyId).eq("is_active",true).order("name"),
  supabaseAdmin.from("designations").select("id,code,name,designation_category:designation_categories!designations_designation_category_id_fkey!inner(people_module)").eq("company_id",companyId).eq("is_active",true).eq("designation_category.people_module","delivery_network").order("name")
 ]);
 const error=[rules,providers,models,designations].find(r=>r.error)?.error;
 if(error)return <p role="alert">Unable to load workflow rules: {error.message}</p>;
 const label=(items:any[],id:string)=>items.find(item=>item.id===id)?.name||id;
 const form=(rule:any)=><form action={savePartnerOnboardingRule} className="form-grid" key={rule?.id||"new"}>
  <input type="hidden" name="id" value={rule?.id||""}/><input type="hidden" name="version" value={rule?.updated_at||""}/>
  <fieldset disabled={!canEdit} style={{border:0,display:"contents"}}>
  <label>Partner<select name="provider_id" required defaultValue={rule?.provider_id||""}><option value="">Select partner</option>{(providers.data??[]).map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
  <label>Business model<select name="model_id" required defaultValue={rule?.model_id||""}><option value="">Select model</option>{(models.data??[]).map(row=><option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select></label>
  <label>Designation<select name="designation_id" required defaultValue={rule?.designation_id||""}><option value="">Select designation</option>{(designations.data??[]).map(row=><option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select></label>
  <label>ID creation process<select name="adapter" defaultValue={rule?.adapter||"manual"}><option value="amazon">Amazon invitation worker + DA In-App</option><option value="manual">Manual partner setup</option></select></label>
  <label>Invitation due after reporting (days)<input type="number" min="0" max="90" name="invite_due_days" required defaultValue={rule?.invite_due_days??2}/></label>
  <label>Progress due after invitation (days)<input type="number" min="0" max="90" name="progress_due_days" required defaultValue={rule?.progress_due_days??2}/></label>
  <details style={{gridColumn:"1/-1"}}><summary>Report connection & associate instructions</summary><p className="subtle">Use the normalized field names from Report Imports. Matching uses the saved email and station; this never confirms provider mapping.</p><div className="form-grid">
  <label>Report source code<input name="report_source_type" defaultValue={rule?.report_source_type||""} placeholder="da_inapp_onboarding"/></label>
  {[['report_email_field','Email field','rabbit_id'],['report_status_field','Status field','operational_status'],['report_action_field','Action field','action_item'],['report_id_field','Provider / transporter ID field','transporter_id']].map(([key,label,fallback])=><label key={key}>{label}<input name={key} required defaultValue={rule?.[key]||fallback}/></label>)}
  <label>Completed statuses (comma separated)<input name="completed_statuses" required defaultValue={(rule?.completed_statuses||['active','activated','completed','provisioned']).join(', ')}/></label>
  </div><PartnerStepGuidance initial={rule?.status_guidance||[]}/></details>
  <label className="checkbox-row"><input type="checkbox" name="require_station_email" defaultChecked={rule?.require_station_email??true}/>Require .stationcode before @</label>
  <label className="checkbox-row"><input type="checkbox" name="restrict_dropx_one" defaultChecked={rule?.restrict_dropx_one??true}/>Only ID status in DropX One until mapping is confirmed</label>
  <label className="checkbox-row"><input type="checkbox" name="is_active" defaultChecked={rule?.is_active??true}/>Enable this workflow</label>
  <div><SubmitButton pendingText="Saving">{rule?"Save rule":"Add workflow rule"}</SubmitButton></div>
  </fieldset>
 </form>;
 return <section className="panel"><div className="panel-head"><div><h2>Partner workflow rules</h2><p className="subtle">Client · model · designation</p></div></div><div className="panel-body"><details style={{padding:"10px 0"}}><summary style={{cursor:"pointer",fontWeight:600}}>Add workflow</summary>{form(null)}</details>{(rules.data??[]).map(rule=><details key={rule.id} style={{padding:"12px 0",borderBottom:"1px solid #e8edf3"}}><summary style={{cursor:"pointer"}}><strong>{label(providers.data??[],rule.provider_id)} · {label(models.data??[],rule.model_id)} · {label(designations.data??[],rule.designation_id)}</strong> — {rule.is_active?rule.adapter:"Paused"}</summary>{form(rule)}</details>)}</div></section>;
}
