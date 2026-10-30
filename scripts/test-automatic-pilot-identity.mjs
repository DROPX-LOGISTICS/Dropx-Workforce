import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {PGlite} from '@electric-sql/pglite';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const company=id(1),candidate=id(2),station=id(3),designation=id(4);
const schema=`create role anon;create role authenticated;create role service_role;
create table workforce_amazon_email_pilot_candidates(id uuid primary key,company_id uuid,station_id uuid,designation_id uuid,full_name text,mobile text,alias_email text,biometric_id text,reported_on date,created_by uuid,closed_at timestamptz,continuation_status text,inbox_status text,duplicate_identity_detected boolean);
create table workforce_amazon_email_pilot_registrations(company_id uuid,candidate_id uuid,status text,submitted_at timestamptz);
create table workforce_beta_verification_snapshots(company_id uuid,candidate_id uuid,operational_status text,driver_id text,identity_email text,amazon_profile_id text,lsc_observed_at timestamptz);
create table workforce_amazon_invitation_requests(company_id uuid,email_pilot_candidate_id uuid,external_reference text);
create table workforce_beta_verification_cases(company_id uuid,candidate_id uuid,status text);
create table workforce_beta_verification_events(company_id uuid,candidate_id uuid,event text,detail jsonb);
create table stations(id uuid primary key,company_id uuid,location_model_id uuid);
create table designations(id uuid primary key,company_id uuid,name text);
create table workforce(id uuid primary key,company_id uuid,full_name text,mobile text,email text,date_of_join date,location_id uuid,designation_id uuid,designation text,biometric_id text,dropx_id text,source_profile_type text,source_profile_id uuid,compatibility_mode boolean,migration_state text,is_active boolean,onboarding_status text,lifecycle_status text,approval_required boolean,onboarding_submitted_at timestamptz,provider_id_status text,provider_employee_id text,onboarding_application_source text,onboarding_source_detail text,station_email_exception_note text,created_by uuid,deleted_at timestamptz);
create table workforce_amazon_portal_links(company_id uuid,workforce_id uuid,amazon_provider_id text,amazon_email text,transporter_id text,station_mapped boolean,last_synced_at timestamptz,unique(company_id,workforce_id));
create table workforce_route_scc_snapshots(company_id uuid,station_id uuid,drivers jsonb,observed_at timestamptz);
create table field_executive_provider_mappings(company_id uuid,workforce_id uuid,provider_member_id text,status text,station_id uuid,payment_method_id uuid,effective_from date,effective_to date);
create sequence employee_code;create function generate_dropx_worker_id(uuid,text,uuid,uuid,uuid) returns text language sql as $$select 'DF'||nextval('employee_code')$$;
insert into stations values('${station}','${company}',null);insert into designations values('${designation}','${company}','DA');
insert into workforce_amazon_email_pilot_candidates values('${candidate}','${company}','${station}','${designation}','Example Associate','9000000000','example@test.invalid','100','2026-10-01',null,null,'continuing','active',false);
insert into workforce_amazon_email_pilot_registrations values('${company}','${candidate}','submitted',now());
insert into workforce_beta_verification_snapshots values('${company}','${candidate}','ACTIVE','DRIVER','example@test.invalid','PROFILE',now());
insert into workforce_amazon_invitation_requests values('${company}','${candidate}','PROFILE');`;
const migration=readFileSync(new URL('../supabase/migrations/20261030162735_automatic_pilot_workforce_identity.sql',import.meta.url),'utf8');
async function setup(){const db=new PGlite();await db.exec(schema);await db.exec(migration);await db.exec(migration);return db;}
const reconcile=async db=>(await db.query(`select reconcile_amazon_pilot_identity('${company}','${candidate}') as result`)).rows[0].result;
test('automatic identity is idempotent, defers missing SCC and does not invent payroll approval',async()=>{const db=await setup();try{
 let result=await reconcile(db);assert.equal(result.status,'awaiting_scc_identity');assert.equal(result.created,true);
 await db.exec(`insert into workforce_route_scc_snapshots values('${company}','${station}','[{"tasId":"DRIVER","employeeId":"200001"}]',now())`);
 result=await reconcile(db);assert.equal(result.status,'identity_linked');assert.equal(result.provider_employee_id,'200001');assert.equal(result.created,false);assert.equal(result.payment_configured,false);await reconcile(db);
 const w=(await db.query('select * from workforce')).rows;assert.equal(w.length,1);assert.equal(w[0].is_active,false);assert.equal(w[0].onboarding_status,'under_review');assert.equal((await db.query('select * from field_executive_provider_mappings')).rows.length,0);assert.equal((await db.query("select * from workforce_beta_verification_events where event='provider_identity_linked'")).rows.length,1);
 assert.equal((await db.query("select has_function_privilege('anon','reconcile_amazon_pilot_identity(uuid,uuid)','EXECUTE') p")).rows[0].p,false);
 }finally{await db.close()}});
test('mismatched invitation, stale status, duplicates, and conflicting source IDs stop automation',async()=>{for(const [sql,status] of [
 ["update workforce_amazon_invitation_requests set external_reference='OTHER'",'source_confirmation_pending'],
 ["update workforce_beta_verification_snapshots set lsc_observed_at=now()-interval '2 days'",'source_confirmation_pending'],
 ["update workforce_amazon_email_pilot_candidates set duplicate_identity_detected=true",'identity_review_required'],
 [`insert into workforce_route_scc_snapshots values('${company}','${station}','[{"tasId":"DRIVER","employeeId":"200001"},{"tasId":"DRIVER","employeeId":"200002"}]',now())`,'identity_conflict']
 ]){const db=await setup();try{await db.exec(sql);assert.equal((await reconcile(db)).status,status);assert.equal((await db.query('select * from workforce')).rows.length,0)}finally{await db.close()}}});
test('same name or another station cannot produce an ID link',async()=>{const db=await setup();try{await db.exec(`insert into workforce_route_scc_snapshots values('${company}','${station}','[{"tasId":"OTHER","employeeId":"200001","name":"Example Associate"}]',now()),('${company}','${id(9)}','[{"tasId":"DRIVER","employeeId":"200002"}]',now())`);assert.equal((await reconcile(db)).status,'awaiting_scc_identity')}finally{await db.close()}});
