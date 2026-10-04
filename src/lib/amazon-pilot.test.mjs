import test from 'node:test';
import assert from 'node:assert/strict';
import {pilotStatus,withLiveAmazonEvidence} from './amazon-pilot.ts';
const now=Date.parse('2026-10-02T12:00:00Z');
const status=(evidence={},extra={})=>pilotStatus({evidence,trial_completed_at:null,closed_at:null,...extra},now);
test('invitation does not imply registration or BGC completion',()=>{
 assert.equal(status({invitationStatus:'queued'}).stage,'invitation_pending');
 const p=status({invitationStatus:'sent',providerId:'provider'});assert.equal(p.stage,'registration_pending');
});
test('registration has no internal training or readiness gate',()=>{const p=status({providerId:'p'});assert.equal(p.stage,'registration_pending');assert.doesNotMatch(p.instruction,/trial|ready|training/i);assert.deepEqual(p,status({providerId:'p'},{trial_completed_at:'2026-10-02T10:00:00Z'}));});
test('actual DA registration pendency comes from report; vendor waits are distinct',()=>{
 assert.equal(status({providerId:'p',report:{categories:'9 - DA Pending Filling BGC details',action_item:'DA needs to complete filling BGC details'}}).stage,'registration_pending');
 assert.equal(status({providerId:'p',report:{categories:'10-DA Pending BGC clearance by BGC Vendor'}}).stage,'verification_pending');
 assert.equal(status({providerId:'p',report:{categories:'13-DA Pending Account Provisioning completion from Amazon'}}).stage,'verification_pending');
});
test('inactive and absent report never imply activation',()=>{assert.equal(status({providerId:'p',lscStatus:'INACTIVE'}).stage,'registration_pending');assert.equal(status({providerId:'p'}).stage,'registration_pending');});
test('a stale SCC record is not current package eligibility',()=>{assert.equal(status({providerId:'p',employeeId:'2001',sccAt:'2026-09-20T12:00:00Z'}).stage,'registration_pending');assert.equal(status({providerId:'p',employeeId:'2001',sccAt:'2026-10-02T10:00:00Z'}).stage,'scc_available');});
test('identity conflicts override apparent delivery activity',()=>assert.equal(status({conflict:true,employeeId:'2001',firstDelivery:'2026-10-02'}).stage,'exception'));
test('BGC failure remains actionable even if an old SCC match exists',()=>assert.equal(status({providerId:'p',employeeId:'2001',sccAt:'2026-10-02T10:00:00Z',report:{categories:'12-DA BGC Failed by BGC Vendor'}}).stage,'exception'));
test('report freshness is exposed to the associate',()=>assert.equal(status({reportDate:'2026-09-29'}).stale,true));
test('live invitation evidence replaces a stale queued snapshot immediately',()=>{
 const evidence=withLiveAmazonEvidence({invitationStatus:'queued',providerId:null},{status:'sent',external_reference:'amzn1.flex.provider.live',completed_at:'2026-10-04T11:46:18Z'},null);
 assert.equal(evidence.invitationStatus,'sent');
 assert.equal(evidence.providerId,'amzn1.flex.provider.live');
 assert.equal(status(evidence).stage,'registration_pending');
});

// Verify the invitation contract without sending real messages.
import {readFileSync} from 'node:fs';
import {amazonDriverWelcome,amazonDriverWelcomeMappings} from './amazon-driver-welcome.ts';
test('new arrival queues immediately and keeps the DropX ID distinct from the later LSC Driver ID',()=>{
 const action=readFileSync(new URL('../app/delivery-network/amazon-pilot/actions.ts',import.meta.url),'utf8');
 const page=readFileSync(new URL('../app/delivery-network/amazon-pilot/page.tsx',import.meta.url),'utf8');
 assert.match(action,/trial_days:0/);assert.match(action,/workforce_queue_amazon_pilot/);assert.match(action,/amazonDriverWelcome:true/);
 assert.equal(amazonDriverWelcomeMappings['body.2'],'dropx_id');assert.match(amazonDriverWelcome.components[0].text,/DropX ID: \{\{2\}\}/);
 assert.doesNotMatch(amazonDriverWelcome.components[0].text,/Emp(?:loyee)? ID|training|trial/);
 assert.match(page,/DropX ID: \{w\?\.dropx_id/);
 assert.doesNotMatch(page,/Driver ID: \{w\?\.dropx_id/);
});
