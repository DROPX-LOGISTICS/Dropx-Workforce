import type { SupabaseClient } from '@supabase/supabase-js';
import { betaLifecycleEnabled, betaLifecycleSummary } from './beta-lifecycle';
import { betaChecks, betaInboxActions, betaLearning, betaSourceProgress, verifiedBetaSnapshot } from './beta-verification';
import { betaUanProgress, loadBetaUanMail } from './beta-uan';
import { amazonInvitationUrl } from './onboarding-action-url';

export type LifecycleCandidate={id:string;company_id?:string;station_id:string;full_name:string;mobile:string;alias_email:string;biometric_id:string;status:string;inbox_status:string;updated_at:string;closed_at:string|null;close_reason:string|null;continuation_status:string|null;duplicate_identity_summary:string|null;duplicate_identity_detected:boolean};
export async function loadBetaLifecycle(db:SupabaseClient,company:string,candidate:LifecycleCandidate) {
  if(!betaLifecycleEnabled(company,candidate.id))return null;
  const scoped=(table:string)=>db.from(table).select('*').eq('company_id',company).eq('candidate_id',candidate.id);
  const [snapshot,registration,invitation,messages,uanMail,events,cases,exit,attendance,policy,uanSubmission]=await Promise.all([
    scoped('workforce_beta_verification_snapshots').maybeSingle(),
    scoped('workforce_amazon_email_pilot_registrations').maybeSingle(),
    db.from('workforce_amazon_invitation_requests').select('*').eq('company_id',company).eq('email_pilot_candidate_id',candidate.id).order('requested_at',{ascending:false}).limit(1).maybeSingle(),
    scoped('workforce_amazon_email_pilot_messages').order('received_at',{ascending:false}).limit(100),
    loadBetaUanMail(db,company,candidate.id),
    scoped('workforce_beta_verification_events').order('created_at',{ascending:false}).limit(100),
    scoped('workforce_beta_verification_cases').order('created_at',{ascending:false}),
    scoped('workforce_amazon_email_pilot_exit_requests').order('created_at',{ascending:false}).limit(1).maybeSingle(),
    db.from('attendance_daily').select('punch_date,in_time,out_time,updated_at').eq('company_id',company).eq('enrolment_id',candidate.biometric_id).order('punch_date',{ascending:false}).limit(1).maybeSingle(),
    db.from('workforce_beta_verification_settings').select('no_response_days,auto_offboard_enabled,offboard_reason_code').eq('company_id',company).maybeSingle(),
    scoped('workforce_beta_verification_events').eq('event','uan_submission_reported').order('created_at',{ascending:false}).limit(1).maybeSingle()
  ]);
  const mail=messages.error?[]:messages.data??[];
  const link=mail.map(m=>amazonInvitationUrl(m.action_url)).find(Boolean);
  const provider=invitation.data?.external_reference??(link?new URL(link).searchParams.get('providerId'):null);
  const live=verifiedBetaSnapshot(snapshot.error?null:snapshot.data,candidate.alias_email,provider);
  const actions=betaInboxActions([...mail,...uanMail.messages]);
  const uan=betaUanProgress(live,uanMail.messages,uanSubmission.data?.created_at);
  const checks=betaChecks(live),learning=betaLearning(live);
  const summary=betaLifecycleSummary({isolatedBeta:true,lifecycleEnhanced:true,stage:'',registrationStatus:registration.data?.status,registrationReturnNote:registration.data?.return_note,
    continuationStatus:candidate.continuation_status as 'pending'|'continuing'|'not_continuing',...betaSourceProgress(live),bgcStatus:live?.bgc_status,bgcChecks:checks,uan,learning,driverId:live?.driver_id,
    inboxActions:actions,invitationAvailable:Boolean(link),operationalStatus:live?.operational_status,closedAt:candidate.closed_at,verificationClosed:(cases.data??[]).some(x=>x.status==='offboarded'),offboardingRequested:candidate.continuation_status==='not_continuing',
    latestAttendance:attendance.data?{inTime:attendance.data.in_time,outTime:attendance.data.out_time}:null});
  const unavailable=Boolean(snapshot.error||registration.error||invitation.error||messages.error||uanMail.unavailable||events.error||cases.error||exit.error||attendance.error||policy.error||uanSubmission.error);
  const stale=[live?.lsc_observed_at,live?.idfy_observed_at].some(t=>!t||Date.now()-Date.parse(t)>24*3600000);
  return {summary,live,checks,learning,uan,registration:registration.error?null:registration.data,invitation:invitation.data,events:events.data??[],cases:cases.data??[],exit:exit.data,policy:policy.data,attendance:attendance.data,
    unavailable,stale,identityMismatch:Boolean(snapshot.data&&!live),delayed:Boolean(live?.sync_error),messages:mail.map(m=>({id:m.id,subject:m.subject,sender:m.sender,received_at:m.received_at})),
    actions:actions.filter(a=>uan.status!=='verified'||a.kind==='verification')};
}
export type BetaLifecycleAdmin=NonNullable<Awaited<ReturnType<typeof loadBetaLifecycle>>>;
