import test from 'node:test';
import assert from 'node:assert/strict';
import {workforceNavItems} from './app-navigation.ts';
import {workspaceDestination,activeWorkspace} from './workforce-workspace-navigation.ts';
import {workforceRegisterViewMatches} from './workforce-register-views.ts';

test('each operational tool remains reachable with one sidebar destination per workspace',()=>{
 assert.equal(workforceNavItems.length,10);
 assert.ok(workforceNavItems.find(x=>x.label==='Master')?.children?.some(x=>x.href==='/master/payment-methods'));
 const links=workforceNavItems.flatMap(x=>x.children??[x]);
 for(const path of ['/delivery-network/lifecycle','/delivery-network/rate-mapping','/delivery-network/id-onboarding','/delivery-network/activity','/delivery-network/payroll','/delivery-network/payout-review','/delivery-network/training-policies','/settings/amazon-onboarding'])assert.ok(links.some(x=>x.href===path),path);
 assert.equal(links.filter(x=>x.href?.startsWith('/delivery-network/reports')).length,1);
 assert.ok(workforceNavItems.find(x=>x.label==='IDs & rates')?.children?.some(x=>x.href==='/delivery-network/rate-mapping'));
 assert.ok(workforceNavItems.find(x=>x.label==='User access')?.children?.some(x=>x.href==='/users?section=roles'));
 assert.ok(links.some(x=>x.href==='/delivery-network/communications/whatsapp'));
 assert.ok(links.some(x=>x.href==='/delivery-network/onboarding/associates#bulk-upload'));
});
test('restricted roles land on an allowed child, never a hardcoded register',()=>{
 const group={...workforceNavItems[1],children:[{code:'provider_mapping',label:'ID & Rate Mapping',href:'/delivery-network/rate-mapping',secondary:true}]};
 assert.equal(workspaceDestination(group),'/delivery-network/rate-mapping');
 assert.equal(workspaceDestination({...group,children:[]}),undefined);
});
test('longest route chooses profile workspace and does not mark overview active',()=>{
 assert.equal(activeWorkspace(workforceNavItems,'/master/payment-methods','Payment Methods')?.label,'Master');
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

test('compact navigation preserves every authorized destination exactly once',async()=>{
 const {compactWorkspaces}=await import('./workforce-workspace-navigation.ts');
 const compact=compactWorkspaces(workforceNavItems);
 assert.equal(compact.length,6);
 const destinations=items=>items.flatMap(item=>item.children??[item]).map(item=>item.href).sort();
 assert.deepEqual(destinations(compact),destinations(workforceNavItems));
 for(const original of workforceNavItems) {
  const filtered=original.children?.map(child=>({...original,children:[child]}))??[original];
  for(const only of filtered) {
   const result=compactWorkspaces([only]);
   assert.deepEqual(destinations(result),destinations([only]));
   assert.equal(workspaceDestination(result[0]),workspaceDestination(only));
  }
 }
 assert.equal(activeWorkspace(compact,'/delivery-network/rate-cards','Rate Cards')?.label,'Associates');
 assert.equal(activeWorkspace(compact,'/delivery-network/payment-holds','Holds')?.label,'Pay & settlement');
 assert.equal(activeWorkspace(compact,'/users','User Roles')?.label,'Settings');
 assert.equal(activeWorkspace(compact,'/delivery-network/onboarding/associates','Bulk upload')?.label,'Associates');
});

test('lifecycle count links preserve the exact stage rather than merging joining queues',async()=>{
 const {registerStageHref,validRegisterStage}=await import('./workforce-register-views.ts');
 for(const stage of ['applicant','awaiting_arrival','training','awaiting_activation','ready','active','offboarded','closed']) {
  const url=new URL(registerStageHref(stage),'https://workforce.example');
  assert.equal(url.searchParams.get('stage'),stage);
  assert.equal(validRegisterStage(stage),stage);
  assert.ok(workforceRegisterViewMatches(url.searchParams.get('view'),stage,'Approved'));
 }
 assert.equal(validRegisterStage('__proto__'),undefined);
 assert.equal(validRegisterStage('unknown'),undefined);
});

test('tab selection distinguishes query-based roles and tolerates page filters and bulk anchors',async()=>{
 const {workspaceLinkActive}=await import('./workforce-workspace-navigation.ts');
 assert.ok(workspaceLinkActive('/delivery-network/payroll','/delivery-network/payroll','status=draft'));
 assert.ok(workspaceLinkActive('/users?section=roles','/users','section=roles'));
 assert.equal(workspaceLinkActive('/users?section=users','/users','section=roles'),false);
 assert.ok(workspaceLinkActive('/delivery-network/onboarding/associates#bulk-upload','/delivery-network/onboarding/associates',''));
 assert.equal(workspaceLinkActive('/delivery-network','/delivery-network/associates',''),false);
});
