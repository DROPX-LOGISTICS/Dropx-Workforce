import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export async function testCalendarSql(db) {
  await db.exec(readFileSync(new URL('../supabase/migrations/20260920203021_workforce_station_payroll_calendars.sql',import.meta.url),'utf8'));
  const u=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
  const company=u(1),actor=u(2),station=u(600),second=u(601),worker=u(602),other=u(603),calendar=u(604),run=u(605),another=u(606);
  await db.query("insert into stations(id,company_id,station_code) values($1,$3,'CAL1'),($2,$3,'CAL2')",[station,second,company]);
  await db.query("insert into workforce(id,company_id,location_id,migration_state,is_active,onboarding_status) values($1,$3,$4,'canonical',true,'active'),($2,$3,$5,'canonical',true,'active')",[worker,other,company,station,second]);
  await db.query("insert into workforce_payroll_calendars(id,company_id,station_id,name,cadence,anchor_date,policy_reference,created_by) values($1,$2,$3,'Synthetic weekly','weekly','2027-01-01','Synthetic only',$4)",[calendar,company,station,actor]);
  await assert.rejects(db.query("update workforce_payroll_calendars set cadence='daily' where id=$1",[calendar]),/immutable/);
  const save=(id,stationId,who,code,calendarId=null)=>db.query('select workforce_save_payroll_snapshot($1,$2,$3,$4,$5,$6)',[company,actor,{id,run_number:id,period_start:'2027-01-01',period_end:'2027-01-07',station_id:stationId,calendar_id:calendarId,exception_count:0},[{id:u(Number(id.slice(-3))+50),company_id:company,payroll_run_id:id,workforce_id:who,dropx_id:'SYNTHETIC',worker_name:'Synthetic',station_code:code,status:'ready',hold_reasons:[],provider_member_ids:[],shipment_count:0,activity_count:0,work_days:0,base_amount:0,incentive_amount:0,adjustment_amount:0,deduction_amount:0,gross_amount:0,net_amount:0}],[],[]]);
  await save(run,station,worker,'CAL1',calendar);
  assert.equal((await db.query('select station_id from workforce_payroll_runs where id=$1',[run])).rows[0].station_id,station);
  await assert.rejects(save(u(607),station,worker,'CAL1'),/overlaps/);
  await assert.rejects(save(another,second,worker,'CAL2'),/associate already/);
  await save(another,second,other,'CAL2');
  await assert.rejects(save(u(608),null,other,'CAL2'),/overlaps/);
  await assert.rejects(save(u(609),u(999),other,'CAL2'),/outside this company/);
  await db.query("update workforce_payroll_calendars set is_active=false,retired_by=$2,retired_at=now() where id=$1",[calendar,actor]);
  await assert.rejects(db.query("update workforce_payroll_calendars set is_active=true where id=$1",[calendar]),/immutable/);
  for(const role of ['anon','authenticated']) assert.equal((await db.query("select has_table_privilege($1,'workforce_payroll_calendars','SELECT') allowed",[role])).rows[0].allowed,false);
  console.log('PASS: station calendars immutable, separate station cycles, network overlap, cross-station associate double-pay guard, invalid station and server-only access.');
}
