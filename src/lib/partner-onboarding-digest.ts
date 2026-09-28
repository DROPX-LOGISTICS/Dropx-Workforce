import {createHash,randomUUID} from "node:crypto";
import {supabaseAdmin as db} from "./supabase-admin";
import {sendEmail} from "./email";
import {loadPartnerOnboardingStates} from "./partner-onboarding";
export async function processPartnerOnboardingDigests(){
 if(!db)throw new Error("Database unavailable");
 const parts=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23"}).formatToParts(new Date()).map(p=>[p.type,p.value]));
 const date=`${parts.year}-${parts.month}-${parts.day}`;
 const configured=await db.from("workforce_partner_digest_settings").select("*").eq("is_active",true).lte("send_hour",Number(parts.hour));
 if(configured.error)throw new Error(configured.error.message);
 const result={sent:0,skipped:0,uncertain:0,errors:[] as string[]};
 for(const setting of configured.data??[]){
  let claimId:string|undefined;let attempted=false;
  try{
   const prior=await db.from("workforce_partner_digest_deliveries").select("id").eq("company_id",setting.company_id).eq("station_id",setting.station_id).eq("report_date",date).maybeSingle();
   if(prior.error)throw new Error(prior.error.message);if(prior.data){result.skipped++;continue;}
   const ids=[...new Set<string>([...setting.workforce_user_ids,...setting.ops_user_ids,...setting.recruit_user_ids])];
   const [station,users,smtp]=await Promise.all([
    db.from("stations").select("id,station_code,station_email,station_manager_email,cluster_manager_email").eq("company_id",setting.company_id).eq("id",setting.station_id).single(),
    db.from("profiles").select("id,email").eq("company_id",setting.company_id).eq("is_active",true).in("id",ids.length?ids:["00000000-0000-0000-0000-000000000000"]),
    db.from("email_notification_settings").select("is_enabled,smtp_from").eq("company_id",setting.company_id).eq("id",true).maybeSingle()
   ]);
   if(station.error||users.error||smtp.error)throw new Error(station.error?.message||users.error?.message||smtp.error?.message);
   if(!smtp.data?.is_enabled)throw new Error("Enable the company Email Config before sending onboarding digests.");
   const s=station.data;
   const recipients=[...new Set<string>([...(users.data??[]).map(p=>p.email),setting.include_station?s.station_email:null,setting.include_station_manager?s.station_manager_email:null,setting.include_cluster_manager?s.cluster_manager_email:null].filter(Boolean).map(e=>String(e).trim().toLowerCase()))].sort();
   if(!recipients.length||recipients.some(e=>! /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(e)))throw new Error("Configure valid station and team recipients.");
   const people:any[]=[];
   for(let offset=0;;offset+=500){const page=await db.from("workforce").select("id,full_name,email,dropx_id").eq("company_id",setting.company_id).eq("location_id",s.id).is("deleted_at",null).neq("migration_state","reclassified").order("id").range(offset,offset+499);if(page.error)throw new Error(page.error.message);people.push(...page.data);if(page.data.length<500)break;}
   const states=await loadPartnerOnboardingStates(db,setting.company_id,people.map(p=>p.id));
   const pending=people.flatMap(p=>{const f=states.get(p.id);return f&&!f.mapping_confirmed&&(f.due_kind||f.report_updated_at)?[{p,f}]:[]});
   const audience=createHash("sha256").update(JSON.stringify([setting.company_id,s.id,recipients])).digest("hex");
   const previous=await db.from("workforce_partner_digest_deliveries").select("message_id,root_message_id,subject").eq("company_id",setting.company_id).eq("station_id",s.id).eq("audience_key",audience).eq("status","sent").order("report_date",{ascending:false}).limit(1).maybeSingle();if(previous.error)throw new Error(previous.error.message);
   if(!pending.length&&!previous.data){result.skipped++;continue;}
   const clean=(v:unknown)=>String(v??"—").replace(/[\r\n\t]+/g," ");
   const invitation=pending.filter(x=>x.f.due_kind==='invitation_due');
   const others=pending.filter(x=>x.f.due_kind!=='invitation_due');
   const lines=(rows:typeof pending)=>rows.map(({p,f})=>`${clean(f.transporter_id)} | ${clean(p.full_name)} | ${clean(p.email)} | ${clean(s.station_code)} | ${clean(f.provider_name)} | ${clean(f.action_item||f.label)} | Reported: ${clean(f.reported_on)} | Invited: ${clean(f.invited_on)} | Due: ${clean(f.due_since)} | Report: ${clean(f.report_date)}`).join("\n");
   const body=`Station onboarding follow-up · ${s.station_code} · ${date}\n\n${invitation.length} invitation(s) overdue; ${others.length} ID setup / mapping follow-up(s).\nPlease action the pending items in the Workforce Register. Reporting and invitation thresholds are configured in Workflow rules.\n\nColumns: Transporter/provider ID | Name | Email | Station | Client | Action item | Reporting date | Invitation date | Due date | Source report date\n\nINVITATION OVERDUE\n${lines(invitation)||'None'}\n\nPARTNER ONBOARDING / MAPPING FOLLOW-UP\n${lines(others)||'None'}\n\nA missing transporter ID is shown as —. Older report dates need a refreshed import before assuming the status is current. Provider mappings require Workforce confirmation.\n`;
   const subject=previous.data?.subject||`[${s.station_code}] Associate onboarding — daily follow-up`;
   const domain=String(smtp.data.smtp_from||'').split('@').pop()?.replace(/[^a-zA-Z0-9.-]/g,'');if(!domain)throw new Error("Configure the sender email address.");
   const messageId=`<${randomUUID()}@${domain}>`,root=previous.data?.root_message_id||messageId;
   const claim=await db.from("workforce_partner_digest_deliveries").insert({company_id:setting.company_id,station_id:s.id,report_date:date,audience_key:audience,recipients,subject,body,message_id:messageId,root_message_id:root,in_reply_to:previous.data?.message_id||null,status:"sending"}).select("id").single();
   if(claim.error?.code==='23505'){result.skipped++;continue;}if(claim.error)throw new Error(claim.error.message);claimId=claim.data.id;
   // Explicit station master defines this thread's audience. No associate mobile or documents are included.
   attempted=true;
   const receipt=await sendEmail({companyId:setting.company_id,to:recipients,subject,body,messageId,inReplyTo:previous.data?.message_id,references:previous.data?[root,previous.data.message_id]:undefined});
   if(recipients.some(e=>!receipt.accepted?.map(a=>String(a).toLowerCase()).includes(e)))throw new Error("SMTP did not accept every recipient; inspect delivery before retrying.");
   const saved=await db.from("workforce_partner_digest_deliveries").update({status:"sent",completed_at:new Date().toISOString()}).eq("id",claimId).eq("status","sending");if(saved.error)throw new Error("SMTP accepted; receipt persistence needs review.");result.sent++;
  }catch(error){const message=error instanceof Error?error.message:"Digest failed";result.errors.push(`${setting.station_id}: ${message}`);if(claimId){await db.from("workforce_partner_digest_deliveries").update({status:attempted?"uncertain":"skipped",error_message:message,completed_at:new Date().toISOString()}).eq("id",claimId);if(attempted)result.uncertain++;}else result.skipped++;}
 }
 return result;
}
