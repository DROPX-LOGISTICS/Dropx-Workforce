import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRecordedExitChecks,recordedExitBlockers} from './workforce-exit-recorded-checks.ts';
const empty={payroll_items:0,unreconciled_payroll:0,unposted_adjustments:0,unreconciled_posted_adjustments:0,active_holds:0,unsettled_windows:0};
test('no payroll cannot certify zero dues',()=>assert.match(recordedExitBlockers(parseRecordedExitChecks(empty))[0],/does not prove no dues/));
test('each historical blocker is explicit even with a paid final period',()=>{
 for(const key of Object.keys(empty).filter(k=>k!=='payroll_items')){
  const blockers=recordedExitBlockers(parseRecordedExitChecks({...empty,payroll_items:2,[key]:1}));
  assert.equal(blockers.length,1);assert.match(blockers[0],/^1 · /);
 }
 assert.deepEqual(recordedExitBlockers(parseRecordedExitChecks({...empty,payroll_items:2})),[]);
});
test('missing, malformed or contradictory evidence fails closed',()=>{
 for(const value of [null,[],{}, {...empty,active_holds:null},{...empty,active_holds:'0'},{...empty,unposted_adjustments:-1},{...empty,unsettled_windows:0.5},{...empty,payroll_items:NaN},{...empty,unreconciled_payroll:1}])assert.throws(()=>parseRecordedExitChecks(value));
});
test('the public counts contract cannot leak extra underlying fields',()=>assert.deepEqual(parseRecordedExitChecks({...empty,private_note:'not public'}),empty));
