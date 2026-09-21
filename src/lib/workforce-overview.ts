import {joiningState,joiningStages,type JoiningPerson,type JoiningPlan,type JoiningMapping,type JoiningAttendance,type JoiningStage} from './workforce-joining';

/** Same lifecycle rules as Joining; a profile belongs to exactly one visible bucket. */
export function workforceOverview(data:{profiles:JoiningPerson[];plans:JoiningPlan[];mappings:JoiningMapping[];attendance:JoiningAttendance[]},today:string){
 const counts=Object.fromEntries(Object.keys(joiningStages).map(stage=>[stage,0])) as Record<JoiningStage,number>;
 const ids=new Set<string>(),plans=new Map<string,JoiningPlan>();
 for(const person of data.profiles){if(!person.id||ids.has(person.id))throw new Error('Duplicate Workforce profile in overview.');ids.add(person.id);}
 for(const plan of data.plans){if(!ids.has(plan.workforce_id)||plans.has(plan.workforce_id))throw new Error('Joining plan is duplicated or outside the overview scope.');plans.set(plan.workforce_id,plan);}
 let underReview=0;
 for(const person of data.profiles){
  const stage=joiningState(person,plans.get(person.id)??null,data.mappings,data.attendance,today).stage;
  counts[stage]++;
  if(stage==='applicant'&&person.onboarding_status==='under_review')underReview++;
 }
 return {total:data.profiles.length,counts,underReview,needsRegistration:counts.applicant-underReview};
}
