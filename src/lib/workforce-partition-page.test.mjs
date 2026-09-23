import test from 'node:test';import assert from 'node:assert/strict';
import {workforcePartitionPage} from './workforce-partition-page.ts';
test('identity partitions retain global pagination, stable order and counts without oversized requests',async()=>{
 const partitions=[{column:'workforce_id',ids:['A']},{column:'field_executive_id',ids:['B']}];
 const data=Array.from({length:370},(_,i)=>({id:String(i).padStart(5,'0'),punch_date:'2026-09-22',part:i%2}));
 const calls=[];const loader=async(p,from,to)=>{calls.push({from,to});const rows=data.filter(r=>r.part===(p.ids[0]==='A'?0:1));return {rows:rows.slice(from,to+1),total:rows.length};};
 const page=await workforcePartitionPage(partitions,2,loader);
 assert.equal(page.total,370);assert.equal(page.hasMore,true);assert.deepEqual(page.rows.map(r=>r.id),data.slice(200,300).map(r=>r.id));assert.ok(calls.every(c=>c.to-c.from===99));
 const last=await workforcePartitionPage(partitions,3,loader);assert.equal(last.rows.length,70);assert.equal(last.hasMore,false);
 assert.equal((await workforcePartitionPage([],0,loader)).total,0);
});
