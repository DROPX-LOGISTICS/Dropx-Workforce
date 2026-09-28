import {WorkforceLifecycleContent} from '@/components/workforce-lifecycle-content';
export const dynamic='force-dynamic';
export default function WorkforceLifecyclePage({searchParams}:{searchParams?:{tab?:string;person?:string;section?:string;q?:string;from?:string;to?:string;error?:string;notice?:string}}){
 return <WorkforceLifecycleContent searchParams={searchParams}/>;
}
