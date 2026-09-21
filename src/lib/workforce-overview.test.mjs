import test from 'node:test';import assert from 'node:assert/strict';
import {workforceOverview} from './workforce-overview.ts';
const person=(id,changes={})=>({id,location_id:'station',onboarding_status:'approved',lifecycle_status:'onboarding',is_active:false,...changes});
const plan=(id,changes={})=>({workforce_id:id,station_id:'station',mode:'training',eligible_from:'2026-09-01',terms_accepted_on:'2026-09-01',training_completed_on:null,closed_on:null,...changes});
const mapping=(id,changes={})=>({id:'map-'+id,workforce_id:id,provider_member_id:'provider-'+id,station_id:'station',effective_from:'2026-09-01',effective_to:null,status:'active',...changes});
const punch=(id,changes={})=>({id:'punch-'+id,workforce_id:id,punch_date:'2026-09-01',in_time:'2026-09-01T04:00:00Z',in_source:'biometric',punch_in_location_id:'station',...changes});
const overview=(profiles,plans=[],mappings=[],attendance=[])=>workforceOverview({profiles,plans,mappings,attendance},'2026-09-21');
test('all lifecycle states are visible, disjoint and sum to canonical total',()=>{
 const profiles=[person('applicant',{onboarding_status:'under_review'}),person('arrival'),person('training'),person('activation'),person('ready'),person('active',{is_active:true}),person('exited',{lifecycle_status:'offboarded'}),person('closed',{onboarding_status:'rejected'})];
 const result=overview(profiles,[plan('training'),plan('activation',{mode:'direct'})],[mapping('ready')],[punch('training')]);
 assert.equal(result.total,8);assert.ok(Object.values(result.counts).every(n=>n===1));assert.equal(result.underReview,1);assert.equal(result.needsRegistration,0);
});
test('five approved inactive profiles are not lost from total or relabelled as active',()=>{
 const profiles=Array.from({length:5},(_,n)=>person('arrival-'+n));const result=overview(profiles);
 assert.equal(result.total,5);assert.equal(result.counts.awaiting_arrival,5);assert.equal(result.counts.active,0);
});
test('returned documents need registration action, under-review stays separate',()=>{
 const result=overview([person('pending',{onboarding_status:'pending'}),person('returned',{onboarding_status:'returned'}),person('review',{onboarding_status:'under_review'})]);
 assert.equal(result.counts.applicant,3);assert.equal(result.needsRegistration,2);assert.equal(result.underReview,1);
});
test('approved active profiles remain active without inventing training when mapping is absent',()=>assert.equal(overview([person('active',{is_active:true,onboarding_status:'active'})]).counts.active,1));
test('flagged and wrong-station punches cannot create a training count',()=>{
 for(const changes of [{flagged:true},{punch_in_location_id:'another'}])assert.equal(overview([person('training')],[plan('training')],[],[punch('training',changes)]).counts.awaiting_arrival,1);
});
test('future mappings do not erase training; closed historical IDs never restart it',()=>{
 assert.equal(overview([person('training')],[plan('training')],[mapping('training',{effective_from:'2026-10-01'})],[punch('training')]).counts.training,1);
 assert.equal(overview([person('training')],[plan('training')],[mapping('training',{effective_to:'2026-09-02',status:'closed'})],[punch('training')]).counts.awaiting_activation,1);
});
test('empty permitted scope is genuinely empty, duplicate or foreign profile plans fail',()=>{
 assert.equal(overview([]).total,0);assert.equal(Object.values(overview([]).counts).reduce((a,b)=>a+b),0);
 assert.throws(()=>overview([person('same'),person('same')]));assert.throws(()=>overview([person('p')],[plan('foreign')]));assert.throws(()=>overview([person('p')],[plan('p'),plan('p')]));
});
