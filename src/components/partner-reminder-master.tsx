import {supabaseAdmin} from "@/lib/supabase-admin";
import {PartnerReminderForm} from "./partner-reminder-form";
export async function PartnerReminderMaster({companyId,canEdit}:{companyId:string;canEdit:boolean}){
 if(!supabaseAdmin)return null;
 const [rules,templates,profiles,stations,events,workflows]=await Promise.all([
 supabaseAdmin.from("workforce_partner_reminder_rules").select("*").eq("company_id",companyId).order("updated_at",{ascending:false}),
 supabaseAdmin.from("whatsapp_template_cache").select("template_id,name,language,components,whatsapp_profile_id").eq("company_id",companyId).eq("status","APPROVED"),
 supabaseAdmin.from("whatsapp_profiles").select("id,profile_name").eq("company_id",companyId).eq("is_active",true),
 supabaseAdmin.from("stations").select("id,station_code").eq("company_id",companyId).eq("is_active",true).order("station_code"),
 supabaseAdmin.from("workforce_partner_reminder_events").select("id,stage_code,created_at,workforce(full_name,dropx_id),whatsapp_campaigns(status,sent_count,failed_count)").eq("company_id",companyId).order("created_at",{ascending:false}).limit(30),
 supabaseAdmin.from("workforce_partner_onboarding_rules").select("id,providers(name),location_models(name),designations(name)").eq("company_id",companyId).eq("is_active",true)
 ]);
 const error=[rules,templates,profiles,stations,events,workflows].find(r=>r.error)?.error;if(error)return <p role="alert">Reminder configuration unavailable: {error.message}</p>;
 const approved=(templates.data??[]).filter(t=>(profiles.data??[]).some(p=>p.id===t.whatsapp_profile_id));
 const props={companyId,canEdit,templates:approved,profiles:profiles.data??[],stations:stations.data??[],workflows:workflows.data??[]};
 return <section className="panel"><div className="panel-head"><div><h2>Pending-step WhatsApp reminders</h2><p className="subtle">Uses each workflow’s configured partner report, checks the step again before sending, and stops after confirmed mapping. Configure timing and an approved template before enabling.</p></div></div><div className="panel-body"><PartnerReminderForm {...props}/>{(rules.data??[]).map(rule=><details key={rule.id} style={{padding:"12px 0"}}><summary>{rule.stage_code.replaceAll("_"," ")} · {rule.is_active?"Enabled":"Paused"} · {rule.repeat_hours}h · maximum {rule.max_per_step}</summary><PartnerReminderForm {...props} rule={rule}/></details>)}<h3>Recent reminder history</h3>{!(events.data??[]).length?<p>No onboarding reminders queued yet.</p>:<table><thead><tr><th>Associate</th><th>Step</th><th>Queued</th><th>Delivery</th></tr></thead><tbody>{(events.data??[]).map((event:any)=><tr key={event.id}><td>{event.workforce?.full_name}<small>{event.workforce?.dropx_id}</small></td><td>{event.stage_code}</td><td>{new Date(event.created_at).toLocaleString("en-IN",{timeZone:"Asia/Kolkata"})}</td><td>{event.whatsapp_campaigns?.status} · {event.whatsapp_campaigns?.sent_count||0} sent · {event.whatsapp_campaigns?.failed_count||0} failed</td></tr>)}</tbody></table>}</div></section>;
}
