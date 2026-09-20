"use client";
import {useState} from 'react';
import {SubmitButton} from './submit-button';
import {payrollCalendarPeriod,type PayrollCalendar} from '@/lib/workforce-payroll-calendar';
import {createPayrollRun} from '@/app/delivery-network/payroll/actions';
export function WorkforcePayrollCreate({stations,calendars,from:initialFrom,to:initialTo}:{stations:{id:string;station_code:string}[];calendars:PayrollCalendar[];from:string;to:string}){
  const [station,setStation]=useState(''),[calendarId,setCalendar]=useState(''),[from,setFrom]=useState(initialFrom),[to,setTo]=useState(initialTo),[at,setAt]=useState(initialTo),[error,setError]=useState('');
  function apply(id:string,date:string){setCalendar(id);setAt(date);setError('');if(!id)return;const calendar=calendars.find(row=>row.id===id);if(!calendar)return;try{const range=payrollCalendarPeriod(calendar,date);setFrom(range.from);setTo(range.to);}catch(err){setError(err instanceof Error ? err.message:'Choose a valid date.');}}
  return <section className="wf-payroll-create"><div><span>New close</span><h2>Create payroll snapshot</h2><p>Choose a station and calendar, or custom dates. Review and Finance approval remain mandatory.</p></div><form action={createPayrollRun}>
    <label>Payroll scope<select name="station_id" value={station} onChange={event=>{setStation(event.target.value);setCalendar('');setError('');}}><option value="">Whole network</option>{stations.map(row=><option key={row.id} value={row.id}>{row.station_code}</option>)}</select></label>
    <label>Calendar<select name="calendar_id" value={calendarId} onChange={event=>apply(event.target.value,at)}><option value="">Custom dates</option>{calendars.filter(row=>row.station_id===station&&row.is_active).map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
    {calendarId ? <label>Cycle containing date<input type="date" value={at} onChange={event=>apply(calendarId,event.target.value)}/></label>:null}
    <label>Period start<input name="from" required type="date" value={from} readOnly={Boolean(calendarId)} onChange={event=>setFrom(event.target.value)}/></label>
    <label>Period end<input name="to" required type="date" value={to} readOnly={Boolean(calendarId)} onChange={event=>setTo(event.target.value)}/></label>
    <SubmitButton disabled={Boolean(error)} pendingText="Calculating payroll">Create draft payroll</SubmitButton>
    {error ? <p role="alert">{error}</p>:null}
  </form></section>;
}
