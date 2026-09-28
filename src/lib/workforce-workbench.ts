import type {PartnerOnboardingState} from './partner-onboarding';
import {belongsToPerson, type JoiningPerson, type JoiningMapping} from './workforce-joining';

export const lifecyclePhases = {
 registration: 'Registration pending', review: 'Review registration', partner: 'Partner setup',
 mapping: 'Confirm provider ID', pay: 'Configure pay', activation: 'Activate assignment',
 active: 'Active', closed: 'Closed / offboarded'
} as const;
export type LifecyclePhase = keyof typeof lifecyclePhases;
export type LifecycleReadiness = {phase: LifecyclePhase; label: string; section: string; due: boolean; partner?: PartnerOnboardingState};
/** Readiness is derived from current evidence, never from legacy training stages or a name match. */
export function lifecycleReadiness(person: JoiningPerson, partner: PartnerOnboardingState|undefined, mappings: JoiningMapping[], today: string): LifecycleReadiness {
 const state=(phase:LifecyclePhase,section:string,label:string=lifecyclePhases[phase]):LifecycleReadiness=>({phase,section,label,due:Boolean(partner?.due_kind),partner});
 if(['rejected','cancelled','inactive'].includes(person.onboarding_status||'')||['inactive','offboarded','exited','terminated','resigned','settled','closed'].includes(person.lifecycle_status||''))return state('closed','exit');
 if(!['under_review','approved','active'].includes(person.onboarding_status||''))return state('registration','profile');
 if(person.onboarding_status==='under_review')return state('review','profile');
 if(partner&&!partner.mapping_confirmed)return state(partner.stage==='mapping_pending'?'mapping':'partner',partner.stage==='mapping_pending'?'payments':'journey',partner.label);
 const current=mappings.filter(row=>belongsToPerson(row,person)&&row.status!=='cancelled'&&row.effective_from<=today&&(!row.effective_to||row.effective_to>=today)&&(!row.station_id||row.station_id===person.location_id));
 if(partner?.mapping_confirmed&&!current.some(row=>row.payment_method_id))return state('pay','payments');
 if(person.onboarding_status!=='active'&&person.lifecycle_status!=='active')return state('activation','profile');
 return state('active','journey');
}

/** Preserve only local register context after mutations. Never accept an arbitrary return URL. */
export function associateReturnUrl(referer:string|null,params:Record<string,string>):string|null {
 try {
  const url=new URL(referer||'');
  if(url.pathname!=='/delivery-network/associates')return null;
  const query=new URLSearchParams();
  for(const key of ['view','station','phase','step','due','q','person','section']){
   const value=url.searchParams.get(key);if(value)query.set(key,value);
  }
  for(const [key,value] of Object.entries(params))query.set(key,value);
  return '/delivery-network/associates?'+query;
 }catch{return null;}
}
