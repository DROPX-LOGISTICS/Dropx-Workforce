import {PendingLink} from './pending-link';
import {joiningStages,type JoiningStage} from '@/lib/workforce-joining';
import type {workforceOverview} from '@/lib/workforce-overview';
import styles from './workforce-journey-summary.module.css';
const hints:Record<JoiningStage,string>={applicant:'Registration or review needed',awaiting_arrival:'Approved; no training arrival yet',training:'Biometric training in progress',awaiting_activation:'Own provider ID still pending',ready:'ID ready; work not yet started',active:'Operationally active',offboarded:'Exited; settlement remains separate',closed:'Rejected, cancelled or closed'};
export function WorkforceJourneySummary({overview}:{overview:ReturnType<typeof workforceOverview>|null}){
 return <section className="wf-command-panel" aria-label="Associate lifecycle overview">
  <header><div><span>Associate lifecycle</span><h2>Every profile, one clear stage</h2></div><small>{overview?`${overview.total} profiles in scope`:'Lifecycle counts unavailable'}</small></header>
  {overview?<div className={styles.grid}>{Object.entries(joiningStages).map(([stage,label])=><PendingLink className={styles.stage} key={stage} href={'/delivery-network/joining?stage='+stage}><span><strong>{label}</strong><small>{hints[stage as JoiningStage]}</small></span><b>{overview.counts[stage as JoiningStage]}</b></PendingLink>)}</div>:<p className={styles.notice}>Joining evidence could not be loaded. No zero totals or active status are inferred. <PendingLink href="/delivery-network/joining">Open Joining &amp; Training</PendingLink></p>}
  <footer>Uses the same approved-profile, biometric and effective provider-mapping rules as Joining. Training status is not a payment approval.</footer>
 </section>;
}
