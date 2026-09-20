import test from 'node:test';import assert from 'node:assert/strict';import {managementRequest} from './management-query-retry.mjs';
test('read-only network and transient upstream failures have bounded retries',async()=>{
 let calls=0;const waits=[];
 const result=await managementRequest(async()=>{calls++;if(calls===1)throw new TypeError('fetch failed');return new Response('',{status:calls===2?503:200});},{readOnly:true,pause:async ms=>waits.push(ms)});
 assert.equal(result.status,200);assert.equal(calls,3);assert.deepEqual(waits,[1000,2000]);
 let failures=0;await assert.rejects(managementRequest(async()=>{failures++;throw new Error('unavailable');},{readOnly:true,pause:async()=>{}}),/unavailable/);assert.equal(failures,4);
});
test('uncertain writes and permanent read failures are never replayed',async()=>{
 let calls=0;await assert.rejects(managementRequest(async()=>{calls++;throw new Error('uncertain');}),/uncertain/);assert.equal(calls,1);
 for(const readOnly of [false,true]){calls=0;await managementRequest(async()=>{calls++;return new Response('',{status:readOnly?403:503});},{readOnly,pause:async()=>{}});assert.equal(calls,1);}
});
