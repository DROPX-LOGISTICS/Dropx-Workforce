type CurrentLine={sourceType:string;sourceId:string;workDate:string;baseAmount:number;incentiveAmount:number;adjustmentAmount:number;netAmount:number;status:string};
type FrozenLine={source_type:string;source_id:string;work_date:string;base_amount:number|string;incentive_amount:number|string;adjustment_amount:number|string;net_amount:number|string};
const cents=(value:number|string)=>{const n=Number(value);if(!Number.isFinite(n))throw new Error('Invalid final earnings amount.');return Math.round(n*100);};
export function assertFinalPayrollMatches(current:CurrentLine[],frozen:FrozenLine[]){
  if(!current.length||!frozen.length)throw new Error('Final payroll must contain verified earning lines.');
  if(current.some(line=>line.status!=='ready'))throw new Error('Final earnings contain a hold or unresolved source. Review the earnings desk.');
  const live=current.map(line=>JSON.stringify([line.sourceType,line.sourceId,line.workDate,...[line.baseAmount,line.incentiveAmount,line.adjustmentAmount,line.netAmount].map(cents)])).sort();
  const saved=frozen.map(line=>JSON.stringify([line.source_type,line.source_id,line.work_date,...[line.base_amount,line.incentive_amount,line.adjustment_amount,line.net_amount].map(cents)])).sort();
  if(JSON.stringify(live)!==JSON.stringify(saved))throw new Error('Earnings changed after final payroll. Reconcile late imports or adjustments with Finance before closing the exit.');
}
