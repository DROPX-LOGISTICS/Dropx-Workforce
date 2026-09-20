import test from 'node:test';
import assert from 'node:assert/strict';
import {payrollCalendarPeriod as period} from './workforce-payroll-calendar.ts';
const calendar={cadence:'weekly',interval_days:null,anchor_date:'2026-09-01'};
test('weekly calendar stays anchored across month boundaries',()=>assert.deepEqual(period(calendar,'2026-10-01'),{from:'2026-09-29',to:'2026-10-05'}));
test('daily and rolling 15 day calendars use inclusive bounds',()=>{assert.deepEqual(period({...calendar,cadence:'daily'},'2026-09-09'),{from:'2026-09-09',to:'2026-09-09'});assert.deepEqual(period({...calendar,cadence:'fifteen_days'},'2026-09-16'),{from:'2026-09-16',to:'2026-09-30'});});
test('monthly handles leap years and December',()=>{assert.deepEqual(period({...calendar,cadence:'monthly',anchor_date:'2024-01-01'},'2024-02-10'),{from:'2024-02-01',to:'2024-02-29'});assert.deepEqual(period({...calendar,cadence:'monthly'},'2026-12-20'),{from:'2026-12-01',to:'2026-12-31'});});
test('custom interval and invalid configuration fail safely',()=>{assert.deepEqual(period({...calendar,cadence:'custom',interval_days:10},'2026-09-12'),{from:'2026-09-11',to:'2026-09-20'});for(const value of [null,0,94,1.5])assert.throws(()=>period({...calendar,cadence:'custom',interval_days:value},'2026-09-12'));assert.throws(()=>period(calendar,'2026-08-31'));assert.throws(()=>period(calendar,'2026-02-30'));});
