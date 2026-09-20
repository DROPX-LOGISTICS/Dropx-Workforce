import assert from 'node:assert/strict';import test from 'node:test';
import {assertFinalPayrollMatches} from './workforce-exit-reconciliation.ts';
const live={sourceType:'shipment',sourceId:'source-1',workDate:'2026-09-02',baseAmount:500,incentiveAmount:20,adjustmentAmount:0,netAmount:520,status:'ready'};
const frozen={source_type:'shipment',source_id:'source-1',work_date:'2026-09-02',base_amount:'500.00',incentive_amount:'20.00',adjustment_amount:'0',net_amount:'520.00'};
test('final snapshot matches independently of row order or numeric representation',()=>{assertFinalPayrollMatches([live],[frozen]);assertFinalPayrollMatches([live,{...live,sourceId:'s2'}],[{...frozen,source_id:'s2'},frozen]);});
test('late imports, rate changes, deductions and missing sources stop exit completion',()=>{
  for(const changes of [{sourceId:'new'},{netAmount:519},{baseAmount:499},{adjustmentAmount:-1},{workDate:'2026-09-03'}])assert.throws(()=>assertFinalPayrollMatches([{...live,...changes}],[frozen]),/Earnings changed/);
  assert.throws(()=>assertFinalPayrollMatches([live,live],[frozen]),/Earnings changed/);
  assert.throws(()=>assertFinalPayrollMatches([],[frozen]),/verified/);
  assert.throws(()=>assertFinalPayrollMatches([{...live,status:'hold'}],[frozen]),/hold/);
  assert.throws(()=>assertFinalPayrollMatches([{...live,netAmount:NaN}],[frozen]),/Invalid/);
});
