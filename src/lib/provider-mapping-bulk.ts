type BulkRow = {dropxId:string;providerMemberId:string;paymentMethodId:string;effectiveFrom:string;effectiveTo:string;paymentValues:Record<string,string>};
type Method = {id:string;code:string;components:Array<{code:string;label:string}>};

export const mappingRateColumns = [
  ['DELIVERY','Delivery incl. SWA'],['CRETURN','C-return'],['SELLER_PICKUP','MFN / pickup'],['SLLLER_RETURN','MFN return']
] as const;

export function mappingRate(values:Record<string,string|number>|null|undefined,code:string,fallback?:string|number|null) {
  const value=values?.[code] ?? fallback;
  return value===undefined||value===null||value===''?'—':`₹${Number(value).toLocaleString('en-IN',{maximumFractionDigits:2})}`;
}

function validDate(value:string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
}

/** Stage an entire file atomically in the browser. Saving still uses the existing authorised server action. */
export function stageMappingImport<T extends BulkRow>(input:Record<string,unknown>[], rows:T[], methods:Method[], allowedIds:Set<string>) {
  if(!input.length || input.length>500)throw new Error('Upload between 1 and 500 rows.');
  const staged=rows.map(row=>({...row,paymentValues:{...row.paymentValues}}));
  const seen=new Set<string>();
  for(const [index,record] of input.entries()) {
    const text=(key:string)=>String(record[key]??'').trim();
    const id=text('DropX ID').toUpperCase();
    const fail=(message:string):never=>{throw new Error(`Row ${index+2}: ${message}`);};
    if(!id || seen.has(id))fail('DropX ID is missing or duplicated.');
    seen.add(id);
    const matches=rows.flatMap((row,i)=>row.dropxId.toUpperCase()===id?[i]:[]);
    if(matches.length!==1||!allowedIds.has(id))fail('DropX ID is not in the selected station / filtered list.');
    const row=staged[matches[0]];
    if(Number(row.paymentValues.DROPX_PERSONAL_TERMS)===1)fail('Use the associate payment stages for individual dated terms.');
    const method=methods.find(m=>m.code===text('Payment method code'));
    if(!method)fail('Payment method code is not valid. Use the template’s Payment methods sheet.');
    const provider=text('Provider ID');
    if(!provider || /^[=+@]/.test(provider))fail('A valid provider ID is required.');
    const from=text('Effective from'),to=text('Effective to');
    if(!validDate(from)|| (to && (!validDate(to)||to<from)))fail('Use valid YYYY-MM-DD dates, with end on or after start.');
    const values:Record<string,string>={};
    for(const component of method!.components) {
      const value=text(`RATE_${component.code}`);
      if(!/^\d+(\.\d{1,2})?$/.test(value)||Number(value)>1000000)fail(`${component.label} must be 0–1000000, with at most 2 decimals.`);
      values[component.code]=value;
    }
    Object.assign(row,{providerMemberId:provider,paymentMethodId:method!.id,effectiveFrom:from,effectiveTo:to,paymentValues:values});
  }
  return staged as T[];
}
