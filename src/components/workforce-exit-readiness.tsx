import Link from 'next/link';
import {recordedExitChecks,recordedExitBlockers,type RecordedExitChecks} from '@/lib/workforce-exit-recorded-checks';
import styles from './workforce-exit-readiness.module.css';

export function WorkforceExitReadiness({checks,workforceId}:{checks:RecordedExitChecks;workforceId:string}){
  const blocked=recordedExitBlockers(checks).length>0;
  return <section className={styles.panel} aria-label="Recorded exit readiness">
    <div><h3>Exit readiness · recorded history</h3><p>{checks.payroll_items} non-cancelled payroll item(s) checked across all recorded periods.</p></div>
    <p className={styles.notice}>{blocked?'Further reconciliation required.':'Recorded checks passed; source-earnings review is still required.'} No payment or exit is actioned by this view.</p>
    {!checks.payroll_items?<p className={styles.warning}>No recorded payroll does not mean no earnings are owed. Review training, delivery imports and claims. A no-payroll or zero-value exit cannot be cleared here.</p>:null}
    <ul>{recordedExitChecks.map(([key,label,href])=><li key={key}>
      <Link href={key==='unreconciled_payroll'?`${href}?person=${encodeURIComponent(workforceId)}`:href}>{label}</Link>
      <span className={checks[key]?styles.warning:styles.count}>{checks[key]}</span>
    </li>)}</ul>
    <p>These checks cover stored records only. Unimported deliveries, uncalculated training, late claims and source changes still need review. Final-period sources and accepted pooled windows are rechecked when an authorised owner closes the exit.</p>
  </section>;
}
