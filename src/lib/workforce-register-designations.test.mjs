import test from 'node:test';
import assert from 'node:assert/strict';
import { designationMatches, registerDesignationOptions } from './workforce-register-designations.ts';

const master = [
  {id:'da',code:'DA',name:'Delivery Associate'},
  {id:'dcd',code:'DCD',name:'Driver cum DA'},
  {id:'odcd',code:'ODCD',name:'Own Van Driver cum DA'},
  {id:'sorter',code:'SRTR',name:'Sorter'},
];
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
