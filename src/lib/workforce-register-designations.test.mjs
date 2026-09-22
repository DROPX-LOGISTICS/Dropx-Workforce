import test from 'node:test';
import assert from 'node:assert/strict';
import { designationMatches, registerDesignationOptions, hasWorkforcePaymentIdentity } from './workforce-register-designations.ts';
import './workforce-workspace-navigation.test.mjs';
import './provider-mapping-bulk.test.mjs';

const master = [
  {id:'da',code:'DA',name:'Delivery Associate'},
  {id:'dcd',code:'DCD',name:'Driver cum DA'},
  {id:'odcd',code:'ODCD',name:'Own Van Driver cum DA'},
  {id:'sorter',code:'SRTR',name:'Sorter'},
];
test('canonical Workforce payment eligibility follows master classification, including vendor and worker imports', () => {
  const allowed = new Set(['odcd','da','sorter']);
  for (const source_profile_type of ['vendor','worker','canonical','contractor','field_executive']) {
    assert.ok(hasWorkforcePaymentIdentity({source_profile_type, designation_id:'odcd',dropx_id:'DF-test'},allowed));
    assert.equal(hasWorkforcePaymentIdentity({source_profile_type, designation_id:'people-hr',dropx_id:'DF-test'},allowed),false);
  }
  assert.equal(hasWorkforcePaymentIdentity({designation_id:'da',dropx_id:' '},allowed),false);
  assert.equal(hasWorkforcePaymentIdentity({designation_id:'da',dropx_id:null},allowed),false);
});
test('designation matches code or name, never another designation containing DA', () => {
  assert.ok(designationMatches(' delivery associate ', master[0]));
  assert.ok(designationMatches('da', master[0]));
  for(const value of ['Driver cum DA','Own Van Driver cum DA','PTDA','Part Time Delivery Associate']) {
    assert.equal(designationMatches(value, master[0]), false);
  }
});
test('switches retain empty master roles and preserve historical values', () => {
  const options = registerDesignationOptions(master,['DA','Delivery Associate','Own Van Driver cum DA','Legacy role']);
  assert.deepEqual(options.find(x=>x.id==='da').values,['DA','Delivery Associate']);
  assert.deepEqual(options.find(x=>x.id==='dcd').values,[]);
  assert.deepEqual(options.find(x=>x.id==='sorter').values,[]);
  assert.deepEqual(options.find(x=>x.id==='odcd').values,['Own Van Driver cum DA']);
  assert.deepEqual(options.find(x=>x.id==='legacy:Legacy role').values,['Legacy role']);
});
