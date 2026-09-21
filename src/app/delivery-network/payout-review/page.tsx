import {AppShell} from '@/components/app-shell';import {PayoutReviewDesk} from '@/components/payout-review-desk';import {requirePagePermission} from '@/lib/authorization';import {reviewPayout} from './actions';
export const dynamic='force-dynamic';
export default async function Page({searchParams={}}:{searchParams?:{status?:string;q?:string;run?:string;error?:string;notice?:string}}){
 const auth=await requirePagePermission('workforce_adjustments','access');
 return <AppShell active="Disputes & corrections" pageCode="workforce_adjustments"><header className="panel-head"><div><h1>Payout review</h1><p>Respond, correct and resolve before Finance release.</p></div></header>{searchParams.notice||searchParams.error?<p role="status">{searchParams.notice||searchParams.error}</p>:null}<PayoutReviewDesk auth={auth} portal="workforce" action={reviewPayout} params={searchParams}/></AppShell>;
}
