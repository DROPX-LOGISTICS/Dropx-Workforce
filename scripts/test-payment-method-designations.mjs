import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const migration = read('supabase/migrations/20260928103000_workforce_payment_methods_by_designation.sql');
const company = '10000000-0000-0000-0000-000000000001';
const other = '10000000-0000-0000-0000-000000000002';
const actor = '20000000-0000-0000-0000-000000000001';
const deliveryCategory = '30000000-0000-0000-0000-000000000001';
const peopleCategory = '30000000-0000-0000-0000-000000000002';
const da = '40000000-0000-0000-0000-000000000001';
const dcd = '40000000-0000-0000-0000-000000000002';
const hr = '40000000-0000-0000-0000-000000000003';
const worker = '50000000-0000-0000-0000-000000000001';
const method = '60000000-0000-0000-0000-000000000001';

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create table companies(id uuid primary key);
    create table designation_categories(id uuid primary key,company_id uuid not null,people_module text not null,is_active boolean not null default true);
    create table designations(id uuid primary key,company_id uuid not null,designation_category_id uuid not null references designation_categories(id),is_active boolean not null default true);
    create table payment_methods(id uuid primary key default gen_random_uuid(),company_id uuid not null,code text not null,name text not null,is_active boolean not null default true);
    create table workforce(id uuid primary key,company_id uuid not null,designation_id uuid,deleted_at timestamptz,migration_state text not null default 'canonical');
    create table field_executive_provider_mappings(id uuid primary key default gen_random_uuid(),company_id uuid not null,workforce_id uuid,payment_method_id uuid);
    insert into auth.users values('${actor}');
    insert into companies values('${company}'),('${other}');
    insert into designation_categories values('${deliveryCategory}','${company}','delivery_network',true),('${peopleCategory}','${company}','people_hr',true);
    insert into designations values('${da}','${company}','${deliveryCategory}',true),('${dcd}','${company}','${deliveryCategory}',true),('${hr}','${company}','${peopleCategory}',true);
    insert into payment_methods values('${method}','${company}','PER_PACKET','Per packet',true);
    insert into workforce values('${worker}','${company}','${da}',null,'canonical');
    create function workforce_save_payment_method_v2(uuid,uuid,uuid,text,text,uuid[],text,text) returns uuid language sql as $$select coalesce($3,gen_random_uuid())$$;
  `);
  await db.exec(migration);
  return db;
}

test('existing methods are preserved and opened only to Workforce designations', async () => {
  const db = await database();
  try {
    const rows = (await db.query('select designation_id from workforce_payment_method_designations where payment_method_id=$1 order by designation_id',[method])).rows;
    assert.deepEqual(rows.map(row=>row.designation_id),[da,dcd]);
  } finally { await db.close(); }
});

test('master saves an explicit designation set and rejects HR designations', async () => {
  const db = await database();
  try {
    await db.query('select workforce_save_payment_method_v3($1,$2,$3,$4,$5,$6::uuid[],$7,$8,$9::uuid[])',[company,actor,method,'PER_PACKET','Per packet',[], 'amazon_daily_shipment','shipment_activity',[dcd]]);
    const rows=(await db.query('select designation_id from workforce_payment_method_designations where payment_method_id=$1',[method])).rows;
    assert.deepEqual(rows.map(row=>row.designation_id),[dcd]);
    await assert.rejects(db.query('select workforce_save_payment_method_v3($1,$2,$3,$4,$5,$6::uuid[],$7,$8,$9::uuid[])',[company,actor,method,'PER_PACKET','Per packet',[], 'amazon_daily_shipment','shipment_activity',[hr]]),/inactive or unavailable/);
  } finally { await db.close(); }
});

test('database guard blocks mappings outside the associate designation', async () => {
  const db = await database();
  try {
    await db.query('delete from workforce_payment_method_designations where payment_method_id=$1 and designation_id=$2',[method,da]);
    await assert.rejects(db.query('insert into field_executive_provider_mappings(company_id,workforce_id,payment_method_id) values($1,$2,$3)',[company,worker,method]),/not enabled for the associate designation/);
    await db.query('insert into workforce_payment_method_designations(company_id,payment_method_id,designation_id,updated_by) values($1,$2,$3,$4)',[company,method,da,actor]);
    await db.query('insert into field_executive_provider_mappings(company_id,workforce_id,payment_method_id) values($1,$2,$3)',[company,worker,method]);
  } finally { await db.close(); }
});

test('UI and both assignment paths use the designation rule', () => {
  assert.match(read('src/app/master/payment-methods/actions.ts'), /workforce_save_payment_method_v3/);
  assert.match(read('src/components/provider-mapping-worksheet.tsx'), /method\.designationIds\.includes\(row\.designationId\)/);
  assert.match(read('src/app/provider-mapping/actions.ts'), /workforce_payment_method_designations/);
  assert.match(read('src/components/workforce-associate-setup.tsx'), /workforce_payment_method_designations/);
  assert.match(read('src/app/delivery-network/lifecycle/terms-actions.ts'), /not enabled for the associate designation/);
});
