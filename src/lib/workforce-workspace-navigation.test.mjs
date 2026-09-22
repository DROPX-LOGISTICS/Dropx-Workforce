import test from 'node:test';
import assert from 'node:assert/strict';
import {workforceNavItems} from './app-navigation.ts';
import {workspaceDestination,activeWorkspace} from './workforce-workspace-navigation.ts';
import {workforceRegisterViewMatches} from './workforce-register-views.ts';

test('each operational tool remains reachable with one sidebar destination per workspace',()=>{
 assert.equal(workforceNavItems.length,7);
 const links=workforceNavItems.flatMap(x=>x.children??[x]);
 for(const path of ['/delivery-network/lifecycle','/delivery-network/rate-mapping','/delivery-network/id-onboarding','/delivery-network/activity','/delivery-network/payroll','/delivery-network/payout-review','/delivery-network/training-policies','/settings/amazon-onboarding'])assert.ok(links.some(x=>x.href===path),path);
 assert.equal(links.filter(x=>x.href?.startsWith('/delivery-network/reports')).length,1);
});
test('restricted roles land on an allowed child, never a hardcoded register',()=>{
 const group={...workforceNavItems[1],children:[{code:'provider_mapping',label:'ID & Rate Mapping',href:'/delivery-network/rate-mapping',secondary:true}]};
 assert.equal(workspaceDestination(group),'/delivery-network/rate-mapping');
 assert.equal(workspaceDestination({...group,children:[]}),undefined);
});
test('longest route chooses profile workspace and does not mark overview active',()=>{
 assert.equal(activeWorkspace(workforceNavItems,'/delivery-network/lifecycle','Associate profile')?.label,'Associates');
 assert.equal(activeWorkspace(workforceNavItems,'/delivery-network/onboarding/associates','Edit')?.label,'Associates');
 assert.equal(activeWorkspace(workforceNavItems,'/delivery-network/communications/history','History')?.label,'Connect');
 assert.equal(activeWorkspace(workforceNavItems,'/delivery-network/earnings','Live Earnings')?.label,'Payments');
 assert.equal(activeWorkspace(workforceNavItems,'/delivery-network/payment-holds','Holds')?.label,'Payments');
});
test('lifecycle views form non-overlapping buckets; training optional; archive retained',()=>{
 const views=['active','joining','training','offboarded','closed'];
 for(const stage of ['applicant','awaiting_arrival','training','awaiting_activation','ready','active','offboarded','closed']) {
  assert.equal(views.filter(view=>workforceRegisterViewMatches(view,stage,'Approved')).length,1,stage);
  assert.ok(workforceRegisterViewMatches('all',stage,'Approved'));
 }
 assert.ok(workforceRegisterViewMatches('joining','awaiting_activation','Approved'));
 assert.equal(workforceRegisterViewMatches('training','awaiting_activation','Approved'),false);
 assert.ok(workforceRegisterViewMatches('approved','ready','Approved'));
});
