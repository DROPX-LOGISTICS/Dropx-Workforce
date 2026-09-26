import { AppShell } from "@/components/app-shell";
import { FieldExecutiveList, type FieldExecutiveListRow } from "@/components/field-executive-list";
import { PageHead } from "@/components/page-head";
import { PendingLink } from "@/components/pending-link";
import { hasPermission, requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { firstDesignationBusinessCategory } from "@/lib/designation-business-categories";
import type { RegisterDesignation } from "@/lib/workforce-register-designations";
import {loadWorkforceJoining} from '@/lib/workforce-joining-data';
import {joiningState, joiningStages} from '@/lib/workforce-joining';
import {workforceToday} from '@/lib/workforce-earnings';
import {workforceRegisterViewMatches, validRegisterStage} from '@/lib/workforce-register-views';
import { WorkforceReferralDesk } from "@/components/workforce-referral-desk";
import {
  loadWorkforceCommunicationRecipients,
  type WorkforceCommunicationRecipient
} from "@/lib/workforce-communication-recipients";

export const dynamic = "force-dynamic";

function profileHref(record: WorkforceCommunicationRecipient, mode: "edit" | "view") {
  if (record.profileType === "field_executive") return `/delivery-network/onboarding?${mode}=${encodeURIComponent(record.accountId)}`;
  if (record.profileType === "workforce") return `/delivery-network/onboarding/associates?${mode}=${encodeURIComponent(record.accountId)}`;
  if (record.profileType === "contractor") return `/delivery-network/contractor-profiles?${mode}=${encodeURIComponent(record.accountId)}`;
  return undefined;
}

export default async function WorkforceAssociatesPage({searchParams={}}:{searchParams?:{view?:string;station?:string;stage?:string;notice?:string;error?:string}}) {
  const authorization = await requirePagePermission("delivery_associates", "access");
  const companyId = requireCompanyId(authorization);
  const canAdd = hasPermission(authorization, "delivery_associates", "add");
  const canEdit = hasPermission(authorization, "delivery_associates", "edit");
  let records: WorkforceCommunicationRecipient[] = [];
  let designations: RegisterDesignation[] = [];
  let error: string | null = null;
  const stages = new Map<string,string>();
  const view = ['active','pending','offboarded','all','referrals'].includes(searchParams.view||'')?searchParams.view!:'pending';
  let referralPrograms: any[]=[];
  let referrals:any[]=[];
  let referralStations:Array<{id:string;station_code:string;station_name:string|null}>=[];

  try {
    const [recipients, joining] = await Promise.all([loadWorkforceCommunicationRecipients(authorization), loadWorkforceJoining(authorization,{to:workforceToday()})]);
    records = recipients;
    const plans = new Map(joining.plans.map(plan=>[plan.workforce_id,plan]));
    for(const person of joining.profiles) stages.set(person.id,joiningState(person,plans.get(person.id)??null,joining.mappings,joining.attendance,workforceToday()).stage);
    if (supabaseAdmin) {
      const result = await supabaseAdmin.from("designations")
        .select("id, code, name, designation_category:designation_categories!designations_designation_category_id_fkey(id, code, name, people_module, is_active)")
        .eq("company_id", companyId).eq("is_active", true).order("code");
      if (result.error) throw new Error(result.error.message);
      designations = (result.data ?? []).filter(item => firstDesignationBusinessCategory(item.designation_category)?.people_module === "delivery_network")
        .map(({ id, code, name }) => ({ id, code, name }));
    }
  } catch (loadError) {
    error = loadError instanceof Error ? loadError.message : "Unable to load the Workforce register.";
  }

  if(view==='referrals'&&supabaseAdmin){
    const [programResult,referralResult,stationResult]=await Promise.all([
      supabaseAdmin.from('workforce_referral_programs').select('*').eq('company_id',companyId).order('effective_from',{ascending:false}),
      supabaseAdmin.from('workforce_referrals').select('id,referred_full_name,referred_country_code,referred_mobile,status,qualification_progress,qualifying_days_snapshot,reward_amount_snapshot,submitted_at,decision_remarks,preferred_station_id,referrer:workforce!workforce_referrals_referrer_workforce_id_fkey(full_name,dropx_id),station:stations!workforce_referrals_preferred_station_id_fkey(station_code,station_name)').eq('company_id',companyId).order('submitted_at',{ascending:false}),
      supabaseAdmin.from('stations').select('id,station_code,station_name').eq('company_id',companyId).eq('is_active',true).order('station_code')
    ]);
    const referralError=[programResult,referralResult,stationResult].find(result=>result.error)?.error;
    if(referralError)error=referralError.message;
    else{
      referralPrograms=(programResult.data??[]).filter(row=>authorization.hasAllLocationAccess||!row.station_id||authorization.locationScopeIds.includes(row.station_id));
      referrals=(referralResult.data??[]).filter(row=>authorization.hasAllLocationAccess||!row.preferred_station_id||authorization.locationScopeIds.includes(row.preferred_station_id));
      referralStations=(stationResult.data??[]).filter(row=>authorization.hasAllLocationAccess||authorization.locationScopeIds.includes(row.id));
    }
  }

  const stationRecords = records.filter(record=>!searchParams.station || record.location===searchParams.station);
  const stageFor = (record:WorkforceCommunicationRecipient)=>stages.get(record.accountId) || (record.isActive&&record.status.toLowerCase()==='active'?'active':'applicant');
  const viewMatches = (record:WorkforceCommunicationRecipient,key:string)=>key==='pending'
    ? !record.isActive && !['offboarded','closed','rejected','cancelled'].includes(stageFor(record))
    : workforceRegisterViewMatches(key,stageFor(record),record.status);
  const selectedStage = validRegisterStage(searchParams.stage);
  const displayedRecords = stationRecords.filter(record=>viewMatches(record,view) && (!selectedStage || stageFor(record)===selectedStage));
  const rows: FieldExecutiveListRow[] = displayedRecords.map((record) => ({
    id: `${record.profileType}:${record.accountId}`,
    dropxId: record.reference || "ID pending",
    biometricId: record.biometricId || "-",
    fullName: record.name,
    mobile: record.mobile ? `+${record.countryCode} ${record.mobile}` : "-",
    email: record.email || "-",
    location: record.location || "-",
    provider: record.provider || "-",
    model: record.model || "-",
    designation: record.designation || "-",
    isActive: record.isActive,
    status: stageFor(record)==='applicant'?record.status:joiningStages[stageFor(record) as keyof typeof joiningStages]||record.status,
    canEdit,
    viewHref: record.profileType==='workforce'&&hasPermission(authorization,'people_review','access')?`/delivery-network/lifecycle?tab=${record.status.toLowerCase()==='active'?'active':'onboarding'}&person=${record.accountId}`:profileHref(record, "view"),
    editHref: profileHref(record, "edit"),
    paymentsHref: record.profileType === 'workforce' && hasPermission(authorization, 'people_review', 'access') && hasPermission(authorization, 'provider_mapping', 'access')
      ? `/delivery-network/lifecycle?tab=${record.status.toLowerCase() === 'active' ? 'active' : 'onboarding'}&person=${record.accountId}&section=payments` : undefined
  }));

  return (
    <AppShell active="Associate Lifecycle" pageCode="delivery_associates">
      <PageHead
        eyebrow="Workforce"
        title="Associate Lifecycle"
        subtitle="Source intake, approval, work setup, commercial readiness and exit in one flow across every delivery partner."
        action={canAdd ? <PendingLink className="button compact" href="/delivery-network/onboarding">Add associate</PendingLink> : null}
      />

      {error ? (
        <section className="panel message-panel error">
          <div className="panel-body"><strong>Workforce data is not ready</strong><p className="subtle" style={{ marginTop: 6 }}>{error}</p></div>
        </section>
      ) : null}
      {searchParams.notice ? <div className="message-panel success">{searchParams.notice}</div> : null}
      {searchParams.error ? <div className="message-panel error">{searchParams.error}</div> : null}

      <section className="performance-summary-grid" aria-label="Associate lifecycle progress">
        <article><span>Applications</span><strong>{stationRecords.filter(record=>stageFor(record)==='applicant').length}</strong><small>Identity and approval required</small></article>
        <article><span>Joining setup</span><strong>{stationRecords.filter(record=>['awaiting_arrival','training','awaiting_activation'].includes(stageFor(record))).length}</strong><small>Assignment, partner account or terms pending</small></article>
        <article><span>Ready</span><strong>{stationRecords.filter(record=>stageFor(record)==='ready').length}</strong><small>Setup complete; first work pending</small></article>
        <article><span>Active</span><strong>{stationRecords.filter(record=>stageFor(record)==='active').length}</strong><small>Working under an effective assignment</small></article>
      </section>

      {view!=='referrals'?<form method="get" className="wf-station-context">
        <input type="hidden" name="view" value={view}/>
        {selectedStage ? <input type="hidden" name="stage" value={selectedStage}/> : null}
        <label>Station<select name="station" defaultValue={searchParams.station||''}><option value="">All stations</option>{[...new Set(records.map(record=>record.location).filter(Boolean))].sort().map(station=><option key={station}>{station}</option>)}</select></label>
        <button className="button secondary compact">Apply</button>
      </form>:null}
      <nav className="wf-journey-nav" aria-label="Workforce register views">
        {[['pending','Needs action',stationRecords.filter(record=>viewMatches(record,'pending')).length],['active','Active',stationRecords.filter(record=>viewMatches(record,'active')).length],['offboarded','Offboarded',stationRecords.filter(record=>viewMatches(record,'offboarded')).length],['all','All',stationRecords.length],['referrals','Refer & earn',referrals.length]].map(([key,label,count])=><PendingLink key={String(key)} aria-current={view===key?'page':undefined} href={`/delivery-network/associates?view=${key}&station=${encodeURIComponent(searchParams.station||'')}`}>{label}<strong>{count}</strong></PendingLink>)}
      </nav>
      {view==='referrals'?<WorkforceReferralDesk programs={referralPrograms} referrals={referrals} stations={referralStations} canEdit={canEdit}/>:<>{selectedStage ? <div className="wf-stage-filter" role="status"><span>{joiningStages[selectedStage as keyof typeof joiningStages]} · {displayedRecords.length} profiles</span><PendingLink href={`/delivery-network/associates?view=${view}&station=${encodeURIComponent(searchParams.station||'')}`}>Clear stage filter</PendingLink></div> : null}
      <FieldExecutiveList
        basePath="/delivery-network/associates"
        canEdit={canEdit}
        emptyLabel="No master-classified Workforce profiles are available yet."
        rows={rows}
        designationSwitches={designations}
        directProfileLinks
        hideLocationFilter
        key={`${view}:${selectedStage||''}:${searchParams.station||''}`}
        showActions={!error}
        title="Lifecycle queue"
      /></>}
    </AppShell>
  );
}
