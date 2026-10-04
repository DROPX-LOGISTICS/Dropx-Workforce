import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration=readFileSync(new URL('../supabase/migrations/20261004170540_isolate_amazon_email_pilot_candidates.sql',import.meta.url),'utf8').toLowerCase();
const actions=readFileSync(new URL('../src/app/delivery-network/amazon-pilot/actions.ts',import.meta.url),'utf8');
const page=readFileSync(new URL('../src/app/delivery-network/amazon-pilot/page.tsx',import.meta.url),'utf8');

test('new Amazon email pilots use an isolated candidate registry',()=>{
 assert.match(migration,/create table public\.workforce_amazon_email_pilot_candidates/);
 const createFunction=migration.match(/create function public\.workforce_create_isolated_amazon_email_pilot[\s\S]*?revoke all on function public\.workforce_create_isolated_amazon_email_pilot/)?.[0]??'';
 assert.ok(createFunction);
 assert.doesNotMatch(createFunction,/insert into public\.workforce\s*\(/);
 assert.match(createFunction,/duplicate_identity_detected/);
});

test('the shared worker queue accepts exactly one canonical or beta subject',()=>{
 assert.match(migration,/num_nonnulls\(workforce_id,email_pilot_candidate_id\)=1/);
 assert.match(migration,/workforce_queue_isolated_amazon_email_pilot/);
 assert.match(migration,/email_pilot_candidate_id=p_candidate/);
});

test('Workforce UI creates and reads only isolated pilot candidates',()=>{
 assert.match(actions,/workforce_create_isolated_amazon_email_pilot/);
 assert.doesNotMatch(actions,/workforce_create_amazon_alias_pilot/);
 assert.match(page,/from\('workforce_amazon_email_pilot_candidates'\)/);
 assert.doesNotMatch(page,/from\('workforce_amazon_pilots'\)/);
});
