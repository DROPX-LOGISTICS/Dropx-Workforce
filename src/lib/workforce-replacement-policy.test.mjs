import test from 'node:test';
import assert from 'node:assert/strict';
import {replacementAuthorized,replacementFilters,replacementSources} from './workforce-replacement-policy.ts';
test('replacement credential fails closed; requires exact dedicated bearer',()=>{
  const token='x'.repeat(64);
  for(const header of [null,'','Bearer wrong','Basic '+token,'Bearer '+token+'x'])assert.equal(replacementAuthorized(header,token),false);
  assert.equal(replacementAuthorized('Bearer '+token,undefined),false);
  assert.equal(replacementAuthorized('Bearer '+token,token),true);
});
test('filters reject invalid pages and dates; tenant and table are not caller input',()=>{
  for(const data of [{page:'-1'},{page:'Infinity'},{page:'1.5'},{from:'2026-02-30'},{from:'2026-09-25',to:'2026-09-24'},{station:'a,b'}])assert.throws(()=>replacementFilters(new URLSearchParams(data)));
  const result=replacementFilters(new URLSearchParams({company:'other',table:'auth.users',page:'2',from:'2026-09-22'}));
  assert.equal(result.page,2);assert.equal(result.company,undefined);assert.equal(result.table,undefined);
});
test('source allowlist omits authentication material, banking details and document paths',()=>{
  for(const source of Object.values(replacementSources)){
    assert.ok(!source.select.includes('*'));
    assert.doesNotMatch(source.select,/password|token|secret|bank_account|aadhaar|pan_number|storage_path|document_path/);
    assert.doesNotMatch(source.table,/sessions|login|connections/);
  }
});
