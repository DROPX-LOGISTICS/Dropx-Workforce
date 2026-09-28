import {storedComponentRules,type PaymentComponentRule} from './payment-component-rules';
type Mapping={payment_values?:Record<string,unknown>|null;effective_from?:string|null;effective_to?:string|null;provider_id?:string|null;station_id?:string|null;pay_type?:string|null};
const read=(values:Record<string,unknown>,key:string)=>{const number=Number(values[key]??0);if(!Number.isFinite(number)||number<0)throw new Error('Invalid individual payment terms. Contact Workforce.');return number;};
export function personalPaymentSource(mapping:Mapping){
 const rules=Object.values(storedComponentRules(mapping.payment_values));
 if(rules.length){const sources=[...new Set(rules.map(rule=>rule.sourceOfTruth))];return sources.length===1?sources[0]:'mixed';}
 return String(mapping.payment_values?.DROPX_SOURCE_OF_TRUTH??'');
}
export function personalDailyAmount(mapping:Mapping){
 const values=mapping.payment_values;if(Number(values?.DROPX_PERSONAL_TERMS)!==1)return null;
 const rules=storedComponentRules(values);const attendance=Object.entries(rules).filter(([,rule])=>rule.sourceOfTruth==='biometric_attendance'&&rule.calculationBasis==='attendance_day');
 if(attendance.length)return attendance.reduce((sum,[code])=>sum+read(values!,code),0);
 if(Object.keys(rules).length)return null;
 if(personalPaymentSource(mapping)!=='biometric_attendance')return null;
 return Object.entries(values||{}).filter(([key])=>!key.startsWith('DROPX_')).reduce((sum,[key])=>sum+read(values!,key),0);
}
/** Individual terms preserve component earning rules inside the dated mapping. */
export function personalPaymentCard(mapping:Mapping){
 const values=mapping.payment_values;if(Number(values?.DROPX_PERSONAL_TERMS)!==1)return null;
 const stored=storedComponentRules(values);
 const amazonRules=Object.entries(stored).filter(([,rule])=>rule.sourceOfTruth==='amazon_daily_shipment'&&['shipment_quantity','shipment_active_day'].includes(rule.calculationBasis));
 if(Object.keys(stored).length){
  if(!amazonRules.length)return null;
  const componentRules=amazonRules.map(([code,rule])=>({code,rate:read(values!,code),rule}));
  const quantity=componentRules.filter(item=>item.rule.calculationBasis==='shipment_quantity');
  const active=componentRules.filter(item=>item.rule.calculationBasis==='shipment_active_day');
  const metricRate=(metric:PaymentComponentRule['sourceMetric'])=>quantity.filter(item=>item.rule.sourceMetric===metric).reduce((sum,item)=>sum+item.rate,0);
  const payType=active.length&&quantity.length?'hybrid_additive' as const:active.length?'fixed_daily' as const:'per_shipment' as const;
  return {id:'personal:'+mapping.effective_from+':'+mapping.pay_type+':'+Object.entries(values!).filter(([key])=>!key.startsWith('DROPX_')).map(([key,value])=>`${key}:${value}`).join(':'),company_id:'',name:'Individual payment stage',provider_id:mapping.provider_id||'',station_id:mapping.station_id||null,designation_id:null,pay_type:payType,effective_from:mapping.effective_from||'',effective_to:mapping.effective_to||null,delivery_rate:metricRate('total_delivery'),return_rate:metricRate('customer_return'),mfn_rate:metricRate('seller_pickup'),mfn_return_rate:metricRate('seller_return'),fuel_rate:0,fixed_amount:active.reduce((sum,item)=>sum+item.rate,0),guarantee_amount:0,status:'active' as const,componentRules};
 }
 const source=personalPaymentSource(mapping);if(source==='biometric_attendance')return null;if(source&&source!=='amazon_daily_shipment')return null;
 const delivery=read(values!,'DELIVERY'),returns=read(values!,'CRETURN'),mfn=read(values!,'SELLER_PICKUP'),mfnReturn=read(values!,'SLLLER_RETURN');
 const fixed=['MG_PER_DAY','DAILY_PAY','FIXED_DAILY','FIXED_PAY_PER_DAY','VAN_RENT_PER_DAY'].map(key=>read(values!,key)).reduce((sum,amount)=>sum+amount,0);
 const hasActivity=[delivery,returns,mfn,mfnReturn].some(amount=>amount>0);
 const payType=fixed>0&&hasActivity?'hybrid_additive' as const:fixed>0?'fixed_daily' as const:'per_shipment' as const;
 return {id:'personal:'+mapping.effective_from+':'+mapping.pay_type+':'+Object.entries(values!).filter(([key])=>!key.startsWith('DROPX_')).map(([key,value])=>`${key}:${value}`).join(':'),company_id:'',name:'Individual payment stage',provider_id:mapping.provider_id||'',station_id:mapping.station_id||null,designation_id:null,pay_type:payType,effective_from:mapping.effective_from||'',effective_to:mapping.effective_to||null,delivery_rate:delivery,return_rate:returns,mfn_rate:mfn,mfn_return_rate:mfnReturn,fuel_rate:read(values!,'FUEL'),fixed_amount:fixed,guarantee_amount:0,status:'active' as const};
}
