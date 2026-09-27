import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql=readFileSync(new URL("../supabase/migrations/20260927101500_workforce_referral_lifecycle.sql",import.meta.url),"utf8");

test("referral rules are company masters and partner neutral",()=>{
  assert.match(sql,/create table if not exists public\.workforce_referral_qualification_sources/);
  assert.match(sql,/\('delivery_days','Delivery activity days','delivery_activity'/);
  assert.match(sql,/where qualification_source='amazon_delivery_days'/);
  assert.match(sql,/workforce_referral_program_source_guard/);
});

test("delivery workforce roles receive configurable DropX One access",()=>{
  assert.match(sql,/upper\(designation\.code\) in \('DA','DCD','ODCD'\)/);
  assert.match(sql,/array\['refer_earn'\]/);
});

test("the referral journey links registration, evidence and paid payroll",()=>{
  assert.match(sql,/create trigger workforce_link_open_referral/);
  assert.match(sql,/create or replace function public\.workforce_refresh_referral/);
  assert.match(sql,/public\.cps_shipment_daily/);
  assert.match(sql,/create trigger workforce_referral_payment_sync/);
  assert.match(sql,/set status='paid',paid_at=/);
});
