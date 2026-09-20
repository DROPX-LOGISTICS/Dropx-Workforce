import test from 'node:test';
import assert from 'node:assert/strict';
import {previewPooledPay as preview} from './workforce-pooled-pay.ts';
const terms={mode:'guarantee_plus_excess',dailyGuarantee:800,packagesPerDay:45,packageRate:12,fuelPerKm:0};
const day=(date,packages,verifiedKm=0)=>({date,packages,verifiedKm});
const input={from:'2026-09-01',to:'2026-09-30',asOf:'2026-10-01',complete:true,terms,days:[day('2026-09-01',10),day('2026-09-02',60)]};
test('pools low and high days rather than paying excess each day',()=>{
  const r=preview(input);assert.equal(r.workDays,2);assert.equal(r.averagePackages,35);assert.equal(r.packageAllowance,90);
  assert.equal(r.totalAmount,1600);assert.equal(r.dailyComparisonAmount,1780);assert.equal(r.comparisonDifference,180);
  assert.equal(r.windowComplete,true);assert.equal(r.payrollEnabled,false);
});
test('uses qualifying worked days, not all calendar days, for pooled threshold',()=>{
  const r=preview({...input,days:[day('2026-09-01',10),day('2026-09-02',100)]});
  assert.equal(r.calendarDays,30);assert.equal(r.excessPackages,20);assert.equal(r.supplementAmount,240);assert.equal(r.totalAmount,1840);
});
test('pooled floor and guarantee plus excess are distinct contracts',()=>{
  const days=[day('2026-09-01',100),day('2026-09-02',100)];
  assert.equal(preview({...input,days}).totalAmount,2920);
  const floor=preview({...input,days,terms:{...terms,mode:'pooled_floor'}});
  assert.equal(floor.variableAmount,2400);assert.equal(floor.supplementAmount,800);assert.equal(floor.totalAmount,2400);
});
test('verified kilometres are not inferred from packages and round per day to paise',()=>{
  const r=preview({...input,terms:{...terms,fuelPerKm:2.75},days:[day('2026-09-01',10,12.34),day('2026-09-02',60,20)]});
  assert.equal(r.verifiedKm,32.34);assert.equal(r.fuelAmount,88.94);assert.equal(r.totalAmount,1688.94);
  assert.equal(r.days[0].fuelAmount,33.94);
});
test('zero deliveries on an explicitly qualifying day retain its guarantee; no rows create no pay',()=>{
  assert.equal(preview({...input,days:[day('2026-09-01',0)]}).totalAmount,800);
  assert.equal(preview({...input,days:[]}).totalAmount,0);
});
test('open and unconfirmed windows are provisional including last day',()=>{
  assert.equal(preview({...input,asOf:'2026-09-30'}).windowComplete,false);
  assert.equal(preview({...input,complete:false}).windowComplete,false);
  assert.equal(preview({...input,asOf:'2026-09-02',complete:false}).incompleteReasons.length,2);
});
test('duplicate dates and out-of-window or future work fail closed',()=>{
  for(const days of [[day('2026-09-01',10),day('2026-09-01',50)],[day('2026-08-31',10)],[day('2026-10-01',10)]])assert.throws(()=>preview({...input,days}));
  assert.throws(()=>preview({...input,asOf:'2026-09-01'}));
});
test('invalid dates, inverted or excessive windows and unsupported modes fail',()=>{
  for(const patch of [{from:'2026-02-30'},{to:'2026-08-01'},{to:'2027-01-01'},{asOf:'invalid'},{terms:{...terms,mode:'daily'}}])assert.throws(()=>preview({...input,...patch}));
  assert.equal(preview({...input,from:'2024-02-29',to:'2024-02-29',asOf:'2024-03-01',days:[day('2024-02-29',10)]}).workDays,1);
});
test('negative, fractional-count, excessive-precision and non-finite values are rejected',()=>{
  for(const packages of [-1,1.5,Infinity,NaN,100001])assert.throws(()=>preview({...input,days:[day('2026-09-01',packages)]}));
  for(const fuelPerKm of [-1,1.001,Infinity])assert.throws(()=>preview({...input,terms:{...terms,fuelPerKm}}));
  assert.throws(()=>preview({...input,terms:{...terms,dailyGuarantee:0}}));
  assert.throws(()=>preview({...input,days:[day('2026-09-01',10,1.001)]}));
});
test('input ordering cannot change totals and caller data is not mutated',()=>{
  const source=structuredClone(input),reversed={...input,days:[...input.days].reverse()};
  assert.deepEqual(preview(input),preview(reversed));assert.deepEqual(input,source);
});
