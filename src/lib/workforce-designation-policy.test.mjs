import test from 'node:test';
import assert from 'node:assert/strict';
import {workforceDesignationPredicate} from './workforce-designation-policy.ts';
const eligible=workforceDesignationPredicate([
 {id:'da',code:'DA',name:'Delivery Associate',category:{people_module:'delivery_network'}},
 {id:'blank-code',code:null,name:'Driver',category:[{people_module:'delivery_network'}]},
 {id:'hr',code:'HR',name:'People',category:{people_module:'people'}}
]);
test('canonical designation wins over renamed or stale text',()=>{
 assert.equal(eligible({designation_id:'da',designation:'Renamed role'}),true);
 assert.equal(eligible({designation_id:'hr',designation:'DA'}),false);
 assert.equal(eligible({designation_id:'unknown',designation:'DA'}),false);
});
test('legacy fallback accepts only nonblank master code/name',()=>{
 assert.equal(eligible({designation:' da '}),true);
 assert.equal(eligible({designation:'delivery associate'}),true);
 for(const designation of [null,undefined,'','  ','null','People'])assert.equal(eligible({designation}),false);
});
