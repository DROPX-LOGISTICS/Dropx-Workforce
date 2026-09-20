import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
export async function testHoldSql(db){
  await db.exec(readFileSync(new URL('../supabase/migrations/20260920203928_workforce_operational_holds.sql',import.meta.url),'utf8'));
  const u=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
  const company=u(1),actor=u(2),reviewer=u(3),worker=u(602),station=u(600),run=u(605);
  const payload={period_start:'2027-01-01',period_end:'2027-01-07',reason:'Synthetic test hold',reference:'TEST-HOLD'};
  const manage=(id,person,action,data,by=actor,scope=[station],canReview=false)=>db.query('select workforce_manage_payment_hold($1,$2,$3,$4,$5,$6,$7,$8) id',[company,by,id,person,action,data,scope,canReview]);
  await assert.rejects(manage(null,worker,'create',payload,actor,[u(999)]),/station scope/);
  const id=(await manage(null,worker,'create',payload)).rows[0].id;
  await assert.rejects(manage(null,worker,'create',payload),/duplicate/);
  await assert.rejects(db.query("select workforce_change_payroll_state($1,$2,$3,'submit',false,null,null,null)",[company,run,actor]),/Ops payment hold/);
  await manage(id,null,'request_release',{});
  await assert.rejects(manage(id,null,'release',{note:'Reviewed and cleared'},actor,[station],true),/different authorised/);
  await manage(id,null,'release',{note:'Reviewed and cleared'},reviewer,[station],true);
  await db.query("select workforce_change_payroll_state($1,$2,$3,'submit',false,null,null,null)",[company,run,actor]);
  // A later hold must still stop Finance even after Workforce confirmation.
  const next=u(720),item=u(721);
  await db.query("insert into workforce_payroll_runs(id,company_id,run_number,period_start,period_end,status,submitted_by,submitted_at,ready_count,worker_count,net_amount) values($1,$2,'HOLD-FINANCE','2028-01-01','2028-01-07','review',$3,now(),1,1,500)",[next,company,actor]);
  await db.query("insert into workforce_payroll_items(id,company_id,payroll_run_id,workforce_id,dropx_id,worker_name,station_code,bank_account_no,ifsc_code,net_amount) values($1,$2,$3,$4,'SYNTHETIC','Synthetic','TEST','12345','TEST000001',500)",[item,company,next,u(4)]);
  await db.query('select workforce_confirm_payroll($1,$2,$3,$4,true,null)',[company,next,reviewer,u(401)]);
  const payment=(await db.query('select payment_request_id id from workforce_payroll_finance_links where payroll_run_id=$1',[next])).rows[0].id;
  await db.query("update payment_requests set status='approved',updated_by=$2 where id=$1",[payment,reviewer]);
  const second=(await manage(null,u(4),'create',{...payload,period_start:'2028-01-01',period_end:'2028-01-07',reference:'LATE-HOLD'},actor,[u(5)])).rows[0].id;
  await assert.rejects(db.query("update payment_requests set status='processing' where id=$1",[payment]),/Ops payment hold/);
  await manage(second,null,'release',{note:'Evidence resolved'},reviewer,[u(5)],true);
  await db.query("update payment_requests set status='processing' where id=$1",[payment]);
  await assert.rejects(manage(null,u(4),'create',{...payload,period_start:'2028-01-01',period_end:'2028-01-07',reference:'TOO-LATE'},actor,[u(5)]),/already at the bank/);
  for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'workforce_manage_payment_hold(uuid,uuid,uuid,uuid,text,jsonb,uuid[],boolean)','EXECUTE') allowed",[role])).rows[0].allowed,false);
  console.log('PASS: Ops hold station scope, duplicate reference, different release reviewer, payroll gate, late Finance gate, in-bank guard and server-only RPC.');
}
