export type PayrollCalendar = {id:string;station_id:string;name:string;cadence:'daily'|'weekly'|'fifteen_days'|'monthly'|'custom';interval_days:number|null;anchor_date:string;policy_reference:string;is_active:boolean};
const day=86400000;
function parsed(value:string){const n=Date.parse(`${value}T00:00:00Z`);if(!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(n) || new Date(n).toISOString().slice(0,10)!==value) throw new Error('Choose a valid calendar date.');return n;}
const iso=(value:number)=>new Date(value).toISOString().slice(0,10);
export function payrollCalendarPeriod(calendar:Pick<PayrollCalendar,'cadence'|'interval_days'|'anchor_date'>,date:string){
  const anchor=parsed(calendar.anchor_date),at=parsed(date);
  if(at<anchor) throw new Error('Selected date is before this calendar starts.');
  if(calendar.cadence==='monthly') {
    if(calendar.anchor_date.slice(-2)!=='01') throw new Error('Monthly calendars start on the first day of a month.');
    const value=new Date(at),year=value.getUTCFullYear(),month=value.getUTCMonth();
    return {from:iso(Date.UTC(year,month,1)),to:iso(Date.UTC(year,month+1,0))};
  }
  const days=({daily:1,weekly:7,fifteen_days:15,custom:calendar.interval_days} as Record<string,number|null>)[calendar.cadence];
  if(!days || !Number.isInteger(days) || days<1 || days>93) throw new Error('Choose a calendar interval from 1 to 93 days.');
  const from=anchor+Math.floor((at-anchor)/(days*day))*days*day;
  return {from:iso(from),to:iso(from+(days-1)*day)};
}
