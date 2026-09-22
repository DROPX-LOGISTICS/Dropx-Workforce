import test from 'node:test';
import assert from 'node:assert/strict';
import {stageMappingImport,mappingRate} from './provider-mapping-bulk.ts';
const rows=[{dropxId:'DA01',providerMemberId:'00001234',paymentMethodId:'method1',effectiveFrom:'2026-09-01',effectiveTo:'',paymentValues:{DELIVERY:'17',CRETURN:'0'}}];
const methods=[{id:'method1',code:'PACKET',components:[{code:'DELIVERY',label:'Delivery'},{code:'CRETURN',label:'C-return'}]}];
const record={'DropX ID':'DA01','Provider ID':'00001234','Payment method code':'PACKET','Effective from':'2026-09-01','Effective to':'','RATE_DELIVERY':'18','RATE_CRETURN':'0'};
const allowed=new Set(['DA01']);
test('bulk mapping stages values without mutating source and preserves ID leading zeros',()=>{
 const result=stageMappingImport([record],rows,methods,allowed);
 assert.equal(result[0].providerMemberId,'00001234');assert.equal(result[0].paymentValues.DELIVERY,'18');assert.equal(rows[0].paymentValues.DELIVERY,'17');
});
test('bulk mapping fails closed for duplicates, unknown identities, station and method mismatch',()=>{
 assert.throws(()=>stageMappingImport([record,record],rows,methods,allowed),/duplicated/);
 assert.throws(()=>stageMappingImport([record],rows,methods,new Set()),/selected station/);
 assert.throws(()=>stageMappingImport([{...record,'DropX ID':'unknown'}],rows,methods,allowed),/selected station/);
 assert.throws(()=>stageMappingImport([{...record,'Payment method code':'unknown'}],rows,methods,allowed),/method code/);
});
test('bulk mapping validates all required rates and calendar dates',()=>{
 for(const value of ['','-1','NaN','Infinity','1e3','0.001','1000001'])assert.throws(()=>stageMappingImport([{...record,RATE_DELIVERY:value}],rows,methods,allowed),/decimals/);
 for(const date of ['2026-02-30','2026-13-01','22/09/2026'])assert.throws(()=>stageMappingImport([{...record,'Effective from':date}],rows,methods,allowed),/dates/);
 assert.throws(()=>stageMappingImport([{...record,'Effective to':'2026-08-31'}],rows,methods,allowed),/dates/);
});
test('personal payment stages cannot be overwritten by the bulk worksheet',()=>{
 assert.throws(()=>stageMappingImport([record],[{...rows[0],paymentValues:{...rows[0].paymentValues,DROPX_PERSONAL_TERMS:'1'}}],methods,allowed),/individual dated/);
});
test('rate display distinguishes missing from zero and supports legacy rate fields',()=>{
 assert.equal(mappingRate({},'DELIVERY'),'—');assert.equal(mappingRate({DELIVERY:0},'DELIVERY',17),'₹0');assert.equal(mappingRate({},'DELIVERY',17),'₹17');
});
