'use client';
import {useState} from 'react';
import {Download} from 'lucide-react';
import styles from './lifecycle.module.css';
export function BetaReportDownload({candidateId}:{candidateId:string}) {
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 return <div><button className={styles.primary} disabled={busy} onClick={async()=>{setBusy(true);setError('');try{const r=await fetch(`/api/beta-lifecycle/report?candidate=${encodeURIComponent(candidateId)}`,{cache:'no-store'});if(!r.ok){const e=await r.json();throw new Error(e.error||'Report unavailable');}const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download='IDfy-verification.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError(e instanceof Error?e.message:'Report unavailable');}finally{setBusy(false);}}}><Download size={16}/>{busy?'Preparing report…':'Download IDfy report'}</button>{error?<p className={styles.warning} role="alert">{error}</p>:null}</div>;
}
