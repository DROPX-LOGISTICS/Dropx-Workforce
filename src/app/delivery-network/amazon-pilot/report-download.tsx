import {BetaReportDownload as Report} from '@/components/beta-report-download';
export function BetaReportDownload({candidateId}:{candidateId:string}) {
 return <Report key={candidateId} endpoint={`/api/beta-lifecycle/report?candidate=${encodeURIComponent(candidateId)}`}/>;
}
