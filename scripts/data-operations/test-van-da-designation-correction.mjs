import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const sql = await fs.readFile(new URL('./20261020_van_da_designation_correction.sql', import.meta.url), 'utf8');
const scope = JSON.parse(sql.match(/\$scope\$([\s\S]*?)\$scope\$/)[1]);
const company = '43866344-b550-4e8a-9a2d-9d23f3d8a997';
const da = '0bb05cb0-a9ae-4520-b840-633acbfd0d47';
const unrelated = '00000000-0000-4000-8000-000000000099';
// Fixture execution keeps the production script's dated guard, using today's
// fixture date so the local test remains runnable after the operation date.
const fixtureSql = sql.replace("v_day constant date := date '2026-10-20';",
  "v_day constant date := (now() at time zone 'Asia/Kolkata')::date;");

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create table designations(id uuid primary key, company_id uuid, code text, name text,
      is_active boolean, is_field_operations boolean, provider_mapping_required boolean);
    create table workforce(id uuid primary key,company_id uuid,dropx_id text,full_name text,
      designation_id uuid,designation text,is_active boolean,deleted_at timestamptz,updated_at timestamptz);
    create table payment_methods(id uuid primary key,code text);
    create table field_executive_provider_mappings(id uuid primary key,company_id uuid,workforce_id uuid,
      payment_method_id uuid,status text,effective_from date,effective_to date,provider_member_id text,station_id uuid);
    create table workforce_payment_allocations(id uuid primary key,company_id uuid,amount numeric);
    create table fleet_vehicles(id uuid primary key,company_id uuid,ownership_type text,deployment_status text);
    create table fleet_vehicle_da_defaults(id uuid primary key,company_id uuid,vehicle_id uuid,
      station_code text,provider_employee_id text);
    create table stations(id uuid primary key,company_id uuid,station_code text,region text,state text);
  `);
  for (const [id,code,name] of [
    [da,'DA','Delivery Associate'],
    ['8e8cd67a-803d-4069-91fa-0f42195d401c','DCD','Driver cum DA'],
    ['c4d4f44d-bd9c-4dad-ba0d-2711ac7ef2a0','ODCD','Own Van Driver cum DA'],
  ]) await db.query('insert into designations values($1,$2,$3,$4,true,true,true)',[id,company,code,name]);
  await db.query('insert into payment_methods values($1,$2)',[da,'PER_PACKET_VAN_RENT_PER_DAY']);
  await db.query('insert into stations values($1,$2,$3,$4,$5)',[da,company,'TEST','KL','Kerala']);
  await db.query('insert into workforce_payment_allocations values($1,$2,600)',[da,company]);
  for (const p of [...scope,{workforce_id:unrelated,dropx_id:'UNRELATED',amazon_ids:[],mapping_ids:[],fleet_defaults:[]}]) {
    await db.query('insert into workforce values($1,$2,$3,$4,$5,$6,true,null,now())',
      [p.workforce_id,company,p.dropx_id,'Fixture associate',da,'Delivery Associate']);
    for (const m of p.mapping_ids) await db.query(
      'insert into field_executive_provider_mappings values($1,$2,$3,$4,$5,current_date-1,null,$6,$7)',
      [m,company,p.workforce_id,da,'active',p.amazon_ids[0],da]);
    for (const f of p.fleet_defaults) {
      await db.query('insert into fleet_vehicles values($1,$2,$3,$4)',[f,company,'own','deployed']);
      await db.query('insert into fleet_vehicle_da_defaults values($1,$2,$1,$3,$4)',[f,company,'TEST',p.amazon_ids[0]]);
    }
  }
  return db;
}

test('rehearsal validates all 36 profiles and rolls every designation back',async()=>{
  const db=await fixture();
  try {
    const results=await db.exec(fixtureSql);
    const receipt=results.flatMap(r=>r.rows).find(r=>r.designation_correction)?.designation_correction;
    assert.equal(receipt.changed,36);
    assert.equal(receipt.profiles.filter(p=>p.new_designation==='ODCD').length,18);
    assert.equal(receipt.profiles.filter(p=>p.new_designation==='DCD').length,18);
    assert.equal(receipt.profiles.find(p=>p.dropx_id==='T1013').new_designation,'ODCD');
    assert.equal((await db.query('select count(*)::int n from workforce where designation_id<>$1',[da])).rows[0].n,0);
  } finally { await db.close(); }
});

test('changed current mapping aborts the operation',async()=>{
  const db=await fixture();
  try {
    await db.query("update field_executive_provider_mappings set status='inactive' where workforce_id=$1",[scope[0].workforce_id]);
    await assert.rejects(db.exec(fixtureSql),/Current mapping evidence changed/);
    await db.exec('rollback');
    assert.equal((await db.query('select count(*)::int n from workforce where designation_id<>$1',[da])).rows[0].n,0);
  } finally { await db.close(); }
});

test('a trigger that changes direct payment terms forces rollback',async()=>{
  const db=await fixture();
  try {
    await db.exec(`create function test_payment_trigger() returns trigger language plpgsql as $$
      begin update workforce_payment_allocations set amount=amount+1; return new; end $$;
      create trigger test_payment after update on workforce for each row execute function test_payment_trigger();`);
    await assert.rejects(db.exec(fixtureSql),/Direct payment terms changed/);
    await db.exec('rollback');
    assert.equal((await db.query('select amount from workforce_payment_allocations')).rows[0].amount,'600');
  } finally { await db.close(); }
});

test('different designation payment policy aborts before modifying profiles',async()=>{
  const db=await fixture();
  try {
    await db.exec("update designations set provider_mapping_required=false where code='ODCD'");
    await assert.rejects(db.exec(fixtureSql),/Payment policy would change/);
    await db.exec('rollback');
    assert.equal((await db.query('select count(*)::int n from workforce where designation_id<>$1',[da])).rows[0].n,0);
  } finally { await db.close(); }
});
