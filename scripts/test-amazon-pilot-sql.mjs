import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const schema=`create role anon;create role authenticated;create role service_role;
create table companies(id uuid primary key);create table profiles(id uuid primary key);
create table stations(id uuid primary key,company_id uuid,station_code text,is_active boolean default true);
create table designation_categories(id uuid primary key,people_module text);
create table designations(id uuid primary key,company_id uuid,name text,is_active boolean,designation_category_id uuid);
create table workforce(id uuid primary key,company_id uuid,full_name text,mobile text,mobile_country_code text,email text,date_of_join date,location_id uuid,designation_id uuid,designation text,source_profile_type text,source_profile_id uuid,compatibility_mode boolean,migration_state text,is_active boolean,onboarding_status text,lifecycle_status text,approval_required boolean,created_by uuid,biometric_id text,dropx_id text,onboarding_application_source text,onboarding_token_hash text,onboarding_token_expires_at timestamptz,deleted_at timestamptz,onboarding_approved_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
create table workforce_amazon_station_settings(station_id uuid,company_id uuid,invitation_enabled boolean,associate_email_pattern text);
create table biometric_enrolments(company_id uuid,enrolment_id text,worker_type text,profile_type text,account_id uuid,location_id uuid,status text,effective_from date,effective_to date,created_by uuid);
create table workforce_amazon_invitation_requests(id uuid primary key default gen_random_uuid(),company_id uuid,workforce_id uuid not null,station_id uuid,source_portal text,amazon_email text,first_name text,last_name text,requested_by uuid,status text default 'queued',requested_at timestamptz default now(),external_reference text,error_message text,error_code text,completed_at timestamptz,claimed_at timestamptz,claimed_by text,attempt_count integer default 0,updated_at timestamptz);
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
const c=id(1),actor=id(2),station=id(3),designation=id(4),category=id(5),worker=id(6),legacy=id(7),secondDesignation=id(8),confirmedWorker=id(9),secondStation=id(10),secondWorker=id(11);
test('pilot migration enforces exact joins, immutable payroll boundary and idempotent invitations',async()=>{
 const db=new PGlite();try{
 await db.exec(schema);await db.exec(readFileSync(new URL('../supabase/migrations/20261002170849_amazon_onboarding_pilot.sql',import.meta.url),'utf8'));await db.exec(readFileSync(new URL('../supabase/migrations/20261004124500_confirm_amazon_mobile_overlap.sql',import.meta.url),'utf8'));await db.exec(readFileSync(new URL('../supabase/migrations/20261004153712_amazon_email_alias_pilot.sql',import.meta.url),'utf8'));await db.exec(readFileSync(new URL('../supabase/migrations/20261004170540_isolate_amazon_email_pilot_candidates.sql',import.meta.url),'utf8'));await db.exec(readFileSync(new URL('../supabase/migrations/20261004172956_index_amazon_email_pilot_isolation.sql',import.meta.url),'utf8'));await db.exec(readFileSync(new URL('../supabase/migrations/20261004190000_amazon_pilot_lsc_driver_identity.sql',import.meta.url),'utf8'));await db.exec(readFileSync(new URL('../supabase/migrations/20261004203000_configurable_onboarding_exit.sql',import.meta.url),'utf8'));await db.exec(readFileSync(new URL('../supabase/migrations/20261005121500_isolated_pilot_registration_and_decision.sql',import.meta.url),'utf8'));
 await db.exec(`insert into companies values('${c}');insert into profiles values('${actor}');insert into stations values('${station}','${c}','TLPB'),('${secondStation}','${c}','KGQA');insert into designation_categories values('${category}','delivery_network');insert into designations values('${designation}','${c}','DA',true,'${category}'),('${secondDesignation}','${c}','DCD',true,'${category}');insert into workforce_amazon_station_settings values('${station}','${c}',true,'{first_name}.{station_code}.{unique}@drivers.dropx.test'),('${secondStation}','${c}',true,'{full_name}.{station_code}@drivers.dropx.test');`);
 const day=(await db.query("select (now() at time zone 'Asia/Kolkata')::date::text as today")).rows[0].today;
 const input={id:worker,full_name:'Synthetic Pilot',mobile:'9000000000',email:'synthetic@example.test',station_id:station,designation_id:designation,reported_on:day,biometric_id:'98765',dropx_id:'TEST-PILOT',trial_days:0};
 await db.query('select workforce_create_amazon_alias_pilot($1,$2,$3,null)',[c,actor,JSON.stringify(input)]);
 const firstAlias=(await db.query('select alias_email,status from workforce_amazon_email_aliases where workforce_id=$1',[worker])).rows[0];
 assert.match(firstAlias.alias_email,/^synthetic\.tlpb\.[a-f0-9]{8}@drivers\.dropx\.test$/);assert.equal(firstAlias.status,'reserved');
 const internalIdentity=(await db.query('select dropx_id,onboarding_token_hash from workforce where id=$1',[worker])).rows[0];
 assert.equal(internalIdentity.dropx_id,null);assert.equal(internalIdentity.onboarding_token_hash,null);
 for(let i=0;i<2;i++)await db.query('select workforce_queue_amazon_pilot($1,$2)',[c,worker]);
 assert.equal((await db.query('select count(*)::int n from workforce_amazon_invitation_requests')).rows[0].n,1);
 assert.equal((await db.query('select amazon_email from workforce_amazon_invitation_requests where workforce_id=$1',[worker])).rows[0].amazon_email,firstAlias.alias_email);
 const secondInput={...input,id:secondWorker,mobile:'9000000001',station_id:secondStation,full_name:'Second Pilot'};
 await db.query('select workforce_create_amazon_alias_pilot($1,$2,$3,null)',[c,actor,JSON.stringify(secondInput)]);
 const secondAlias=(await db.query('select alias_email from workforce_amazon_email_aliases where workforce_id=$1',[secondWorker])).rows[0].alias_email;
 assert.match(secondAlias,/^secondpilot\.kgqa\.[a-f0-9]{8}@drivers\.dropx\.test$/);
 assert.notEqual(secondAlias,firstAlias.alias_email);
 const inbound=(await db.query('select workforce_ingest_amazon_pilot_email($1,$2,$3,$4,$5,$6,now()) result',[firstAlias.alias_email,'no-reply@amazon.com','message-1','Complete registration','Open your invitation','https://logistics.amazon.in/invite/test'])).rows[0].result;
 assert.equal(inbound.accepted,true);assert.equal(inbound.duplicate,false);
 const duplicate=(await db.query('select workforce_ingest_amazon_pilot_email($1,$2,$3,$4,$5,$6,now()) result',[firstAlias.alias_email,'no-reply@amazon.com','message-1','Complete registration','Open your invitation','https://logistics.amazon.in/invite/test'])).rows[0].result;
 assert.equal(duplicate.duplicate,true);
 assert.equal((await db.query('select status from workforce_amazon_email_aliases where workforce_id=$1',[worker])).rows[0].status,'receiving');
 await assert.rejects(db.query('update workforce set is_active=true where id=$1',[worker]),/observation-only/);
 await assert.rejects(db.query('insert into field_executive_provider_mappings(workforce_id) values($1)',[worker]),/Pilot records cannot/);
 await assert.rejects(db.query('insert into workforce_adjustments(workforce_id) values($1)',[worker]),/Pilot records cannot/);
 await db.query('insert into workforce(id,is_active) values($1,false)',[legacy]);await db.query('update workforce set is_active=true where id=$1',[legacy]);
 await db.query('insert into field_executive_provider_mappings(workforce_id) values($1)',[legacy]);
 const p=(await db.query('select trial_days,trial_completed_at,invitation_timing from workforce_amazon_pilots')).rows[0];
 assert.equal(p.trial_days,0);assert.equal(p.trial_completed_at,null);assert.equal(p.invitation_timing,'on_arrival');
 assert.equal((await db.query('select count(*)::int n from workforce_amazon_pilot_trials')).rows[0].n,0);

 const isolatedCandidate=id(30);
 const isolatedInput={id:isolatedCandidate,full_name:'Isolated Candidate',mobile:'9000000030',station_id:station,designation_id:designation,reported_on:day,biometric_id:'BIO-ISOLATED'};
 await db.query('select workforce_create_isolated_amazon_email_pilot($1,$2,$3,null)',[c,actor,JSON.stringify(isolatedInput)]);
 assert.equal((await db.query('select count(*)::int n from workforce where id=$1',[isolatedCandidate])).rows[0].n,0);
 const isolated=(await db.query('select alias_email,status,duplicate_identity_detected from workforce_amazon_email_pilot_candidates where id=$1',[isolatedCandidate])).rows[0];
 assert.match(isolated.alias_email,/^isolated\.tlpb\.0030@drivers\.dropx\.test$/);
 assert.equal(isolated.status,'ready');
 assert.equal(isolated.duplicate_identity_detected,false);
 const isolatedRequest=(await db.query('select workforce_queue_isolated_amazon_email_pilot($1,$2,$3,null) id',[c,actor,isolatedCandidate])).rows[0].id;
 await db.query('select workforce_queue_isolated_amazon_email_pilot($1,$2,$3,null)',[c,actor,isolatedCandidate]);
 const isolatedQueue=(await db.query('select workforce_id,email_pilot_candidate_id,status from workforce_amazon_invitation_requests where id=$1',[isolatedRequest])).rows[0];
 assert.equal(isolatedQueue.workforce_id,null);assert.equal(isolatedQueue.email_pilot_candidate_id,isolatedCandidate);assert.equal(isolatedQueue.status,'queued');
 await db.query("update workforce_amazon_invitation_requests set status='processing' where id=$1",[isolatedRequest]);
 await db.query("select workforce_finish_amazon_invitation($1,$2,'sent','amazon-test',null,null)",[c,isolatedRequest]);
 assert.equal((await db.query('select status from workforce_amazon_email_pilot_candidates where id=$1',[isolatedCandidate])).rows[0].status,'sent');
 const isolatedInbound=(await db.query('select workforce_ingest_amazon_pilot_email($1,$2,$3,$4,$5,$6,now()) result',[isolated.alias_email,'no-reply@amazon.com','isolated-message','Complete setup','Continue registration','https://logistics.amazon.in/invite/isolated'])).rows[0].result;
 assert.equal(isolatedInbound.accepted,true);assert.equal(isolatedInbound.candidate_id,isolatedCandidate);
 assert.equal((await db.query('select status from workforce_amazon_email_pilot_candidates where id=$1',[isolatedCandidate])).rows[0].status,'email_received');
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
 await assert.rejects(db.query('select workforce_create_amazon_alias_pilot($1,$2,$3,null)',[c,actor,JSON.stringify({...input,id:id(12),email:'same-role@example.test'})]),/duplicate registration for the same designation/);
 const secondary={...input,id:confirmedWorker,designation_id:secondDesignation,email:'secondary@example.test',dropx_id:'TEST-SECONDARY'};
 await assert.rejects(db.query('select workforce_create_amazon_alias_pilot($1,$2,$3,null)',[c,actor,JSON.stringify(secondary)]),/Confirm this as a separate Workforce registration/);
 await db.query('select workforce_create_amazon_alias_pilot($1,$2,$3,null)',[c,actor,JSON.stringify({...secondary,identity_exception_confirmed:true})]);
 const confirmation=(await db.query("select evidence from workforce_amazon_pilot_history where workforce_id=$1 and event='reported'",[confirmedWorker])).rows[0].evidence;
 assert.equal(confirmation.identity_exception_confirmed,true);
 assert.equal(confirmation.identity_exception_profiles.length,1);
 const reason=id(20);
 await db.query("insert into workforce_onboarding_exit_reasons(id,company_id,client_code,code,label,requires_note) values($1,$2,'AMAZON','role_not_suitable','Role not suitable',false)",[reason,c]);
 await db.query("insert into workforce_amazon_email_pilot_registrations(candidate_id,company_id,draft_data,status,submitted_at) values($1,$2,$3,'submitted',now())",[isolatedCandidate,c,JSON.stringify({_beta_status:'submitted'})]);
 assert.equal((await db.query('select status from workforce_amazon_email_pilot_registrations where candidate_id=$1',[isolatedCandidate])).rows[0].status,'submitted');
 await db.query("select workforce_update_isolated_amazon_email_pilot_decision($1,$2,'continue_amazon',null,'')",[c,isolatedCandidate]);
 assert.equal((await db.query('select continuation_status from workforce_amazon_email_pilot_candidates where id=$1',[isolatedCandidate])).rows[0].continuation_status,'continuing');
 await db.query("select workforce_update_isolated_amazon_email_pilot_decision($1,$2,'not_continuing',$3,'Training did not suit')",[c,isolatedCandidate,reason]);
 const isolatedExit=(await db.query('select candidate_id,alias_email,amazon_profile_id,status from workforce_amazon_email_pilot_exit_requests where candidate_id=$1',[isolatedCandidate])).rows[0];
 assert.equal(isolatedExit.candidate_id,isolatedCandidate);assert.equal(isolatedExit.amazon_profile_id,'amazon-test');assert.equal(isolatedExit.status,'queued');
 assert.equal((await db.query('select count(*)::int n from workforce where id=$1',[isolatedCandidate])).rows[0].n,0);
 await db.query('select workforce_submit_amazon_pilot_exit($1,$2,$3,$4)',[c,worker,reason,'Not a fit after training']);
 const closed=(await db.query('select closed_at,exit_reason_id,exit_requested_source from workforce_amazon_pilots where workforce_id=$1',[worker])).rows[0];
 assert.ok(closed.closed_at);assert.equal(closed.exit_reason_id,reason);assert.equal(closed.exit_requested_source,'associate');
 assert.equal((await db.query('select status from biometric_enrolments where account_id=$1',[worker])).rows[0].status,'Inactive');
 await db.query('select workforce_reactivate_amazon_pilot($1,$2,$3,null)',[c,actor,worker]);
 const reopened=(await db.query('select closed_at,reactivated_by from workforce_amazon_pilots where workforce_id=$1',[worker])).rows[0];
 assert.equal(reopened.closed_at,null);assert.equal(reopened.reactivated_by,actor);
 assert.equal((await db.query('select status from biometric_enrolments where account_id=$1',[worker])).rows[0].status,'Active');
 }finally{await db.close();}
});
