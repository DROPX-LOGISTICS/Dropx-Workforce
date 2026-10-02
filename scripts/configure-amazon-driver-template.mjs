// Run with Node --experimental-strip-types --env-file=.env.local.
// This creates/refreshes only the isolated driver template; never sends a message.
import {createClient} from '@supabase/supabase-js';
import {amazonDriverWelcome} from '../src/lib/amazon-driver-welcome.ts';
import {listMetaTemplates,templateGraphRequest} from '../src/lib/whatsapp-template-meta.ts';
const company=process.env.DROPX_COMPANY_ID;
if(!company)throw new Error('Set DROPX_COMPANY_ID explicitly.');
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const config=await db.from('whatsapp_notification_configs').select('whatsapp_profile_id').eq('company_id',company).eq('event_code','field_executive_onboarding').single();
if(config.error)throw new Error('Onboarding sender is not configured.');
const profileId=config.data.whatsapp_profile_id;
const profile=await db.from('whatsapp_profiles').select('business_account_id,graph_api_version,is_active').eq('company_id',company).eq('id',profileId).single();
if(profile.error||!profile.data?.is_active)throw new Error('Sender unavailable.');
const secret=await db.rpc('get_whatsapp_profile_access_token',{profile_id:profileId});
if(secret.error||!secret.data)throw new Error('Sender token unavailable.');
const version=profile.data.graph_api_version||'v25.0';
let templates=await listMetaTemplates(version,profile.data.business_account_id,secret.data);
let template=templates.find(t=>t.name===amazonDriverWelcome.name&&t.language===amazonDriverWelcome.language);
if(!template){
 if(!process.argv.includes('--submit'))throw new Error('Template does not exist. Use --submit to create the dedicated template.');
 const result=await templateGraphRequest(version,profile.data.business_account_id,secret.data,{payload:amazonDriverWelcome});
 if(!result.id)throw new Error('No template ID returned. Refresh before retrying.');
 template={...amazonDriverWelcome,...result};
}
const saved=await db.from('whatsapp_template_cache').upsert({company_id:company,template_id:String(template.id),whatsapp_profile_id:profileId,name:template.name,language:template.language,category:template.category,status:template.status||'PENDING',components:template.components,synced_at:new Date().toISOString()},{onConflict:'company_id,template_id'});
if(saved.error)throw new Error('Meta template exists; cache could not be saved. Refresh without --submit.');
console.log(JSON.stringify({name:template.name,status:template.status,id:template.id,existingTemplatesUnchanged:true,messagesSent:0}));
