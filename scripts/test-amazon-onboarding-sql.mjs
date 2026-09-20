import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export async function testAmazonOnboardingSql(db) {
  // Isolated Vault stand-in, not encryption verification and never production data.
  await db.exec(`create schema vault;
    create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text);
    create view vault.decrypted_secrets as select id,secret as decrypted_secret from vault.secrets;
    create function vault.create_secret(value text) returns uuid language plpgsql as $$ declare k uuid; begin insert into vault.secrets(secret) values(value) returning id into k; return k; end $$;
    create function vault.update_secret(k uuid,value text) returns void language sql as $$ update vault.secrets set secret=value where id=k $$;
  `);
  await db.exec(readFileSync(new URL('../supabase/migrations/20260920200119_workforce_amazon_observations.sql',import.meta.url),'utf8'));
  const u=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const company=u(1),actor=u(2),worker=u(101),profile='amzn1.flex.provider.v1.'+u(501);
  const save=(version,password='synthetic-password',email='synthetic@example.invalid',enabled=true)=>db.query('select workforce_save_amazon_connection($1,$2,$3,$4,$5,$6,$7)',[company,actor,email,password,enabled,version,false]);
  const claim=async()=> (await db.query('select workforce_claim_amazon_sync($1) token',[company])).rows[0].token;
  const finish=(token,rows=[],status='ok')=>db.query('select workforce_finish_amazon_sync($1,$2,$3,$4,$5)',[company,token,status,rows,0]);
  assert.equal(await claim(),null);
  await assert.rejects(save(0,null),/password/);
  await save(0);
  await assert.rejects(save(0),/changed/);
  let token=await claim();assert.ok(token);assert.equal(await claim(),null);
  const secret=(await db.query('select workforce_read_amazon_connection($1,$2) data',[company,token])).rows[0].data;
  assert.equal(secret.password,'synthetic-password');assert.equal(secret.login_requested,true);
  await db.query('select workforce_store_amazon_session($1,$2,$3)',[company,token,'synthetic-cookie']);
  await assert.rejects(finish(u(999)),/lease/);
  await db.query('update workforce_joining_plans set provider_profile_id=$1 where workforce_id=$2',[profile,worker]);
  const row={workforce_id:worker,provider_profile_id:profile,progress:'6% · Invitation',provider_status:'DA: Accept invitation'};
  await assert.rejects(finish(token,[{...row,provider_profile_id:'wrong'}]),/link changed/);
  await assert.rejects(finish(token,[row],'unavailable'),/Incomplete scans/);
  await finish(token,[row]);
  const originalPlan=(await db.query('select version,provider_stage from workforce_joining_plans where workforce_id=$1',[worker])).rows[0];
  assert.equal((await db.query('select count(*)::int n from workforce_amazon_observation_events')).rows[0].n,1);
  await db.query("update workforce_amazon_sync_state set last_attempt_at=now()-interval '6 minutes'");
  token=await claim();await finish(token,[row]);
  assert.equal((await db.query('select count(*)::int n from workforce_amazon_observation_events')).rows[0].n,1);
  await db.query("update workforce_amazon_sync_state set last_attempt_at=now()-interval '6 minutes'");
  token=await claim();await finish(token,[],'login_required');
  assert.equal((await db.query('select count(*)::int n from workforce_amazon_observations')).rows[0].n,1);
  assert.deepEqual((await db.query('select version,provider_stage from workforce_joining_plans where workforce_id=$1',[worker])).rows[0],originalPlan);
  await save(1,null);await assert.rejects(save(2,null,'different@example.invalid'),/password/);
  token=await claim();await save(2,'replacement');await assert.rejects(finish(token),/lease/);
  assert.equal((await db.query('select session_secret_id from workforce_amazon_connections')).rows[0].session_secret_id,null);
  await save(3,null,'synthetic@example.invalid',false);assert.equal(await claim(),null);
  for(const role of ['anon','authenticated']) {
    assert.equal((await db.query("select count(*)::int n from pg_proc where proname like 'workforce_%amazon%' and has_function_privilege($1,oid,'EXECUTE')",[role])).rows[0].n,0);
    for(const table of ['workforce_amazon_connections','workforce_amazon_connection_events','workforce_amazon_sync_state','workforce_amazon_observations','workforce_amazon_observation_events']) assert.equal((await db.query('select has_table_privilege($1,$2,\'SELECT\') allowed',[role,table])).rows[0].allowed,false);
  }
  console.log('PASS: Amazon encrypted-storage contract, owner versioning, pause, lease fencing, no fuzzy links, no partial publish, idempotent history, preserve last evidence on failure, no pay/stage mutation, server-only privileges.');
}
