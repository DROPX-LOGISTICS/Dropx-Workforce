'use client';
import {useState} from 'react';
export function WorkforceTrainingModeFields({mode,from,through,rate,minutes,today,disabled}:{mode:'training'|'direct';from:string;through:string;rate:string|number;minutes:string|number;today:string;disabled:boolean}){
 const [joiningMode,setJoiningMode]=useState(mode);
 return <>
  <label>Joining type<select name="mode" value={joiningMode} onChange={e=>setJoiningMode(e.target.value as 'training'|'direct')} disabled={disabled}><option value="training">Training before own ID</option><option value="direct">Direct joining · no training</option></select></label>
  <label>Attendance from<input name="eligible_from" type="date" required defaultValue={from} disabled={disabled}/></label>
  {joiningMode==='training'?<>
   <label>Training through<input name="training_completed_on" type="date" max={today} defaultValue={through} disabled={disabled}/><small>Own-ID effective date ends training. Leave blank while ongoing.</small></label>
   <label>Training pay / day (₹)<input name="daily_rate" type="number" min="0.01" step="0.01" required defaultValue={rate} disabled={disabled}/></label>
   <label>Minimum biometric minutes<input name="minimum_minutes" type="number" min="1" max="1440" required defaultValue={minutes} disabled={disabled}/></label>
  </>:<p>No training pay. Regular payment starts from the mapping’s effective date.</p>}
 </>;
}
