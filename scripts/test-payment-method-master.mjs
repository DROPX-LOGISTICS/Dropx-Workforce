import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const migration = read('supabase/migrations/20260923103000_workforce_payment_method_master.sql');
const company = '10000000-0000-0000-0000-000000000001';
const other = '10000000-0000-0000-0000-000000000002';
const delivery = '20000000-0000-0000-0000-000000000001';
const returned = '20000000-0000-0000-0000-000000000002';
const foreign = '20000000-0000-0000-0000-000000000003';

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table payment_methods(id uuid primary key default gen_random_uuid(), company_id uuid, code text unique not null, name text not null, is_active boolean default true, updated_at timestamptz default now());
    create table payment_fields(id uuid primary key, company_id uuid not null, code text, field_type text, label text, pay_schedule text, is_active boolean default true);
    create table payment_method_components(id uuid primary key default gen_random_uuid(), company_id uuid, payment_method_id uuid references payment_methods on delete cascade, payment_field_id uuid not null references payment_fields, component_code text, component_type text, label text, pay_schedule text, sort_order integer, is_active boolean);
    create table field_executive_provider_mappings(id uuid primary key default gen_random_uuid(), company_id uuid, payment_method_id uuid references payment_methods, payment_values jsonb);
    insert into payment_fields values ('${delivery}','${company}','DELIVERY','production','Delivery',null,true),('${returned}','${company}','CRETURN','production','Customer return',null,true),('${foreign}','${other}','OTHER','amount','Other','per_day',true);
  `);
  await db.exec(migration);
  return db;
}
const save = async (db, { id = null, tenant = company, code = 'PER_PACKET', name = 'Per packet', fields = [delivery, returned] } = {}) =>
  (await db.query('select workforce_save_payment_method($1,$2,$3,$4,$5::uuid[]) as id', [tenant, id, code, name, fields])).rows[0].id;

test('transactional create/update uses shared catalog IDs and rejects cross-tenant fields', async () => {
  const db = await database();
  try {
    const id = await save(db);
    const rows = (await db.query('select * from payment_method_components where payment_method_id=$1 order by component_code', [id])).rows;
    assert.deepEqual(rows.map((r) => r.component_code), ['CRETURN', 'DELIVERY']);
    assert.ok(rows.every((r) => r.company_id === company && r.payment_field_id));
    await save(db, { id, fields: [delivery], name: 'Delivery only' });
    assert.equal((await db.query('select count(*)::int n from payment_method_components')).rows[0].n, 1);
    await assert.rejects(save(db, { code: 'BAD', fields: [foreign] }), /unavailable for this company/);
    await assert.rejects(save(db, { id, tenant: other }), /not found for this company/);
    await assert.rejects(save(db, { code: 'EMPTY', fields: [] }), /Select between/);
    assert.equal((await db.query('select count(*)::int n from payment_methods')).rows[0].n, 1);
  } finally { await db.close(); }
});

test('in-use methods retain codes, components and mapped payment values', async () => {
  const db = await database();
  try {
    const id = await save(db);
    await db.query('insert into field_executive_provider_mappings(company_id,payment_method_id,payment_values) values($1,$2,$3)', [company,id,JSON.stringify({DELIVERY:17,CRETURN:14})]);
    const before = (await db.query('select * from payment_method_components order by id')).rows;
    await save(db, { id, name: 'Renamed method' });
    await assert.rejects(save(db, { id, code: 'CHANGED' }), /in use/);
    await assert.rejects(save(db, { id, fields: [delivery] }), /in use/);
    await assert.rejects(db.query('select workforce_delete_payment_method($1,$2)', [company,id]), /in use/);
    assert.deepEqual((await db.query('select * from payment_method_components order by id')).rows, before);
    assert.deepEqual((await db.query('select payment_values from field_executive_provider_mappings')).rows[0].payment_values, {DELIVERY:17,CRETURN:14});
  } finally { await db.close(); }
});

test('component failure rolls back the whole create; deleting unused method is tenant scoped', async () => {
  const db = await database();
  try {
    await db.exec("alter table payment_method_components add constraint simulated_failure check (component_code <> 'CRETURN')");
    await assert.rejects(save(db), /simulated_failure/);
    assert.equal((await db.query('select count(*)::int n from payment_methods')).rows[0].n, 0);
    const id = await save(db, { fields: [delivery] });
    await assert.rejects(db.query('select workforce_delete_payment_method($1,$2)', [other,id]), /not found/);
    await db.query('select workforce_delete_payment_method($1,$2)', [company,id]);
    assert.equal((await db.query('select count(*)::int n from payment_methods')).rows[0].n, 0);
  } finally { await db.close(); }
});

test('only server service role can execute mutations', async () => {
  const db = await database();
  try {
    for (const role of ['anon', 'authenticated']) {
      const result = await db.query("select has_function_privilege($1,'public.workforce_save_payment_method(uuid,uuid,text,text,uuid[])','execute') allowed", [role]);
      assert.equal(result.rows[0].allowed, false);
    }
  } finally { await db.close(); }
});

test('native route and permissions reuse the same mapping master, without changing earnings rules', () => {
  const middleware = read('src/middleware.ts');
  assert.match(middleware, /WORKFORCE_EXACT_PATHS[^;]+\/master\/payment-methods/);
  assert.doesNotMatch(middleware.match(/const MOVED_FINANCE_PATHS[^;]+/)[0], /payment-methods/);
  assert.match(read('src/lib/access-surface.ts').split('export const workforceAccessPageCodes')[1].split('] as const')[0], /payment_methods/);
  assert.match(read('src/lib/app-navigation.ts').split('export const workforceNavItems')[1], /Payment Methods.*\/master\/payment-methods/);
  assert.match(read('src/components/provider-mapping-page-content.tsx'), /from\("payment_methods"\)/);
  const actions = read('src/app/master/payment-methods/actions.ts');
  assert.match(actions, /requirePagePermission\("payment_methods", editing \? "edit" : "add"\)/);
  assert.match(actions, /requireCompanyId\(authorization\)/);
  assert.match(read('src/lib/authorization.ts'), /preview_read_only/);
});
