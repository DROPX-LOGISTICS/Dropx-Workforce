import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const migration=readFileSync(new URL('../supabase/migrations/20260928200000_configurable_partner_onboarding.sql',import.meta.url),'utf8');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
async function setup(){const db=new PGlite();await db.exec(`
set timezone='Asia/Kolkata';
create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);
create table companies(id uuid primary key);create table providers(id uuid primary key,company_id uuid,code text,name text,is_active boolean default true);
create table location_models(id uuid primary key,company_id uuid,code text,name text,is_active boolean default true);
create table designation_categories(id uuid primary key,people_module text);create table designations(id uuid primary key,company_id uuid,code text,name text,is_active boolean,designation_category_id uuid);
create table stations(id uuid primary key,company_id uuid,provider_id uuid,location_model_id uuid,station_code text);
create table workforce(id uuid primary key,company_id uuid,designation_id uuid,email text,location_id uuid,onboarding_status text,full_name text,deleted_at timestamptz,migration_state text default 'canonical',created_by uuid,date_of_join date,compatibility_mode boolean default false,lifecycle_status text);
create table attendance_daily(company_id uuid,workforce_id uuid,punch_date date,in_time timestamptz,punch_in_location_id uuid default '${id(7)}',in_source text default 'biometric',enrolment_id text default 'BIO-TEST');
create table attendance_punches(company_id uuid,enrolment_id text,punch_date date,is_flagged boolean);
create table workforce_amazon_station_settings(station_id uuid,company_id uuid,invitation_enabled boolean,associate_email_pattern text);
create table field_executive_provider_mappings(id uuid primary key,company_id uuid,workforce_id uuid,provider_member_id text,status text,effective_from date,effective_to date,provider_id uuid,station_id uuid);
create table workforce_amazon_invitation_requests(id uuid primary key default gen_random_uuid(),company_id uuid,workforce_id uuid,station_id uuid,source_portal text,amazon_email text,first_name text,last_name text,requested_by uuid,requested_at timestamptz default now(),status text default 'queued',claimed_at timestamptz,claimed_by text,completed_at timestamptz,error_code text,error_message text,updated_at timestamptz);
create table workforce_joining_plans(workforce_id uuid primary key,company_id uuid,station_id uuid,mode text,eligible_from date,daily_rate numeric,minimum_minutes integer,terms_reference text,terms_accepted_on date,provider_stage text,contact_email text,invitation_first_name text,invitation_last_name text,version integer,updated_by uuid,updated_at timestamptz);
create table workforce_joining_events(company_id uuid,workforce_id uuid,event_code text,actor_id uuid,actor_name text,details jsonb);
create table cps_shipment_daily(company_id uuid,provider_employee_id text,provider_employee_name text,station_code text,work_date date,total_delivery numeric);
create table report_import_rows(id uuid primary key default gen_random_uuid(),company_id uuid,source_type text,station_code text,normalized_data jsonb,raw_data jsonb default '{}',created_at timestamptz default now(),work_date date default current_date);
create table workforce_amazon_status_guidance(company_id uuid,stage_code text,instruction text,match_text text,priority integer,is_active boolean);
create function workforce_save_amazon_station(uuid,uuid,text,uuid,integer,jsonb,uuid[]) returns void language sql as $$select$$;
insert into companies values('${id(1)}');insert into auth.users values('${id(2)}'),('${id(20)}');
insert into providers values('${id(3)}','${id(1)}','AMAZON','Amazon',true),('${id(13)}','${id(1)}','FLIPKART','Flipkart',true);
insert into location_models values('${id(4)}','${id(1)}','EDSP','Amazon EDSP',true),('${id(14)}','${id(1)}','ODH','ODH',true);
insert into designation_categories values('${id(5)}','delivery_network');
insert into designations values('${id(6)}','${id(1)}','DA','Delivery Associate',true,'${id(5)}'),('${id(16)}','${id(1)}','HK','House Keeping',true,'${id(5)}');
insert into stations values('${id(7)}','${id(1)}','${id(3)}','${id(4)}','KOZA'),('${id(17)}','${id(1)}','${id(13)}','${id(14)}','OTHER');
insert into workforce values('${id(8)}','${id(1)}','${id(6)}','amal.koza@gmail.com','${id(7)}','under_review','Amal',null,'canonical','${id(2)}',current_date,false,null);
insert into workforce_amazon_station_settings values('${id(7)}','${id(1)}',true,null);
`);await db.exec(migration);await db.exec(readFileSync(new URL('../supabase/migrations/20260928213000_partner_report_due_evidence.sql',import.meta.url),'utf8'));await db.exec(readFileSync(new URL('../supabase/migrations/20260929010000_workforce_confirmed_mapping_lifecycle.sql',import.meta.url),'utf8'));return db;}
const state=async db=>(await db.query('select * from workforce_partner_onboarding_state($1,$2)',[id(1),[id(8)]])).rows[0];
const queue=async(db,email='amal.koza@gmail.com',actor=id(2),source='workforce',locations=[id(7)])=>db.query('select workforce_queue_amazon_invitation($1,$2,$3,$4,$5,$6,$7)',[id(1),actor,'Test',id(8),email,source,locations]);
test('station suffix allows arbitrary mailbox and domain, rejects wrong suffix',async()=>{const db=await setup();try{for(const [email,code] of [['amal.koza@gmail.com','KOZA'],['akshay.ktub@outlook.com','KTUB'],['nisar123.kgqa@yahoo.com','KGQA']])assert.equal((await db.query('select workforce_station_email_valid($1,$2) valid',[email,code])).rows[0].valid,true);for(const email of ['amal@gmail.com','amal.kozax@gmail.com','amal.koza.x@gmail.com','a b.koza@gmail.com','.koza@gmail.com'])assert.equal((await db.query('select workforce_station_email_valid($1,$2) valid',[email,'KOZA'])).rows[0].valid,false);}finally{await db.close();}});
test('eligibility is model/designation configuration; registration precedes invite; same request is idempotent',async()=>{const db=await setup();try{assert.equal((await state(db)).can_trigger,true);await db.query("update workforce set onboarding_status='pending' where id=$1",[id(8)]);await assert.rejects(queue(db),/Complete registration/);await db.query("update workforce set onboarding_status='under_review' where id=$1",[id(8)]);await assert.rejects(queue(db,'fake.koza@gmail.com'),/email saved/);await assert.rejects(queue(db,undefined,id(20),'recruit'),/only associates/);await assert.rejects(queue(db,undefined,id(2),'ops_pulse',[id(17)]),/station scope/);await queue(db);await queue(db);assert.equal((await db.query('select count(*)::int n from workforce_amazon_invitation_requests')).rows[0].n,1);assert.equal((await state(db)).stage,'triggered');await db.query('update workforce set designation_id=$1 where id=$2',[id(16),id(8)]);assert.equal(await state(db),undefined);await assert.rejects(queue(db),/not enabled/);}finally{await db.close();}});
test('completed Amazon status holds at mapping; inactive and future mappings cannot unlock',async()=>{const db=await setup();try{await db.query("insert into report_import_rows(company_id,source_type,station_code,normalized_data) values($1,'da_inapp_onboarding','KOZA',$2)",[id(1),{rabbit_id:'amal.koza@gmail.com',operational_status:'inactive',action_item:'Background check pending'}]);assert.equal((await state(db)).stage,'background_check');await db.query("update report_import_rows set normalized_data=normalized_data||'{\"action_item\":\"No further action required\",\"operational_status\":\"active\"}'");assert.equal((await state(db)).stage,'mapping_pending');assert.equal((await state(db)).mapping_confirmed,false);await assert.rejects(queue(db),/already ready/);await db.exec("update workforce set onboarding_status='approved'");await db.query("insert into field_executive_provider_mappings values($1,$2,$3,'P-123','active',current_date+1,null,$4,$5)",[id(30),id(1),id(8),id(3),id(7)]);assert.equal((await state(db)).mapping_confirmed,false);await db.query("update field_executive_provider_mappings set effective_from=current_date");assert.equal((await state(db)).stage,'active');await db.query("update field_executive_provider_mappings set status='cancelled'");assert.equal((await state(db)).stage,'mapping_pending');}finally{await db.close();}});
test('legacy unchanged emails survive registration while new or changed mailboxes validate',async()=>{const db=await setup();try{await assert.rejects(db.query("insert into workforce(id,company_id,designation_id,email,location_id,onboarding_status) values($1,$2,$3,'amal@gmail.com',$4,'pending')",[id(90),id(1),id(6),id(7)]),/Email must end/);await db.query('update workforce set email=$1 where id=$2',['amal123.koza@yahoo.com',id(8)]);await db.query("update workforce set onboarding_status='approved' where id=$1",[id(8)]);await assert.rejects(queue(db),/email saved/);}finally{await db.close();}});

test('reminders require an approved template, fresh evidence and configured limits; stop at mapping',async()=>{
 const db=await setup();try{
 await db.exec(`alter table workforce add column mobile text default '9000000000',add column mobile_country_code text default '91',add column dropx_id text default 'DX-TEST';
 create table whatsapp_profiles(id uuid primary key,company_id uuid,profile_name text,is_active boolean);
 create table whatsapp_settings(company_id uuid,is_enabled boolean);
 create table whatsapp_template_cache(template_id text,company_id uuid,whatsapp_profile_id uuid,name text,language text,status text);
 create table whatsapp_campaigns(id uuid primary key default gen_random_uuid(),company_id uuid,source_mode text,whatsapp_profile_id uuid,whatsapp_profile_name text,template_id text,template_name text,template_language text,variable_mappings jsonb,total_count int,sent_count int,failed_count int,pending_count int,status text,created_by uuid);
 create table whatsapp_campaign_recipients(id uuid primary key default gen_random_uuid(),campaign_id uuid,company_id uuid,row_no int,recipient_name text,recipient_mobile text,country_code text,source text,source_id text,recipient_payload jsonb,status text);
 insert into whatsapp_profiles values('${id(50)}','${id(1)}','Test sender',true);
 insert into whatsapp_settings values('${id(1)}',true);
 insert into whatsapp_template_cache values('template','${id(1)}','${id(50)}','pending_step','en','PENDING');
 `);
 await db.exec(readFileSync(new URL('../supabase/migrations/20260928203000_partner_onboarding_reminders.sql',import.meta.url),'utf8'));
 await db.query("insert into workforce_partner_reminder_rules(workflow_rule_id,company_id,stage_code,whatsapp_profile_id,template_id,repeat_hours,max_per_step,report_max_age_hours,send_hour_start,send_hour_end,is_active,updated_by) values((select id from workforce_partner_onboarding_rules limit 1),$1,'background_check',$2,'template',24,2,48,0,24,true,$3)",[id(1),id(50),id(2)]);
 await db.query("insert into report_import_rows(company_id,source_type,station_code,normalized_data) values($1,'da_inapp_onboarding','KOZA',$2)",[id(1),{rabbit_id:'amal.koza@gmail.com',action_item:'background check pending'}]);
 const tick=async()=>Number((await db.query('select workforce_queue_partner_reminders($1) n',[id(1)])).rows[0].n);
 assert.equal(await tick(),0);await db.exec("update whatsapp_template_cache set status='APPROVED'");
 assert.equal(await tick(),1);assert.equal(await tick(),0);
 await db.exec("update workforce_partner_reminder_events set created_at=now()-interval '25 hours'");assert.equal(await tick(),1);
 await db.exec("update workforce_partner_reminder_events set created_at=now()-interval '25 hours'");assert.equal(await tick(),0);
 await db.exec("update workforce_partner_reminder_rules set max_per_step=3;update report_import_rows set created_at=now()-interval '4 days'");assert.equal(await tick(),0);
 await db.exec("update report_import_rows set created_at=now()");await db.exec("update workforce set onboarding_status='approved'");await db.query("insert into field_executive_provider_mappings values($1,$2,$3,'P-123','active',current_date,null,$4,$5)",[id(60),id(1),id(8),id(3),id(7)]);assert.equal(await tick(),0);
 assert.equal((await db.query('select count(*)::int n from whatsapp_campaign_recipients')).rows[0].n,2);
 }finally{await db.close();}
});

test('due dates use recorded arrival or actual attendance, and thresholds remain configurable',async()=>{const db=await setup();try{assert.equal((await state(db)).due_kind,null);await db.query("insert into attendance_daily values($1,$2,current_date-2,now()-interval '2 days')",[id(1),id(8)]);assert.equal((await state(db)).due_kind,'invitation_due');await db.exec('update workforce_partner_onboarding_rules set invite_due_days=3');assert.equal((await state(db)).due_kind,null);await queue(db);await db.exec("update workforce_amazon_invitation_requests set status='sent',completed_at=now()-interval '3 days'");assert.equal((await state(db)).due_kind,'progress_due');await db.exec('update workforce_partner_onboarding_rules set progress_due_days=4');assert.equal((await state(db)).due_kind,null);}finally{await db.close();}});
test('another client can use a configured report and manual invitation without Amazon rules',async()=>{const db=await setup();try{await db.exec("update workforce_partner_onboarding_rules set adapter='manual',report_source_type='other_client',report_email_field='login',report_status_field='state',report_action_field='todo',report_id_field='member',completed_statuses=array['ready']");await db.query("insert into report_import_rows(company_id,source_type,station_code,normalized_data) values($1,'other_client','KOZA',$2)",[id(1),{login:'amal.koza@gmail.com',state:'ready',member:'XYZ-1'}]);const row=await state(db);assert.equal(row.stage,'mapping_pending');assert.equal(row.transporter_id,'XYZ-1');assert.equal(row.mapping_confirmed,false);await assert.rejects(queue(db),/not enabled/);}finally{await db.close();}});

test('configured instructions are understandable; raw partner action codes are not sent to associates',async()=>{const db=await setup();try{
 await db.query("update workforce_partner_onboarding_rules set status_guidance=$1",[JSON.stringify([{match:'D45_CHECK',stage:'documents',label:'Upload your driving licence',instruction:'Open the partner app, choose Documents, and upload a clear photo of your licence. Ask your TL if you need help.'}])]);
 await db.query("insert into report_import_rows(company_id,source_type,station_code,normalized_data) values($1,'da_inapp_onboarding','KOZA',$2)",[id(1),{rabbit_id:'amal.koza@gmail.com',action_item:'D45_CHECK'}]);
 const row=await state(db);assert.equal(row.label,'Upload your driving licence');assert.match(row.instruction,/clear photo/);assert.equal(row.instruction.includes('D45_CHECK'),false);assert.equal(row.action_item,'d45_check');
 await db.exec("update report_import_rows set normalized_data=normalized_data||'{\"action_item\":\"UNKNOWN_SYS_CODE\"}'");assert.equal((await state(db)).instruction.includes('UNKNOWN'),false);
 }finally{await db.close();}});
test('orphan provider queue includes old imports and remains company/station scoped',async()=>{const db=await setup();try{
 await db.query("insert into cps_shipment_daily values($1,'UNMAPPED','Test','KOZA',current_date-100,3)",[id(1)]);
 let rows=(await db.query('select * from workforce_unmapped_provider_ids($1,$2)',[id(1),[id(7)]])).rows;assert.equal(rows.length,1);assert.equal(rows[0].provider_member_id,'UNMAPPED');assert.equal(rows[0].deliveries,'3');
 assert.equal((await db.query('select * from workforce_unmapped_provider_ids($1,$2)',[id(1),[id(17)]])).rows.length,0);
 await db.exec("update workforce set onboarding_status='approved'");await db.query("insert into field_executive_provider_mappings values($1,$2,$3,'UNMAPPED','active',current_date,null,$4,$5)",[id(70),id(1),id(8),id(3),id(7)]);assert.equal((await db.query('select * from workforce_unmapped_provider_ids($1,null)',[id(1)])).rows.length,0);
 }finally{await db.close();}});
test('daily team digest has one atomic station/day delivery and restricts table access',async()=>{const db=await setup();try{
 await db.exec(readFileSync(new URL('../supabase/migrations/20260928210000_partner_onboarding_digest.sql',import.meta.url),'utf8'));
 const insert=()=>db.query("insert into workforce_partner_digest_deliveries(company_id,station_id,report_date,audience_key,recipients,subject,body,message_id,root_message_id,status) values($1,$2,current_date,'scope',array['team@example.test'],'Station follow-up','Only basic details','<one@example.test>','<one@example.test>','sending')",[id(1),id(7)]);
 await insert();await assert.rejects(insert(),/duplicate key/);const access=await db.query("select has_table_privilege('authenticated','workforce_partner_digest_deliveries','SELECT') allowed");assert.equal(access.rows[0].allowed,false);
 }finally{await db.close();}});

test('closed engagements do not remain in onboarding or reminder eligibility',async()=>{const db=await setup();try{await db.exec("update workforce set lifecycle_status='offboarded'");assert.equal(await state(db),undefined);}finally{await db.close();}});


test('imported progress without a historical invite log is not a false invitation overdue',async()=>{const db=await setup();try{
 await db.query("insert into attendance_daily values($1,$2,current_date-5,now()-interval '5 days')",[id(1),id(8)]);
 assert.equal((await state(db)).due_kind,'invitation_due');
 await db.query("insert into report_import_rows(company_id,source_type,station_code,normalized_data) values($1,'da_inapp_onboarding','KOZA',$2)",[id(1),{rabbit_id:'amal.koza@gmail.com',operational_status:'inactive',action_item:'Background check pending'}]);
 const row=await state(db);assert.equal(row.stage,'background_check');assert.equal(row.invited_on,null);assert.equal(row.due_kind,null);assert.equal(row.can_trigger,false);
 await db.query("insert into workforce_amazon_invitation_requests(company_id,workforce_id,station_id,status,completed_at) values($1,$2,$3,'sent',now()-interval '3 days')",[id(1),id(8),id(7)]);
 assert.equal((await state(db)).due_kind,'progress_due');
 }finally{await db.close();}});

test('a confirmed bounded payment period unlocks only inside its effective dates',async()=>{const db=await setup();try{
 await db.exec("update workforce set onboarding_status='approved'");await db.query("insert into field_executive_provider_mappings values($1,$2,$3,'P-BOUNDED','closed',current_date-1,current_date+1,$4,$5)",[id(70),id(1),id(8),id(3),id(7)]);
 assert.equal((await state(db)).mapping_confirmed,true);
 await db.exec("update field_executive_provider_mappings set effective_to=current_date-1");assert.equal((await state(db)).mapping_confirmed,false);
 await db.exec("update field_executive_provider_mappings set effective_from=current_date+1,effective_to=current_date+2");assert.equal((await state(db)).mapping_confirmed,false);
}finally{await db.close();}});

test('manual confirmation completes an approved current assignment without a training plan; future terms and incomplete registrations stay gated',async()=>{
 const db=await setup();try{
 await db.exec(`alter table workforce add column last_working_date date,add column is_active boolean default false,add column provider_id_status text,add column provider_employee_id text,add column updated_at timestamptz;
 create function workforce_save_mapping(uuid,uuid,uuid,uuid,text,jsonb,uuid[]) returns void language plpgsql as $$ begin
 if $7 is not null and not(($6->>'station_id')::uuid=any($7)) then raise exception 'outside scope';end if;
 end $$;`);
 const save=(from,to=null,locations=[id(7)])=>db.query('select workforce_save_joining_mapping($1,$2,$3,null,$4,$5,$6,$7)',[id(1),id(2),id(8),'DXTEST',{provider_id:id(3),provider_member_id:'CONFIRMED',station_id:id(7),payment_method_id:id(90),effective_from:from,effective_to:to,status:to?'closed':'active'},locations,'Reviewer']);
 const dates=(await db.query("select current_date::text today,(current_date+1)::text tomorrow,(current_date+10)::text later")).rows[0];
 await assert.rejects(save(dates.today),/Approve the registration/);
 await db.exec("update workforce set onboarding_status='approved',lifecycle_status='onboarding'");
 await assert.rejects(save(dates.today,null,[id(17)]),/outside scope/);
 assert.equal((await db.query('select is_active from workforce')).rows[0].is_active,false);
 await save(dates.tomorrow);assert.equal((await db.query('select is_active from workforce')).rows[0].is_active,false);
 await save(dates.today,dates.later);assert.equal((await db.query('select onboarding_status from workforce')).rows[0].onboarding_status,'active');
 assert.equal((await db.query('select count(*)::int n from workforce_joining_plans')).rows[0].n,0);
 assert.equal((await db.query("select count(*)::int n from workforce_joining_events where event_code='provider_mapping_saved'")).rows[0].n,2);
 await db.exec("update workforce set lifecycle_status='offboarded'");await assert.rejects(save(dates.today),/Approve the registration/);
 }finally{await db.close();}
});

test('existing confirmed identity with expired or future rates goes to mapping review, never another invitation',async()=>{const db=await setup();try{
 await db.exec("update workforce set onboarding_status='approved'");
 await db.query("insert into field_executive_provider_mappings values($1,$2,$3,'EXISTING-ID','closed',current_date-5,current_date-1,$4,$5)",[id(71),id(1),id(8),id(3),id(7)]);
 assert.equal((await state(db)).stage,'mapping_pending');assert.equal((await state(db)).can_trigger,false);assert.equal((await state(db)).mapping_confirmed,false);
 await assert.rejects(queue(db),/already ready/);
 await db.exec("update field_executive_provider_mappings set effective_from=current_date+1,effective_to=current_date+5");
 assert.equal((await state(db)).stage,'mapping_pending');assert.equal((await state(db)).mapping_confirmed,false);
}finally{await db.close();}});

test('reporting clock ignores future, manual, other-station and flagged punches',async()=>{const db=await setup();try{
 await db.query("insert into attendance_daily(company_id,workforce_id,punch_date,in_time,punch_in_location_id,in_source) values($1,$2,current_date-5,now(),$3,'biometric')",[id(1),id(8),id(17)]);
 assert.equal((await state(db)).reported_on,null);
 await db.query("update attendance_daily set punch_in_location_id=$1,in_source='manual'",[id(7)]);assert.equal((await state(db)).reported_on,null);
 await db.exec("update attendance_daily set in_source='biometric',punch_date=current_date+1");assert.equal((await state(db)).reported_on,null);
 await db.exec("update attendance_daily set punch_date=current_date-5");await db.query("insert into attendance_punches values($1,'BIO-TEST',current_date-5,true)",[id(1)]);assert.equal((await state(db)).reported_on,null);
 await db.exec("update attendance_punches set is_flagged=false");assert.equal((await state(db)).due_kind,'invitation_due');
}finally{await db.close();}});
