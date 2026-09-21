import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export async function testExitRecordedSql(db){
 await db.exec(readFileSync(new URL('../supabase/migrations/20260921010900_workforce_exit_recorded_checks.sql',import.meta.url),'utf8'));
 const u=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
 const company=u(1),maker=u(2),owner=u(3),station=u(5),person=u(1400),exit=u(1401),run=u(1402),item=u(1403),adjustment=u(1404);
 await db.query("insert into workforce(id,company_id,location_id,is_active,onboarding_status,migration_state,lifecycle_status) values($1,$2,$3,true,'active','canonical','active')",[person,company,station]);
 const checks=async(c=company,scope=[station])=>(await db.query('select workforce_exit_recorded_checks($1,$2,$3) evidence',[c,person,scope])).rows[0].evidence;
 const blank={payroll_items:0,unreconciled_payroll:0,unposted_adjustments:0,unreconciled_posted_adjustments:0,active_holds:0,unsettled_windows:0};
 assert.deepEqual(await checks(),blank);
 await assert.rejects(checks(u(999)),/canonical/);await assert.rejects(checks(company,[u(999)]),/station scope/);await assert.rejects(checks(company,[]),/station scope/);
 await db.query("insert into workforce_lifecycle_cases(id,company_id,profile_location_id,profile_type,profile_id,status,approved_effective_date,requested_effective_date) values($1,$2,$3,'workforce',$4,'settlement_pending','2025-04-02','2025-04-02')",[exit,company,station,person]);
 await assert.rejects(db.query("update workforce_lifecycle_cases set status='settled' where id=$1",[exit]),/No recorded payroll/);
 await db.query("insert into workforce_payroll_runs(id,company_id,run_number,period_start,period_end,status,submitted_by,submitted_at,ready_count,worker_count,net_amount) values($1,$2,'EXIT-RECORDED','2025-04-01','2025-04-02','review',$3,now(),1,1,700)",[run,company,maker]);
 await db.query("insert into workforce_payroll_items(id,company_id,payroll_run_id,workforce_id,dropx_id,worker_name,station_code,bank_account_no,ifsc_code,gross_amount,deduction_amount,net_amount) values($1,$2,$3,$4,'TEST-RECORDED','Synthetic recorded exit','TEST','12345','TEST000001',800,100,700)",[item,company,run,person]);
 assert.equal((await checks()).unreconciled_payroll,1);
 await db.query('select workforce_confirm_payroll($1,$2,$3,$4,true,null)',[company,run,owner,u(401)]);
 const payment=(await db.query('select payment_request_id id from workforce_payroll_finance_links where payroll_item_id=$1',[item])).rows[0].id;
 assert.equal((await checks()).unreconciled_payroll,1);
 await db.query("update payment_requests set status='approved',updated_by=$2 where id=$1",[payment,owner]);
 await db.query("update payment_requests set status='processed',utr_cin='RECORDED-TEST-UTR',processed_at=now() where id=$1",[payment]);
 assert.deepEqual(await checks(),{...blank,payroll_items:1});
 const reconcile=()=>db.query('select workforce_reconcile_exit($1,$2,$3,$4,true,$5,$6,$7)',[company,exit,item,owner,'Synthetic all-period review complete',[],[station]]);
 // Imported legacy paid flag lacks individual payment proof. It must block, even
 // though the selected final item is independently paid and covers the exit date.
 const oldRun=u(1405),oldItem=u(1406);
 await db.query("insert into workforce_payroll_runs(id,company_id,run_number,period_start,period_end,status,submitted_by,submitted_at,approved_by,approved_at,paid_by,paid_at) values($1,$2,'UNPROVEN-OLD-PAY','2025-02-01','2025-02-02','paid',$3,now(),$4,now(),$4,now())",[oldRun,company,maker,owner]);
 await db.query("insert into workforce_payroll_items(id,company_id,payroll_run_id,workforce_id,dropx_id,worker_name,status,gross_amount,net_amount) values($1,$2,$3,$4,'TEST-RECORDED','Synthetic','paid',200,200)",[oldItem,company,oldRun,person]);
 assert.equal((await checks()).unreconciled_payroll,1);
 await assert.rejects(reconcile(),/every recorded payroll/);
 assert.equal((await db.query('select is_active from workforce where id=$1',[person])).rows[0].is_active,true);
 assert.equal((await db.query('select count(*)::int n from workforce_exit_payment_reconciliations where lifecycle_case_id=$1',[exit])).rows[0].n,0);
 await db.query('delete from workforce_payroll_items where id=$1',[oldItem]);
 await db.query('delete from workforce_payroll_runs where id=$1',[oldRun]);
 // A "posted" flag without an exact source line is not a cleared claim.
 await db.query("insert into workforce_adjustments(id,company_id,workforce_id,adjustment_type,category,amount,effective_date,reason,status,requested_by,payroll_run_id,reviewed_by,reviewed_at) values($1,$2,$3,'deduction','other',100,'2025-04-02','Synthetic source check','posted',$4,$5,$6,now())",[adjustment,company,person,maker,run,owner]);
 assert.equal((await checks()).unreconciled_posted_adjustments,1);
 await assert.rejects(reconcile(),/exact paid payroll lines/);
 await db.query("insert into workforce_payroll_lines(company_id,payroll_run_id,payroll_item_id,workforce_id,source_type,source_id,work_date,adjustment_amount,net_amount,calculation_source) values($1,$2,$3,$4,'adjustment',$5,'2025-04-02',-99,-99,'adjustment')",[company,run,item,person,adjustment]);
 assert.equal((await checks()).unreconciled_posted_adjustments,1);
 await db.query('update workforce_payroll_lines set adjustment_amount=-100,net_amount=-100 where source_id=$1',[adjustment]);
 assert.equal((await checks()).unreconciled_posted_adjustments,0);
 await db.query("insert into workforce_payment_holds(company_id,workforce_id,station_id,period_start,period_end,reason,reference,requested_by) values($1,$2,$3,'2025-04-01','2025-04-02','Synthetic preflight hold','RECORDED-HOLD',$4)",[company,person,station,maker]);
 assert.equal((await checks()).active_holds,1);
 await db.query("update workforce_payment_holds set status='released',released_by=$2,released_at=now(),release_note='Synthetic resolved' where workforce_id=$1",[person,owner]);
 const before=(await db.query('select count(*)::int n from payment_requests')).rows[0].n;
 await reconcile();await reconcile();
 assert.equal((await db.query('select is_active from workforce where id=$1',[person])).rows[0].is_active,false);
 assert.equal((await db.query('select count(*)::int n from payment_requests')).rows[0].n,before);
 for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'workforce_exit_recorded_checks(uuid,uuid,uuid[])','EXECUTE') allowed",[role])).rows[0].allowed,false);
 assert.equal((await db.query("select has_function_privilege('service_role','workforce_exit_recorded_checks(uuid,uuid,uuid[])','EXECUTE') allowed")).rows[0].allowed,true);
 console.log('PASS: recorded exit checks, tenant/station scope, empty-ledger refusal, old unproven paid flag, exact posted-claim source proof, atomic rollback, successful reconciliation and no duplicate payment.');
}
