type Mapping={payment_values?:Record<string,unknown>|null;effective_from?:string|null;effective_to?:string|null;provider_id?:string|null;station_id?:string|null;pay_type?:string|null};
const read=(values:Record<string,unknown>,key:string)=>{const number=Number(values[key]??0);if(!Number.isFinite(number)||number<0)throw new Error('Invalid individual payment terms. Contact Workforce.');return number;};
export function personalPaymentSource(mapping:Mapping){return String(mapping.payment_values?.DROPX_SOURCE_OF_TRUTH??'');}
export function personalDailyAmount(mapping:Mapping){const values=mapping.payment_values;if(Number(values?.DROPX_PERSONAL_TERMS)!==1||personalPaymentSource(mapping)!=='biometric_attendance')return null;return Object.entries(values||{}).filter(([key])=>!key.startsWith('DROPX_')).reduce((sum,[key])=>sum+read(values!,key),0);}
/** Individual terms are method-driven. The source master decides whether shipment rows may calculate them. */
export function personalPaymentCard(mapping:Mapping){
 const values=mapping.payment_values;if(Number(values?.DROPX_PERSONAL_TERMS)!==1)return null;
 const source=personalPaymentSource(mapping);if(source==='biometric_attendance')return null;
 if(source&&source!=='amazon_daily_shipment')return null;
 const delivery=read(values!,'DELIVERY'),returns=read(values!,'CRETURN'),mfn=read(values!,'SELLER_PICKUP'),mfnReturn=read(values!,'SLLLER_RETURN');
 const fixed=['MG_PER_DAY','DAILY_PAY','FIXED_DAILY'].map(key=>read(values!,key)).find(amount=>amount>0)??0;
 const hasActivity=[delivery,returns,mfn,mfnReturn].some(amount=>amount>0);
 const payType=fixed>0&&hasActivity?'hybrid' as const:fixed>0?'fixed_daily' as const:'per_shipment' as const;
 return {id:'personal:'+mapping.effective_from+':'+mapping.pay_type+':'+Object.entries(values!).filter(([key])=>!key.startsWith('DROPX_')).map(([key,value])=>`${key}:${value}`).join(':'),company_id:'',name:'Individual payment stage',provider_id:mapping.provider_id||'',station_id:mapping.station_id||null,designation_id:null,pay_type:payType,effective_from:mapping.effective_from||'',effective_to:mapping.effective_to||null,delivery_rate:delivery,return_rate:returns,mfn_rate:mfn,mfn_return_rate:mfnReturn,fuel_rate:read(values!,'FUEL'),fixed_amount:fixed,guarantee_amount:read(values!,'GUARANTEE'),status:'active' as const};
}
