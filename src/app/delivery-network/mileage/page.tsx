import {WorkforceMileageDesk,type MileageSearch} from '@/components/workforce-mileage-desk';
import {submitMileage,createMileagePolicy,reviewMileage} from './actions';
export const dynamic='force-dynamic';
export default function MileagePage({searchParams}:{searchParams?:MileageSearch}){
 return <WorkforceMileageDesk pageCode="workforce_adjustments" active="Mileage Claims" path="/delivery-network/mileage" params={searchParams} submit={submitMileage} createPolicy={createMileagePolicy} review={reviewMileage}/>;
}
