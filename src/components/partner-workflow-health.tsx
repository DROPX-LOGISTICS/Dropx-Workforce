import {supabaseAdmin as db} from '@/lib/supabase-admin';
import {workforceAmazonWorkerConfig} from '@/lib/workforce-amazon-worker';
import {workforceToday} from '@/lib/workforce-earnings';
export async function PartnerWorkflowHealth({companyId}:{companyId:string}){
 if(!db)return null;
 const [flows,stationRules,reminders,digests,whatsapp,email,latestReport]=await Promise.all([
 db.from('workforce_partner_onboarding_rules').select('id',{count:'exact',head:true}).eq('company_id',companyId).eq('is_active',true),
 db.from('workforce_amazon_station_settings').select('station_id',{count:'exact',head:true}).eq('company_id',companyId).eq('invitation_enabled',true),
 db.from('workforce_partner_reminder_rules').select('id',{count:'exact',head:true}).eq('company_id',companyId).eq('is_active',true),
 db.from('workforce_partner_digest_settings').select('id',{count:'exact',head:true}).eq('company_id',companyId).eq('is_active',true),
 db.from('whatsapp_settings').select('is_enabled').eq('company_id',companyId).eq('id',true).maybeSingle(),
 db.from('email_notification_settings').select('is_enabled').eq('company_id',companyId).eq('id',true).maybeSingle(),
 db.from('report_import_rows').select('work_date,created_at').eq('company_id',companyId).eq('source_type','da_inapp_onboarding').lte('work_date',workforceToday()).order('work_date',{ascending:false,nullsFirst:false}).limit(1).maybeSingle()
 ]);
 const failure=[flows,stationRules,reminders,digests,whatsapp,email,latestReport].find(result=>result.error)?.error;
 if(failure)return <p role="alert">Automation readiness could not load: {failure.message}</p>;
 const worker=workforceAmazonWorkerConfig();
 const rows=[['Partner workflows',`${flows.count??0} enabled`],['Amazon invitation stations',`${stationRules.count??0} enabled`],['Worker connection',worker.baseUrl&&worker.adminKey?'Configured · check request history':'Connection not configured'],['WhatsApp reminders',whatsapp.data?.is_enabled?`${reminders.count??0} enabled rules`:'WhatsApp sending disabled'],['Daily team emails',email.data?.is_enabled?`${digests.count??0} enabled stations`:'Email sending disabled'],['Latest DA In-App report',latestReport.data?.work_date||'No report imported']];
 return <section className="panel"><div className="panel-head"><h2>Automation readiness</h2></div><div className="panel-body"><dl className="wf-journey-evidence">{rows.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{!reminders.count||!digests.count?<p role="status" className="subtle">{!reminders.count?'Associate follow-ups are not enabled. ':''}{!digests.count?'Daily team email threads are not enabled. ':''}Configure recipients, messages and timing below.</p>:null}<details><summary>What “enabled” means</summary><p className="subtle">Rules run only during their configured hours. WhatsApp requires an approved template and a fresh matching report. Email requires station recipients. A worker request stays pending until the worker confirms it was sent. Check delivery history below for actual outcomes.</p></details></div></section>;
}
