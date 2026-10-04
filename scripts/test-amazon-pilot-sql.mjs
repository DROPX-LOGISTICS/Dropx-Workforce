import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const schema=`create role anon;create role authenticated;create role service_role;
create table companies(id uuid primary key);create table profiles(id uuid primary key);
create table stations(id uuid primary key,company_id uuid,station_code text);
create table designation_categories(id uuid primary key,people_module text);
create table designations(id uuid primary key,company_id uuid,name text,is_active boolean,designation_category_id uuid);
create table workforce(id uuid primary key,company_id uuid,full_name text,mobile text,mobile_country_code text,email text,date_of_join date,location_id uuid,designation_id uuid,designation text,source_profile_type text,source_profile_id uuid,compatibility_mode boolean,migration_state text,is_active boolean,onboarding_status text,lifecycle_status text,approval_required boolean,created_by uuid,biometric_id text,dropx_id text,onboarding_application_source text,onboarding_token_hash text,onboarding_token_expires_at timestamptz,deleted_at timestamptz,onboarding_approved_at timestamptz);
create table workforce_amazon_station_settings(station_id uuid,company_id uuid,invitation_enabled boolean);
create table biometric_enrolments(company_id uuid,enrolment_id text,worker_type text,profile_type text,account_id uuid,location_id uuid,status text,effective_from date,effective_to date,created_by uuid);
create table workforce_amazon_invitation_requests(id uuid primary key default gen_random_uuid(),company_id uuid,workforce_id uuid,station_id uuid,source_portal text,amazon_email text,first_name text,last_name text,requested_by uuid,status text default 'queued',requested_at timestamptz default now(),external_reference text,error_message text,error_code text,completed_at timestamptz,updated_at timestamptz);
create table workforce_amazon_portal_links(company_id uuid,workforce_id uuid,amazon_provider_id text,transporter_id text);
create table workforce_associates(provider_id text,transporter_id text,operational_status text);
create table report_import_rows(company_id uuid,source_type text,normalized_data jsonb,raw_data jsonb,work_date date,created_at timestamptz);
create table api_response_cache(cache_key text,created_at timestamptz,payload jsonb);
create table cps_shipment_daily(company_id uuid,provider_employee_id text,station_code text,work_date date,total_delivery integer);
create table field_executive_provider_mappings(company_id uuid,workforce_id uuid,provider_member_id text,status text,effective_from date,effective_to date);
create table workforce_adjustments(workforce_id uuid,company_id uuid);
create function evaluate_onboarding_identity(p_company_id uuid,p_mobile text,p_designation_id uuid default null,p_designation_name text default null,p_exclude_source text default null,p_exclude_id uuid default null) returns jsonb language sql stable as $$
 with matches as (
  select jsonb_build_object('source_type','workforce','source_id',w.id,'display_name',w.full_name,'designation_id',w.designation_id,'designation_code',null,'designation_name',coalesce(d.name,w.designation),'profile_status',w.onboarding_status) item,
   w.designation_id=p_designation_id exact_designation
  from public.workforce w left join public.designations d on d.id=w.designation_id and d.company_id=w.company_id
  where w.company_id=p_company_id and w.deleted_at is null and right(regexp_replace(w.mobile,'[^0-9]','','g'),10)=right(regexp_replace(p_mobile,'[^0-9]','','g'),10)
   and (p_exclude_id is null or w.id<>p_exclude_id)
 )
 select jsonb_build_object('normalized_mobile',right(regexp_replace(p_mobile,'[^0-9]','','g'),10),'exact_matches',coalesce(jsonb_agg(item) filter(where exact_designation),'[]'::jsonb),'other_matches',coalesce(jsonb_agg(item) filter(where not exact_designation),'[]'::jsonb)) from matches
$$;
`;
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const c=id(1),actor=id(2),station=id(3),designation=id(4),category=id(5),worker=id(6),legacy=id(7),secondDesignation=id(8),confirmedWorker=id(9);
test('pilot migration enforces exact joins, immutable payroll boundary and idempotent invitations',async()=>{
 const db=new PGlite();try{
 await db.exec(schema);await db.exec(readFileSync(new URL('../supabase/migrations/20261002170849_amazon_onboarding_pilot.sql',import.meta.url),'utf8'));await db.exec(readFileSync(new URL('../supabase/migrations/20261004124500_confirm_amazon_mobile_overlap.sql',import.meta.url),'utf8'));
 await db.exec(`insert into companies values('${c}');insert into profiles values('${actor}');insert into stations values('${station}','${c}','TLPB');insert into designation_categories values('${category}','delivery_network');insert into designations values('${designation}','${c}','DA',true,'${category}'),('${secondDesignation}','${c}','DCD',true,'${category}');insert into workforce_amazon_station_settings values('${station}','${c}',true);`);
 const day=(await db.query("select (now() at time zone 'Asia/Kolkata')::date::text as today")).rows[0].today;
 const input={id:worker,full_name:'Synthetic Pilot',mobile:'9000000000',email:'synthetic@example.test',station_id:station,designation_id:designation,reported_on:day,biometric_id:'98765',dropx_id:'TEST-PILOT',trial_days:0};
 await db.query('select workforce_create_amazon_pilot($1,$2,$3,null)',[c,actor,JSON.stringify(input)]);
 for(let i=0;i<2;i++)await db.query('select workforce_queue_amazon_pilot($1,$2)',[c,worker]);
 assert.equal((await db.query('select count(*)::int n from workforce_amazon_invitation_requests')).rows[0].n,1);
 await assert.rejects(db.query('update workforce set is_active=true where id=$1',[worker]),/observation-only/);
 await assert.rejects(db.query('insert into field_executive_provider_mappings(workforce_id) values($1)',[worker]),/Pilot records cannot/);
 await assert.rejects(db.query('insert into workforce_adjustments(workforce_id) values($1)',[worker]),/Pilot records cannot/);
 await db.query('insert into workforce(id,is_active) values($1,false)',[legacy]);await db.query('update workforce set is_active=true where id=$1',[legacy]);
 await db.query('insert into field_executive_provider_mappings(workforce_id) values($1)',[legacy]);
 const p=(await db.query('select trial_days,trial_completed_at,invitation_timing from workforce_amazon_pilots')).rows[0];
 assert.equal(p.trial_days,0);assert.equal(p.trial_completed_at,null);assert.equal(p.invitation_timing,'on_arrival');
 assert.equal((await db.query('select count(*)::int n from workforce_amazon_pilot_trials')).rows[0].n,0);
 const e=async()=> (await db.query('select workforce_amazon_pilot_sources($1,$2) e',[c,worker])).rows[0].e;
 assert.equal((await e()).employeeId,null);
 await db.query('insert into workforce_amazon_portal_links values($1,$2,$3,$4)',[c,worker,'provider-exact','TAS-EXACT']);
 await db.query('insert into workforce_associates values($1,$2,$3)',['provider-exact','TAS-EXACT','ACTIVE']);
 const drivers=[{driverName:'Someone Else',tasId:'TAS-EXACT',employeeId:'200001'},{driverName:'Synthetic Pilot',tasId:'WRONG-TAS',employeeId:'999999'}];
 await db.query("insert into api_response_cache values($1,now(),$2)",[`exec:recon:TLPB:${day}`,JSON.stringify({drivers})]);
 assert.equal((await e()).employeeId,'200001');assert.equal((await e()).conflict,false);
 await db.query('insert into cps_shipment_daily values($1,$2,$3,$4,5)',[c,'200001','TLPB',day]);
 assert.equal((await e()).firstDelivery,day);
 drivers.push({tasId:'OTHER',employeeId:'200001'});await db.query('update api_response_cache set payload=$1',[JSON.stringify({drivers})]);assert.equal((await e()).conflict,true);
 // Cross-company and missing account IDs cannot acquire report or SCC evidence.
 assert.equal((await db.query('select workforce_amazon_pilot_sources($1,$2) e',[id(99),worker])).rows[0].e,null);
 await assert.rejects(db.query('select workforce_create_amazon_pilot($1,$2,$3,null)',[c,actor,JSON.stringify({...input,id:id(10),email:'same-role@example.test'})]),/duplicate registration for the same designation/);
 const secondary={...input,id:confirmedWorker,designation_id:secondDesignation,email:'secondary@example.test',dropx_id:'TEST-SECONDARY'};
 await assert.rejects(db.query('select workforce_create_amazon_pilot($1,$2,$3,null)',[c,actor,JSON.stringify(secondary)]),/Confirm this as a separate Workforce registration/);
 await db.query('select workforce_create_amazon_pilot($1,$2,$3,null)',[c,actor,JSON.stringify({...secondary,identity_exception_confirmed:true})]);
 const confirmation=(await db.query("select evidence from workforce_amazon_pilot_history where workforce_id=$1 and event='reported'",[confirmedWorker])).rows[0].evidence;
 assert.equal(confirmation.identity_exception_confirmed,true);
 assert.equal(confirmation.identity_exception_profiles.length,1);
 }finally{await db.close();}
});
