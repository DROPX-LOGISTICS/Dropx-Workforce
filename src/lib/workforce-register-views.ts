/** Buckets are based on the canonical joining engine, not whether an ID exists. */
export function workforceRegisterViewMatches(view:string,stage:string,status:string) {
 if(view==='all')return true;
 if(view==='approved')return ['active','approved'].includes(status.toLowerCase());
 if(view==='joining')return ['applicant','awaiting_arrival','awaiting_activation','ready'].includes(stage);
 return view===stage;
}

export const registerStageViews: Record<string, string> = {
 applicant: 'joining', awaiting_arrival: 'joining', training: 'training',
 awaiting_activation: 'joining', ready: 'joining', active: 'active',
 offboarded: 'offboarded', closed: 'closed'
};

export function validRegisterStage(stage?: string): string | undefined {
 return stage && Object.hasOwn(registerStageViews, stage) ? stage : undefined;
}

export function registerStageHref(stage: string) {
 const valid = validRegisterStage(stage);
 return valid ? `/delivery-network/associates?view=${registerStageViews[valid]}&stage=${valid}` : '/delivery-network/associates';
}
