import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  FileUp,
  Search,
  Send,
  UserRoundCheck,
  UserRoundPlus,
} from "lucide-react";
import { ClientIdWorkbench, type ClientIdWorkbenchRow } from "@/components/client-id-workbench";
import { FieldExecutivePageContent } from "@/components/field-executive-page-content";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { PendingLink } from "@/components/pending-link";
import { hasPermission, requirePagePermission, type AuthorizationContext } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { formatDashboardDateTime } from "@/lib/date-format";
import { loadWorkforceLifecycle } from "@/lib/workforce-lifecycle-data";
import { clientIdBucket, clientIdLanes, isClientIdReadiness, type ClientIdLane } from "@/lib/client-id-workbench";
import { filterOnboardingLocations } from "@/lib/onboarding-location-access";
import type { PartnerOnboardingState } from "@/lib/partner-onboarding";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { LifecycleReadiness } from "@/lib/workforce-workbench";
import type { WorkforceCommunicationRecipient } from "@/lib/workforce-communication-recipients";
import styles from "./onboarding.module.css";

export const dynamic = "force-dynamic";

type OnboardingArea = "registration" | "client";
type IntakeStage = "interviews" | "registration" | "review";
type Relation<T> = T | T[] | null;
type RecruitLocation = { code: string; name: string; station_id: string | null };
type RecruitRole = { code: string; name: string };
type RecruitLead = {
  assigned_profile_id: string | null;
  email: string | null;
  follow_up_at: string | null;
  full_name: string | null;
  id: string;
  phone: string | null;
  recruitment_locations: Relation<RecruitLocation>;
  recruitment_roles: Relation<RecruitRole>;
  status: string;
  work_email: string | null;
};
type RecruitOwner = { full_name: string | null; id: string };
type InterviewQueue = { count: number; error: string; owners: Map<string, RecruitOwner>; rows: RecruitLead[] };

function first<T>(value: Relation<T>) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function cleanDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function todayInputValue() {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Kolkata",
    year: "numeric",
  }).format(new Date());
}

function intakeStage(value: unknown): IntakeStage {
  return value === "registration" || value === "review" ? value : "interviews";
}

function profileHref(record: WorkforceCommunicationRecipient, mode: "edit" | "view", area: OnboardingArea) {
  if (record.profileType === "field_executive") return `/delivery-network/onboarding?area=${area}&${mode}=${encodeURIComponent(record.accountId)}`;
  if (record.profileType === "workforce") return `/delivery-network/onboarding/associates?${mode}=${encodeURIComponent(record.accountId)}`;
  if (record.profileType === "contractor") return `/delivery-network/contractor-profiles?${mode}=${encodeURIComponent(record.accountId)}`;
  return undefined;
}

function interviewInviteHref(lead: RecruitLead) {
  const location = first(lead.recruitment_locations);
  const role = first(lead.recruitment_roles);
  const query = new URLSearchParams({
    full_name: lead.full_name ?? "",
    mobile_country_code: "91",
    mobile: cleanDigits(lead.phone).slice(-10),
    email: lead.work_email || lead.email || "",
    date_of_join: todayInputValue(),
    recruitment_lead_id: lead.id,
    onboarding_source: "recruit_portal",
  });
  if (location?.station_id) query.set("location_id", location.station_id);
  if (role?.name) query.set("designation", role.name);
  return `/delivery-network/onboarding/associates?${query.toString()}`;
}

function matchesSearch(values: unknown[], search: string) {
  const term = search.trim().toLowerCase();
  return !term || values.some((value) => String(value ?? "").toLowerCase().includes(term));
}

async function loadInterviews(authorization: AuthorizationContext): Promise<InterviewQueue> {
  if (!supabaseAdmin) return { count: 0, error: "Recruit interview connection is unavailable.", owners: new Map(), rows: [] };
  try {
    const companyId = requireCompanyId(authorization);
    const stationResult = await supabaseAdmin
      .from("stations")
      .select("id,station_code,station_name,hide_from_location_list,parent_station_id")
      .eq("company_id", companyId)
      .order("station_code")
      .limit(500);
    if (stationResult.error) throw new Error(stationResult.error.message);
    const stations = filterOnboardingLocations(stationResult.data ?? [], authorization);
    const stationIds = stations.map((station) => String(station.id));
    const recruitmentLocations = stationIds.length
      ? await supabaseAdmin.from("recruitment_locations")
        .select("id")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .in("station_id", stationIds)
      : { data: [] as Array<{ id: string }>, error: null };
    if (recruitmentLocations.error) throw new Error(recruitmentLocations.error.message);
    const recruitmentLocationIds = (recruitmentLocations.data ?? []).map((location) => String(location.id));
    let query = supabaseAdmin.from("recruitment_leads")
      .select("id,full_name,phone,email,work_email,status,follow_up_at,assigned_profile_id,recruitment_locations(code,name,station_id),recruitment_roles(code,name)", { count: "exact" })
      .eq("company_id", companyId)
      .eq("stream", "workforce")
      .eq("archived", false)
      .in("status", ["interview_scheduled", "interview_rescheduled"])
      .order("follow_up_at", { ascending: true })
      .limit(200);
    if (!authorization.hasAllLocationAccess) {
      query = recruitmentLocationIds.length
        ? query.in("location_id", recruitmentLocationIds)
        : query.eq("location_id", "00000000-0000-0000-0000-000000000000");
    }
    const result = await query;
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data ?? []) as unknown as RecruitLead[];
    const ownerIds = [...new Set(rows.map((row) => row.assigned_profile_id).filter((id): id is string => Boolean(id)))];
    const ownerResult = ownerIds.length
      ? await supabaseAdmin.from("profiles").select("id,full_name").eq("company_id", companyId).in("id", ownerIds)
      : { data: [] as RecruitOwner[], error: null };
    if (ownerResult.error) throw new Error(ownerResult.error.message);
    return {
      count: result.count ?? rows.length,
      error: "",
      owners: new Map((ownerResult.data ?? []).map((owner) => [String(owner.id), owner as RecruitOwner])),
      rows,
    };
  } catch (error) {
    return { count: 0, error: error instanceof Error ? error.message : "Recruit interviews could not be loaded.", owners: new Map(), rows: [] };
  }
}

function StageNavigation({ counts, stage }: { counts: Record<IntakeStage, number>; stage: IntakeStage }) {
  const stages: Array<{ icon: typeof CalendarClock; key: IntakeStage; label: string; helper: string }> = [
    { icon: CalendarClock, key: "interviews", label: "Interviews", helper: "Scheduled in Recruit" },
    { icon: Send, key: "registration", label: "Registration", helper: "Invitation sent" },
    { icon: UserRoundCheck, key: "review", label: "Approval", helper: "Workforce review" },
  ];
  return (
    <nav className={styles.stageNav} aria-label="Associate onboarding stages">
      {stages.map((item, index) => {
        const Icon = item.icon;
        return (
          <PendingLink className={stage === item.key ? styles.stageActive : ""} href={`/delivery-network/onboarding?stage=${item.key}`} key={item.key}>
            <span className={styles.stageIcon}><Icon size={15} /></span>
            <span><strong>{item.label}</strong><small>{item.helper}</small></span>
            <b>{counts[item.key]}</b>
            {index < stages.length - 1 ? <ArrowRight className={styles.stageArrow} size={14} /> : null}
          </PendingLink>
        );
      })}
      <PendingLink className={styles.nextStage} href="/delivery-network/onboarding?area=client">
        <span><strong>Client ID</strong><small>Starts after approval</small></span><ArrowRight size={15} />
      </PendingLink>
    </nav>
  );
}

function FilterBar({ search, stage, station, stations }: { search: string; stage: IntakeStage; station: string; stations: string[] }) {
  return (
    <form action="/delivery-network/onboarding" className={styles.filters} method="get">
      <input name="stage" type="hidden" value={stage} />
      <label className={styles.searchField}>
        <Search size={15} />
        <input defaultValue={search} name="q" placeholder="Search name, mobile, email or DropX ID" />
      </label>
      <select defaultValue={station} name="station" aria-label="Filter by station">
        <option value="">All stations</option>
        {stations.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
      <button type="submit">Apply</button>
      {search || station ? <PendingLink href={`/delivery-network/onboarding?stage=${stage}`}>Clear</PendingLink> : null}
    </form>
  );
}

export default async function WorkforceOnboardingPage({
  searchParams = {},
}: {
  searchParams?: { area?: string; edit?: string; view?: string; error?: string; notice?: string; status?: string; stage?: string; q?: string; station?: string };
}) {
  const area: OnboardingArea = searchParams.area === "client" ? "client" : "registration";
  if (searchParams.edit || searchParams.view) {
    return (
      <FieldExecutivePageContent
        activeLabel="Onboarding"
        designationCategoryFilter={["field_executives", "contractors", "vendors", "workers"]}
        designationPeopleModule="delivery_network"
        editId={searchParams.edit}
        errorMessage={searchParams.error}
        hideList
        notice={searchParams.notice}
        pageSubtitle="Complete the original invitation without creating a second workforce identity."
        pageTitle="Protected registration"
        profileOnly
        returnPath="/delivery-network/onboarding"
        viewId={searchParams.view}
      />
    );
  }

  const authorization = await requirePagePermission("delivery_associates", "access");
  const canAdd = hasPermission(authorization, "delivery_associates", "add") && !authorization.readOnly;
  const canEdit = hasPermission(authorization, "delivery_associates", "edit") && !authorization.readOnly;
  const canTriggerPartner = hasPermission(authorization, "executive_id_onboarding", "edit") && !authorization.readOnly;
  const requestedClientView = ((clientIdLanes as readonly string[]).includes(searchParams.status ?? "") ? searchParams.status : "all") as ClientIdLane;
  const stage = intakeStage(searchParams.stage);
  const search = searchParams.q ?? "";
  const selectedStation = searchParams.station ?? "";
  let records: WorkforceCommunicationRecipient[] = [];
  let readiness = new Map<string, LifecycleReadiness>();
  let partners = new Map<string, PartnerOnboardingState>();
  let lifecycleError = "";

  const interviewsPromise = area === "registration" ? loadInterviews(authorization) : Promise.resolve({ count: 0, error: "", owners: new Map<string, RecruitOwner>(), rows: [] });
  try {
    const lifecycle = await loadWorkforceLifecycle(authorization);
    records = lifecycle.records;
    readiness = lifecycle.readiness;
    partners = lifecycle.partners;
  } catch (loadError) {
    lifecycleError = loadError instanceof Error ? loadError.message : "Unable to load onboarding.";
  }
  const interviews = await interviewsPromise;

  const registrationQueue = records.filter((record) => readiness.get(record.accountId)?.phase === "registration");
  const reviewQueue = records.filter((record) => readiness.get(record.accountId)?.phase === "review");
  const clientQueue = records.filter((record) => partners.has(record.accountId) && isClientIdReadiness(readiness.get(record.accountId)));
  const clientRows: ClientIdWorkbenchRow[] = clientQueue.flatMap((record) => {
    const state = readiness.get(record.accountId);
    const partner = partners.get(record.accountId);
    if (!partner) return [];
    const bucket = clientIdBucket(partner, state);
    if (requestedClientView !== "all" && bucket !== requestedClientView) return [];
    return [{
      id: `${record.profileType}:${record.accountId}`,
      workforceId: record.accountId,
      name: record.name,
      dropxId: record.reference || "DropX ID pending",
      biometricId: record.biometricId || "—",
      mobile: record.mobile ? `+${record.countryCode} ${record.mobile}` : "—",
      email: record.email || "",
      station: record.location || "",
      designation: record.designation || "—",
      provider: partner.provider_name || record.provider || "Client",
      model: record.model || "",
      bucket,
      state: partner,
      profileHref: profileHref(record, "view", "client"),
      mappingHref: `/delivery-network/rate-mapping?station=${encodeURIComponent(record.location)}&person=${encodeURIComponent(record.accountId)}`,
    }];
  });
  const clientCounts = Object.fromEntries(clientIdLanes.map((lane) => [lane, clientQueue.filter((record) => lane === "all" || clientIdBucket(partners.get(record.accountId), readiness.get(record.accountId)) === lane).length])) as Record<ClientIdLane, number>;

  if (area === "client") {
    return (
      <AppShell active="Onboarding" pageCode="delivery_associates">
        <PageHead eyebrow="Onboarding · client setup" title="Client ID" subtitle="Trigger and track the identity required by the associate's assigned client." />
        {lifecycleError || searchParams.error ? <section className="panel message-panel error"><div className="panel-body"><strong>Client ID data is unavailable</strong><p className="subtle">{lifecycleError || searchParams.error}</p></div></section> : null}
        {searchParams.notice ? <div className="message-panel success">{searchParams.notice}</div> : null}
        <ClientIdWorkbench activeLane={requestedClientView} canTrigger={canTriggerPartner} counts={clientCounts} rows={clientRows} />
      </AppShell>
    );
  }

  const counts: Record<IntakeStage, number> = { interviews: interviews.count, registration: registrationQueue.length, review: reviewQueue.length };
  const activeWorkforceRows = stage === "review" ? reviewQueue : registrationQueue;
  const stationOptions = [...new Set([
    ...interviews.rows.map((row) => first(row.recruitment_locations)?.code || ""),
    ...activeWorkforceRows.map((row) => row.location),
  ].filter(Boolean))].sort((left, right) => left.localeCompare(right));
  const visibleInterviews = interviews.rows.filter((row) => {
    const location = first(row.recruitment_locations);
    const role = first(row.recruitment_roles);
    return (!selectedStation || location?.code === selectedStation)
      && matchesSearch([row.full_name, row.phone, row.email, row.work_email, location?.code, role?.name], search);
  });
  const visibleWorkforce = activeWorkforceRows.filter((row) => (!selectedStation || row.location === selectedStation)
    && matchesSearch([row.name, row.mobile, row.email, row.reference, row.biometricId, row.location, row.designation], search));

  return (
    <AppShell active="Onboarding" pageCode="delivery_associates">
      <div className={styles.workspace}>
        <PageHead
          action={canAdd ? <div className={styles.headActions}>
            <PendingLink className="button compact" href="/delivery-network/onboarding/associates"><UserRoundPlus size={15} /> Invite associate</PendingLink>
            <PendingLink className="button secondary compact" href="/delivery-network/onboarding/associates#bulk-upload"><FileUp size={15} /> Bulk upload</PendingLink>
          </div> : undefined}
          eyebrow="Workforce onboarding"
          title="Onboard associates"
          subtitle="One record from Recruit interview to approved DropX registration. Active associates are kept out of this workspace."
        />

        {lifecycleError || searchParams.error ? <section className={styles.inlineError}><CircleAlert size={17} /><div><strong>Registration data is unavailable</strong><span>{lifecycleError || searchParams.error}</span></div></section> : null}
        {interviews.error ? <section className={styles.inlineWarning}><CircleAlert size={17} /><div><strong>Recruit interviews could not be loaded</strong><span>{interviews.error}</span></div></section> : null}
        {searchParams.notice ? <section className={styles.inlineSuccess}><CheckCircle2 size={17} /><span>{searchParams.notice}</span></section> : null}

        <section className={styles.commandBar}>
          <div><span>Open onboarding work</span><strong>{counts.interviews + counts.registration + counts.review}</strong><small>Across interview, registration and approval</small></div>
          <StageNavigation counts={counts} stage={stage} />
        </section>

        <section className={styles.queuePanel}>
          <header className={styles.queueHeader}>
            <div>
              <span>{stage === "interviews" ? "Recruit handoff" : stage === "registration" ? "DropX registration" : "Workforce decision"}</span>
              <h2>{stage === "interviews" ? "Scheduled interviews" : stage === "registration" ? "Waiting for registration" : "Ready for approval"}</h2>
              <p>{stage === "interviews" ? "Invite a reported candidate into the same lifecycle record." : stage === "registration" ? "Follow up only where the associate has not submitted the registration." : "Review submitted profiles and resolve exceptions before client ID setup."}</p>
            </div>
            <b>{stage === "interviews" ? visibleInterviews.length : visibleWorkforce.length} shown</b>
          </header>
          <FilterBar search={search} stage={stage} station={selectedStation} stations={stationOptions} />

          <div className={styles.queueList}>
            {stage === "interviews" ? visibleInterviews.map((lead) => {
              const location = first(lead.recruitment_locations);
              const role = first(lead.recruitment_roles);
              const owner = lead.assigned_profile_id ? interviews.owners.get(lead.assigned_profile_id) : null;
              return <article className={styles.queueRow} key={lead.id}>
                <div className={styles.personCell}><span>{(lead.full_name || "?").slice(0, 1).toUpperCase()}</span><div><strong>{lead.full_name || "Unnamed candidate"}</strong><small>{cleanDigits(lead.phone).slice(-10) || "Mobile unavailable"}</small></div></div>
                <dl><div><dt>Station</dt><dd>{location?.code || "Not assigned"}</dd></div><div><dt>Role</dt><dd>{role?.name || "Not assigned"}</dd></div><div><dt>Interview</dt><dd>{lead.follow_up_at ? formatDashboardDateTime(lead.follow_up_at) : "Schedule pending"}</dd></div><div><dt>Recruit owner</dt><dd>{owner?.full_name || "Unassigned"}</dd></div></dl>
                {canAdd ? <PendingLink className={styles.primaryAction} href={interviewInviteHref(lead)}>Invite associate <ArrowRight size={14} /></PendingLink> : <span className={styles.readOnly}>View only</span>}
              </article>;
            }) : visibleWorkforce.map((record) => {
              const state = readiness.get(record.accountId);
              const href = profileHref(record, stage === "review" && canEdit ? "edit" : "view", "registration");
              return <article className={styles.queueRow} key={`${record.profileType}:${record.accountId}`}>
                <div className={styles.personCell}><span>{record.name.slice(0, 1).toUpperCase()}</span><div><strong>{record.name}</strong><small>{record.reference || "DropX ID reserved"}</small></div></div>
                <dl><div><dt>Station</dt><dd>{record.location || "Not assigned"}</dd></div><div><dt>Designation</dt><dd>{record.designation || "Not assigned"}</dd></div><div><dt>Mobile</dt><dd>{record.mobile ? `+${record.countryCode} ${record.mobile}` : "Unavailable"}</dd></div><div><dt>Next step</dt><dd>{state?.label || record.status}</dd></div></dl>
                {href ? <PendingLink className={stage === "review" ? styles.primaryAction : styles.secondaryAction} href={href}>{stage === "review" ? "Review profile" : "Open registration"} <ArrowRight size={14} /></PendingLink> : null}
              </article>;
            })}
            {stage === "interviews" && !visibleInterviews.length ? <div className={styles.emptyState}><CalendarClock size={24} /><strong>No scheduled interviews in this view</strong><span>Change the station or search, or invite a walk-in associate directly.</span></div> : null}
            {stage !== "interviews" && !visibleWorkforce.length ? <div className={styles.emptyState}><CheckCircle2 size={24} /><strong>No associates are waiting here</strong><span>The queue is clear for the selected filters.</span></div> : null}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
