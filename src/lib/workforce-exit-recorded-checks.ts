/** Counts from the database preflight; never a reconstruction of unimported earnings. */
export const recordedExitChecks = [
  ['unreconciled_payroll', 'Payroll items without reconciled individual Finance payment', '/delivery-network/payment-ledger'],
  ['unposted_adjustments', 'Adjustments awaiting review or payroll posting', '/delivery-network/adjustments'],
  ['unreconciled_posted_adjustments', 'Posted adjustments missing an exact paid payroll line', '/delivery-network/adjustments'],
  ['active_holds', 'Active payment holds', '/delivery-network/payment-holds'],
  ['unsettled_windows', 'Accepted pooled windows awaiting settlement', '/delivery-network/pooled-settlements'],
] as const;
export type RecordedExitChecks = {payroll_items:number} & Record<typeof recordedExitChecks[number][0],number>;
export function parseRecordedExitChecks(input:unknown):RecordedExitChecks {
  if(!input || typeof input!=='object' || Array.isArray(input)) throw new Error('Recorded exit checks are unavailable.');
  const record=input as Record<string,unknown>;
  const keys=['payroll_items',...recordedExitChecks.map(([key])=>key)];
  if(keys.some(key=>typeof record[key]!=='number'||!Number.isSafeInteger(record[key])||Number(record[key])<0)
    || Number(record.unreconciled_payroll)>Number(record.payroll_items)) throw new Error('Recorded exit checks are incomplete.');
  return Object.fromEntries(keys.map(key=>[key,record[key]])) as RecordedExitChecks;
}
export function recordedExitBlockers(checks:RecordedExitChecks){
  return [
    ...(checks.payroll_items===0?['No recorded payroll: complete the source-earnings review. An empty ledger does not prove no dues.']:[]),
    ...recordedExitChecks.filter(([key])=>checks[key]>0).map(([key,label])=>`${checks[key]} · ${label}`),
  ];
}
