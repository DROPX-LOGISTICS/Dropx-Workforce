/** Buckets are based on the canonical joining engine, not whether an ID exists. */
export function workforceRegisterViewMatches(view:string,stage:string,status:string) {
 if(view==='all')return true;
 if(view==='approved')return ['active','approved'].includes(status.toLowerCase());
 if(view==='joining')return ['applicant','awaiting_arrival','awaiting_activation','ready'].includes(stage);
 return view===stage;
}
