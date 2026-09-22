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
import {workforceRegisterViewMatches} from '@/lib/workforce-register-views';
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

export default async function WorkforceAssociatesPage({searchParams={}}:{searchParams?:{view?:string;station?:string}}) {
  const authorization = await requirePagePermission("delivery_associates", "access");
  const companyId = requireCompanyId(authorization);
  const canAdd = hasPermission(authorization, "delivery_associates", "add");
  const canEdit = hasPermission(authorization, "delivery_associates", "edit");
  let records: WorkforceCommunicationRecipient[] = [];
  let designations: RegisterDesignation[] = [];
  let error: string | null = null;
  const stages = new Map<string,string>();

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

  const stationRecords = records.filter(record=>!searchParams.station || record.location===searchParams.station);
  const view = ['active','joining','training','offboarded','closed','all','approved'].includes(searchParams.view||'')?searchParams.view!:'active';
  const stageFor = (record:WorkforceCommunicationRecipient)=>stages.get(record.accountId) || (record.isActive&&record.status.toLowerCase()==='active'?'active':'applicant');
  const viewMatches = (record:WorkforceCommunicationRecipient,key:string)=>workforceRegisterViewMatches(key,stageFor(record),record.status);
  const displayedRecords = stationRecords.filter(record=>viewMatches(record,view));
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
    <AppShell active="Workforce Register" pageCode="delivery_associates">
      <PageHead
        eyebrow="Workforce"
        title="Associates"
        subtitle="One profile for registration, training, IDs, payments and exit."
        action={canAdd ? <PendingLink className="button compact" href="/delivery-network/onboarding">Invite associate</PendingLink> : null}
      />

      {error ? (
        <section className="panel message-panel error">
          <div className="panel-body"><strong>Workforce data is not ready</strong><p className="subtle" style={{ marginTop: 6 }}>{error}</p></div>
        </section>
      ) : null}

      <form method="get" className="wf-station-context">
        <input type="hidden" name="view" value={view}/>
        <label>Station<select name="station" defaultValue={searchParams.station||''}><option value="">All stations</option>{[...new Set(records.map(record=>record.location).filter(Boolean))].sort().map(station=><option key={station}>{station}</option>)}</select></label>
        <button className="button secondary compact">Apply</button>
        {hasPermission(authorization,'provider_mapping','access')?<PendingLink className="button secondary compact" href={`/delivery-network/rate-mapping?station=${encodeURIComponent(searchParams.station||'')}`}>Station IDs & rates</PendingLink>:null}
        {canAdd?<PendingLink className="button secondary compact" href="/delivery-network/onboarding/associates#bulk-upload">Bulk upload & template</PendingLink>:null}
        {hasPermission(authorization,'workforce_earnings','access')?<PendingLink className="button secondary compact" href={`/delivery-network/earnings?station=${encodeURIComponent(searchParams.station||'')}`}>View station earnings →</PendingLink>:null}
        {hasPermission(authorization,'people_review','access')?<PendingLink className="button secondary compact" href="/delivery-network/lifecycle?tab=exits">Exit & settlement queue</PendingLink>:null}
      </form>
      <nav className="wf-journey-nav" aria-label="Workforce register views">
        {[['active','Active'],['joining','Joining & review'],['training','Training'],['offboarded','Offboarded'],['closed','Closed'],['all','All']].map(([key,label])=><PendingLink key={key} aria-current={view===key?'page':undefined} href={`/delivery-network/associates?view=${key}&station=${encodeURIComponent(searchParams.station||'')}`}>{label}<strong>{stationRecords.filter(record=>viewMatches(record,key)).length}</strong></PendingLink>)}
      </nav>
      <FieldExecutiveList
        basePath="/delivery-network/associates"
        canEdit={canEdit}
        emptyLabel="No master-classified Workforce profiles are available yet."
        rows={rows}
        designationSwitches={designations}
        directProfileLinks
        hideLocationFilter
        key={`${view}:${searchParams.station||''}`}
        showActions={!error}
        title="Associate register"
      />
    </AppShell>
  );
}
