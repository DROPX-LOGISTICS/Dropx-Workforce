'use client';

import { AlertTriangle, Fingerprint } from 'lucide-react';
import { useFormState } from 'react-dom';
import { SubmitButton } from '@/components/submit-button';
import { createAmazonPilot,type AmazonPilotCreateState } from './actions';
import styles from './pilot.module.css';

type Option={id:string;label:string};
const initialAmazonPilotCreateState:AmazonPilotCreateState={status:'idle',message:''};

export function AmazonPilotInviteForm({stations,roles,today,path}:{stations:Option[];roles:Option[];today:string;path:string}){
 const [state,action]=useFormState(createAmazonPilot,initialAmazonPilotCreateState);
 const needsConfirmation=state.status==='warning';
 return <form action={action} className={styles.form}>
  <label>Full name<input name="full_name" required minLength={2} maxLength={120} autoComplete="name"/></label>
  <label>Mobile number<input name="mobile" required inputMode="tel" pattern="[0-9]{10}" maxLength={10} placeholder="10-digit mobile"/></label>
  <label>Station<select name="station_id" required defaultValue=""><option value="" disabled>Select station</option>{stations.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
  <label>Designation<select name="designation_id" required defaultValue=""><option value="" disabled>Select designation</option>{roles.map(option=><option value={option.id} key={option.id}>{option.label}</option>)}</select></label>
  <label>Reported on<input type="date" name="reported_on" defaultValue={today} max={today} required/></label>
  {state.status!=='idle'?<div className={state.status==='warning'?styles.identityWarning:styles.error} role="alert">
   {state.status==='warning'?<AlertTriangle size={19}/>:null}<div><strong>{state.status==='warning'?'Existing DropX identity found':'Registration could not be saved'}</strong><p>{state.message}</p>{state.existingProfile?<small>{state.existingProfile}</small>:null}</div>
  </div>:null}
  <div className={styles.formHelp}><Fingerprint size={20}/><p>The backend reserves a unique Amazon email from the station master and a biometric ID for attendance. The beta does not create a canonical Workforce profile.</p></div>
  <footer>{needsConfirmation?<SubmitButton className={styles.primary} pendingText="Confirming registration…" name="identity_exception_confirmed" value="true">Confirm registration</SubmitButton>:<SubmitButton className={styles.primary} pendingText="Reserving email…">Create email &amp; invite</SubmitButton>}<a href={path}>Cancel</a></footer>
 </form>;
}
