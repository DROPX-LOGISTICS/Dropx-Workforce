import { supabaseAdmin } from "@/lib/supabase-admin";
import { readAllRows } from "@/lib/supabase-pagination";
import { requireCompanyId } from "@/lib/company-scope";
import type { AuthorizationContext } from "@/lib/authorization";
import { workforceClassification } from "@/lib/workforce-classification";
import { belongsToPerson } from "./workforce-joining";
import type { JoiningAttendance, JoiningMapping, JoiningPerson, JoiningPlan, TrainingPolicy } from "./workforce-joining";

export type JoiningProfile = JoiningPerson & {full_name: string; dropx_id: string | null; biometric_id: string | null; designation: string | null; designation_id: string | null; onboarding_application_source: string | null};
export type JoiningEvent = {id: string; workforce_id: string; event_code: string; actor_name: string; created_at: string; details: Record<string, unknown>};
export async function loadWorkforceJoining(authorization: AuthorizationContext, options: {from?: string; to: string; evidence?: boolean}) {
  if (!supabaseAdmin) throw new Error("Database connection is unavailable.");
  const db = supabaseAdmin; const company = requireCompanyId(authorization);
  let profilesQuery = db.from("workforce").select("id,full_name,dropx_id,biometric_id,designation,designation_id,location_id,source_profile_type,source_profile_id,onboarding_status,lifecycle_status,is_active,onboarding_approved_at,last_working_date,onboarding_application_source")
    .eq("company_id",company).is("deleted_at",null).neq("migration_state","reclassified").order("id");
  if (!authorization.hasAllLocationAccess) profilesQuery = profilesQuery.in("location_id", authorization.locationScopeIds.length ? authorization.locationScopeIds : ["00000000-0000-0000-0000-000000000000"]);
  const [peopleResult, plansResult, mappingsResult, stationsResult, isWorkforce, policyResult] = await Promise.all([
    readAllRows(profilesQuery),
    readAllRows(db.from("workforce_joining_plans").select("*").eq("company_id",company).order("workforce_id")),
    readAllRows(db.from("field_executive_provider_mappings").select("id,workforce_id,field_executive_id,contractor_id,employee_id,provider_id,provider_member_id,station_id,effective_from,effective_to,status")
      .eq("company_id",company).neq("status","cancelled").order("effective_from").order("id")),
    readAllRows(db.from("stations").select("id,station_code").eq("company_id",company).order("id")),
    workforceClassification(company),
    readAllRows(db.from("workforce_training_policies").select("id,station_id,name,daily_rate,minimum_minutes,policy_reference,effective_from,effective_to,is_active").eq("company_id",company).order("id"))
  ]);
  const error = peopleResult.error || mappingsResult.error || stationsResult.error || policyResult.error;
  if (error) throw new Error(error.message);
  if (plansResult.error) throw new Error(`Joining database release is not ready: ${plansResult.error.message}`);
  const profiles = ((peopleResult.data ?? []) as JoiningProfile[]).filter(isWorkforce);
  const ids = new Set(profiles.map(row=>row.id));
  const plans = ((plansResult.data ?? []) as JoiningPlan[]).filter(row=>ids.has(row.workforce_id));
  const planIds = new Set(plans.map(row=>row.workforce_id));
  // Keep each visible person's full mapping history, including previous stations, for the pay cutoff.
  const mappings = ((mappingsResult.data ?? []) as JoiningMapping[]).filter(row=>profiles.some(person=>belongsToPerson(row,person)));
  const attendance: JoiningAttendance[] = [];
  const firstEligible = plans.map(row=>row.eligible_from).sort()[0];
  if (firstEligible && options.evidence !== false) {
    const from = options.from && options.from > firstEligible ? options.from : firstEligible;
    const people = profiles.filter(row=>planIds.has(row.id));
    // Query canonical and protected legacy identities, never guess a person by name.
    for (const column of ["workforce_id","field_executive_id","contractor_id"] as const) {
      const values = column === "workforce_id" ? people.map(row=>row.id) : people.filter(row=>row.source_profile_type === (column === "field_executive_id" ? "field_executive" : "contractor")).map(row=>row.source_profile_id!).filter(Boolean);
      for (let index=0;index<values.length;index+=100) {
        const result = await readAllRows(db.from("attendance_daily")
          .select("id,workforce_id,field_executive_id,contractor_id,punch_date,in_time,out_time,work_minutes,status,punch_in_location_id,location_id,in_source,out_source,enrolment_id,updated_at")
          .eq("company_id",company).in(column,values.slice(index,index+100)).gte("punch_date",from).lte("punch_date",options.to).not("in_time","is",null).order("punch_date").order("id"));
        if (result.error) throw new Error(`Attendance could not be reconciled: ${result.error.message}`);
        attendance.push(...(result.data ?? []) as JoiningAttendance[]);
      }
    }
  }
  const uniqueAttendance = [...new Map(attendance.map(row=>[row.id,row])).values()];
  const enrolments = [...new Set(uniqueAttendance.map(row=>row.enrolment_id).filter(Boolean))];
  const flagged = new Set<string>();
  for (let index=0;index<enrolments.length;index+=100) {
    const result = await readAllRows(db.from("attendance_punches").select("enrolment_id,punch_date").eq("company_id",company).eq("is_flagged",true).in("enrolment_id",enrolments.slice(index,index+100)).gte("punch_date",options.from && options.from > firstEligible! ? options.from : firstEligible!).lte("punch_date",options.to).order("id"));
    if (result.error) throw new Error(`Biometric integrity could not be checked: ${result.error.message}`);
    for (const row of result.data ?? []) flagged.add(`${row.enrolment_id}:${row.punch_date}`);
  }
  return {profiles,plans,mappings,policies:((policyResult.data ?? []) as TrainingPolicy[]).filter(row=>authorization.hasAllLocationAccess || authorization.locationScopeIds.includes(row.station_id)),attendance:uniqueAttendance.map(row=>({...row,flagged:flagged.has(`${row.enrolment_id}:${row.punch_date}`)})), stations:((stationsResult.data ?? []) as {id:string;station_code:string}[]).filter(row=>authorization.hasAllLocationAccess || authorization.locationScopeIds.includes(row.id))};
}
