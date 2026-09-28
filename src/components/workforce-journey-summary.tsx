import {PendingLink} from './pending-link';
import {lifecyclePhases,type LifecycleReadiness} from '@/lib/workforce-workbench';
import styles from './workforce-journey-summary.module.css';
export function WorkforceJourneySummary({states}:{states:LifecycleReadiness[]|null}){
 return <section className="wf-command-panel" aria-label="Associate lifecycle overview"><header><div><span>Associate lifecycle</span><h2>What needs attention</h2></div><small>{states?`${states.length} associates`:'Counts unavailable'}</small></header>
 {states?<div className={styles.grid}>{Object.entries(lifecyclePhases).map(([phase,label])=><PendingLink className={styles.stage} key={phase} href={`/delivery-network/associates?view=${phase==='active'?'active':phase==='closed'?'offboarded':'pending'}&phase=${phase}`}><strong>{label}</strong><b>{states.filter(row=>row.phase===phase).length}</b></PendingLink>)}</div>:<p className={styles.notice}>Unable to load lifecycle counts. Refresh to retry.</p>}
 </section>;
}
