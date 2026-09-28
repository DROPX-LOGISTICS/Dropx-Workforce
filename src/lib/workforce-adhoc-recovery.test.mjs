import assert from 'node:assert/strict';
import test from 'node:test';
import {quoteAdhocDayRecovery} from './workforce-adhoc-recovery.ts';
import {calculateWorkforceEarnings} from './workforce-earnings.ts';

function context() {
 return {requestId:'request',companyId:'company',stationId:'station',stationCode:'KGQA',providerMemberId:'DA1',deploymentDate:'2026-09-26',hash:'hash',input:{
  from:'2026-09-26',to:'2026-09-26',adjustments:[],campaigns:[],rateCards:[],
  providers:[{id:'amazon',code:'AMAZON',name:'Amazon'}],stations:[{id:'station',station_code:'KGQA'}],
  workforce:[{id:'worker',full_name:'DA',dropx_id:'D1',designation_id:'da',location_id:'station',source_profile_type:'workforce',source_profile_id:'worker',onboarding_status:'active',is_active:true,bank_account_no:'test',ifsc_code:'test'}],
  mappings:[{id:'mapping',provider_id:'amazon',provider_member_id:'DA1',station_id:'station',workforce_id:'worker',effective_from:'2026-09-01',effective_to:null,status:'active',pay_type:'PER_PACKET',payment_values:{DELIVERY:10,CRETURN:5,SELLER_PICKUP:4,SLLLER_RETURN:3}}],
  shipments:[{id:'source',client:'Amazon',station_code:'KGQA',work_date:'2026-09-26',provider_employee_id:'DA1',amazon_delivery:30,swa_delivery:2,c_return:4,mfn:3,mfn_return:1,total_delivery:32,total_activity:40,da_total_pay:0}]
 }};
}
test('count recovery excludes only Amazon Delivery and C-return, source unchanged',()=>{
 const ctx=context(),original=structuredClone(ctx);const result=quoteAdhocDayRecovery(ctx);
 assert.equal(result.state,'applied');assert.equal(result.amount,320);assert.equal(result.mode,'count');
 assert.deepEqual(ctx,original);assert.equal(calculateWorkforceEarnings(ctx.input).totalBase,355);
});
test('missing mapping or late effective mapping remains pending without an exception',()=>{
 const ctx=context();ctx.input.mappings=[];assert.equal(quoteAdhocDayRecovery(ctx).state,'pending_mapping');
 const later=context();later.input.mappings[0].effective_from='2026-09-27';assert.equal(quoteAdhocDayRecovery(later).state,'pending_mapping');
});
test('mapping added later resolves the same day and ID',()=>{
 const ctx=context(),map=ctx.input.mappings;ctx.input.mappings=[];assert.equal(quoteAdhocDayRecovery(ctx).state,'pending_mapping');
 ctx.input.mappings=map;assert.equal(quoteAdhocDayRecovery(ctx).amount,320);
});
test('missing day, manual name without ID and missing source do not guess',()=>{
 const ctx=context();ctx.deploymentDate=null;assert.equal(quoteAdhocDayRecovery(ctx).state,'pending_date');
 ctx.deploymentDate='2026-09-26';ctx.providerMemberId=null;assert.equal(quoteAdhocDayRecovery(ctx).state,'pending_mapping');
 ctx.providerMemberId='DA1';ctx.input.shipments=[];assert.equal(quoteAdhocDayRecovery(ctx).state,'pending_source');
});
test('daily MG pays and deducts once across repeated source rows and provider IDs',()=>{
 const ctx=context();ctx.input.mappings[0].pay_type='MG_PER_DAY';ctx.input.mappings[0].payment_values={MG_PER_DAY:800};
 ctx.input.mappings.push({...ctx.input.mappings[0],id:'mapping2',provider_member_id:'DA2'});
 ctx.input.shipments.push({...ctx.input.shipments[0],id:'source2',provider_employee_id:'DA2'});
 assert.equal(calculateWorkforceEarnings(ctx.input).totalBase,800);
 assert.equal(quoteAdhocDayRecovery(ctx).amount,800);assert.equal(quoteAdhocDayRecovery(ctx).mode,'daily');
 ctx.providerMemberId='DA2';assert.equal(quoteAdhocDayRecovery(ctx).amount,800);
});
test('duplicate person mappings, station mismatch and other client stay unresolved',()=>{
 const ctx=context();ctx.input.mappings.push({...ctx.input.mappings[0],id:'bad',workforce_id:'someoneelse'});
 assert.equal(quoteAdhocDayRecovery(ctx).state,'pending_mapping');
 const station=context();station.stationId='other';assert.equal(quoteAdhocDayRecovery(station).state,'pending_source');
 const client=context();client.input.shipments[0].client='Other';assert.equal(quoteAdhocDayRecovery(client).state,'pending_source');
});
test('monthly and mixed schemes defer instead of silently applying a daily rate',()=>{
 for(const type of ['MG_PER_MONTH','PER_PACKET_VAN_RENT_PER_DAY']){const ctx=context();ctx.input.mappings[0].pay_type=type;assert.equal(quoteAdhocDayRecovery(ctx).state,'pending_rate');}
});
test('imported payout is not the deduction when component rates are known',()=>{
 const ctx=context();ctx.input.shipments[0].da_total_pay=500;assert.equal(quoteAdhocDayRecovery(ctx).amount,320);
 ctx.input.shipments[0].da_total_pay=100;assert.equal(quoteAdhocDayRecovery(ctx).state,'pending_rate');
});
test('configured zero activity produces no positive deduction',()=>{
 const ctx=context();ctx.input.shipments[0].amazon_delivery=0;ctx.input.shipments[0].c_return=0;
 assert.equal(quoteAdhocDayRecovery(ctx).state,'zero');assert.equal(quoteAdhocDayRecovery(ctx).amount,0);
});
