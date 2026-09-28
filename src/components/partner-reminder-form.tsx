"use client";
import {useState} from "react";
import {SubmitButton} from "@/components/submit-button";
import {extractWhatsAppTemplateVariables} from "@/lib/whatsapp-template";
import {savePartnerReminderRule} from "@/app/delivery-network/amazon-onboarding-settings/actions";
const fields=["full_name","dropx_id","location","email","pending_step","instruction"];
export function PartnerReminderForm({rule,templates,profiles,stations,workflows,canEdit}:{rule?:any;templates:any[];profiles:any[];stations:any[];workflows:any[];canEdit:boolean}){
 const [templateId,setTemplateId]=useState(rule?.template_id||"");
 const template=templates.find(t=>t.template_id===templateId);
 const variables=extractWhatsAppTemplateVariables(template?.components||[]);
 const stages=[...new Set(["background_check","video_verification","learning","documents","basic_details","account","licence","provisioning","partner_action_pending","mapping_pending","exception",...workflows.flatMap(w=>(w.status_guidance||[]).map((step:any)=>step.stage).filter(Boolean))])];
 return <form action={savePartnerReminderRule} className="form-grid"><input type="hidden" name="id" value={rule?.id||""}/><input type="hidden" name="version" value={rule?.updated_at||""}/><fieldset disabled={!canEdit} style={{display:"contents",border:0}}>
 <label>Partner workflows<select name="workflow_rule_id" multiple={!rule} size={rule?1:4} required defaultValue={rule?.workflow_rule_id||[]}>{rule?<option value="">Select client / model / designation</option>:null}{workflows.map((w:any)=><option key={w.id} value={w.id}>{w.providers?.name} · {w.location_models?.name} · {w.designations?.name}</option>)}</select></label>
 <label>Pending steps<select name="stage_code" multiple={!rule} size={rule?1:5} defaultValue={rule?.stage_code||[]} required>{stages.map(code=><option key={code} value={code}>{code.replaceAll("_"," ")}</option>)}</select></label>
 <label>Station<select name="station_id" defaultValue={rule?.station_id||""}><option value="">All stations</option>{stations.map(s=><option key={s.id} value={s.id}>{s.station_code}</option>)}</select></label>
 <label>Approved WhatsApp template<select required name="template_id" value={templateId} onChange={e=>setTemplateId(e.target.value)}><option value="">Select approved template</option>{templates.map(t=><option key={t.template_id} value={t.template_id}>{t.name} · {t.language} · {profiles.find(p=>p.id===t.whatsapp_profile_id)?.profile_name}</option>)}</select></label>
 <input name="whatsapp_profile_id" type="hidden" value={template?.whatsapp_profile_id||""}/>
 {template?<p className="subtle" style={{gridColumn:"1/-1"}}>{template.components?.filter((c:any)=>c.text).map((c:any)=>c.text).join("\n")}</p>:null}
 {variables.map(v=><label key={v.key}>{v.label}<select name={`mapping:${v.key}`} defaultValue={rule?.variable_mappings?.[v.key]?.value||""} required><option value="">Choose message detail</option>{fields.map(field=><option key={field}>{field}</option>)}</select></label>)}
 <label>Repeat after (hours)<input name="repeat_hours" type="number" min="1" max="720" required defaultValue={rule?.repeat_hours??24}/></label>
 <label>Maximum reminders per step<input name="max_per_step" type="number" min="1" max="100" required defaultValue={rule?.max_per_step??3}/></label>
 <label>Maximum source report age (hours)<input name="report_max_age_hours" type="number" min="1" max="720" required defaultValue={rule?.report_max_age_hours??48}/></label>
 <label>Send from hour (IST)<input name="send_hour_start" type="number" min="0" max="23" required defaultValue={rule?.send_hour_start??9}/></label>
 <label>Send until hour (IST)<input name="send_hour_end" type="number" min="1" max="24" required defaultValue={rule?.send_hour_end??18}/></label>
 <label className="checkbox-row"><input type="checkbox" name="is_active" defaultChecked={rule?.is_active??false}/>Enable automatic reminders</label>
 <SubmitButton pendingText="Saving">{rule?"Save reminder rule":"Apply to selected workflows & steps"}</SubmitButton></fieldset></form>;
}
