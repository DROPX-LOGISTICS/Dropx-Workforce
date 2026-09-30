import { ArrowRight, Upload, UserRoundPlus } from "lucide-react";
import { FieldExecutivePageContent } from "@/components/field-executive-page-content";
import { FieldExecutiveList, type FieldExecutiveListRow } from "@/components/field-executive-list";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { PendingLink } from "@/components/pending-link";
import { hasPermission, requirePagePermission } from "@/lib/authorization";
import { loadWorkforceLifecycle } from "@/lib/workforce-lifecycle-data";
import type { PartnerOnboardingState } from "@/lib/partner-onboarding";
import type { LifecycleReadiness } from "@/lib/workforce-workbench";
import type { WorkforceCommunicationRecipient } from "@/lib/workforce-communication-recipients";

export const dynamic = "force-dynamic";

type OnboardingArea = "registration" | "client";
type ClientView = "all" | "due" | "progress" | "bgc" | "blocked";

function profileHref(record: WorkforceCommunicationRecipient, mode: "edit" | "view", area: OnboardingArea) {
  if (record.profileType === "field_executive") return `/delivery-network/onboarding?area=${area}&${mode}=${encodeURIComponent(record.accountId)}`;
  if (record.profileType === "workforce") return `/delivery-network/onboarding/associates?${mode}=${encodeURIComponent(record.accountId)}`;
  if (record.profileType === "contractor") return `/delivery-network/contractor-profiles?${mode}=${encodeURIComponent(record.accountId)}`;
  return undefined;
}

function clientBucket(partner: PartnerOnboardingState | undefined): Exclude<ClientView, "all"> {
  if (partner?.stage === "background_check" || /\b(idfy|bgc|background|video verification)\b/i.test(`${partner?.action_item ?? ""} ${partner?.label ?? ""}`)) return "bgc";
  if (partner?.due_kind || ["exception", "invitation_failed"].includes(partner?.stage ?? "")) return "blocked";
  if (partner?.can_trigger || partner?.stage === "partner_setup_pending") return "due";
  return "progress";
}

export default async function WorkforceOnboardingPage({
  searchParams = {},
}: {
  searchParams?: { area?: string; edit?: string; view?: string; error?: string; notice?: string; status?: string };
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
  const requestedClientView = (["all", "due", "progress", "bgc", "blocked"].includes(searchParams.status ?? "")
    ? searchParams.status
    : "all") as ClientView;
  let records: WorkforceCommunicationRecipient[] = [];
  let readiness = new Map<string, LifecycleReadiness>();
  let partners = new Map<string, PartnerOnboardingState>();
  let error = "";

  try {
    const lifecycle = await loadWorkforceLifecycle(authorization);
    records = lifecycle.records;
    readiness = lifecycle.readiness;
    partners = lifecycle.partners;
  } catch (loadError) {
    error = loadError instanceof Error ? loadError.message : "Unable to load onboarding.";
  }

  const registrationQueue = records.filter((record) => ["registration", "review"].includes(readiness.get(record.accountId)?.phase ?? ""));
  const clientQueue = records.filter((record) => ["partner", "activation"].includes(readiness.get(record.accountId)?.phase ?? ""));
  const visible = area === "registration"
    ? registrationQueue
    : clientQueue.filter((record) => requestedClientView === "all" || clientBucket(partners.get(record.accountId)) === requestedClientView);
  const rows: FieldExecutiveListRow[] = visible.map((record) => {
    const state = readiness.get(record.accountId);
    const partner = partners.get(record.accountId);
    const registrationAction = state?.phase === "review" ? "Review registration" : "Open registration";
    return {
      id: `${record.profileType}:${record.accountId}`,
      dropxId: record.reference || "Pending",
      biometricId: record.biometricId || "-",
      fullName: record.name,
      mobile: record.mobile ? `+${record.countryCode} ${record.mobile}` : "-",
      email: record.email || "-",
      location: record.location || "-",
      provider: partner?.provider_name || record.provider || "-",
      model: record.model || "-",
      designation: record.designation || "-",
      isActive: false,
      status: area === "client" && partner?.due_kind ? `Due · ${partner.label}` : state?.label || record.status,
      canEdit,
      canTriggerPartner,
      partnerOnboarding: area === "client" ? partner : undefined,
      workforceId: record.accountId,
      viewHref: profileHref(record, "view", area),
      editHref: profileHref(record, "edit", area),
      nextActionHref: area === "registration" ? profileHref(record, state?.phase === "review" ? "edit" : "view", area) : undefined,
      nextActionLabel: area === "registration" ? registrationAction : undefined,
    };
  });

  const clientViews: Array<[ClientView, string]> = [
    ["all", "All pending"],
    ["due", "Ready to request"],
    ["progress", "In progress"],
    ["bgc", "BGC pendency"],
    ["blocked", "Blocked"],
  ];
  const countClient = (view: ClientView) => clientQueue.filter((record) => view === "all" || clientBucket(partners.get(record.accountId)) === view).length;

  return (
    <AppShell active="Onboarding" pageCode="delivery_associates">
      <PageHead
        action={area === "registration" && canAdd ? (
          <div className="component-chip-list">
            <PendingLink className="button compact" href="/delivery-network/onboarding/associates"><UserRoundPlus size={15} /> Invite Associate</PendingLink>
            <PendingLink className="button secondary compact" href="/delivery-network/onboarding/associates#bulk-upload"><Upload size={15} /> Bulk upload</PendingLink>
          </div>
        ) : undefined}
        eyebrow="Workforce onboarding"
        title={area === "registration" ? "Onboard Associate" : "Client ID"}
        subtitle={area === "registration"
          ? "Invite, complete DropX registration and approve the associate."
          : "Request and track the client identity required for the associate's assigned provider."}
      />

      {error || searchParams.error ? (
        <section className="panel message-panel error"><div className="panel-body"><strong>Onboarding data is unavailable</strong><p className="subtle">{error || searchParams.error}</p></div></section>
      ) : searchParams.notice ? <div className="message-panel success">{searchParams.notice}</div> : null}

      <section className="wf-onboarding-command">
        <div>
          <small>{area === "registration" ? "Awaiting DropX approval" : "Awaiting client ID"}</small>
          <strong>{area === "registration" ? registrationQueue.length : clientQueue.length}</strong>
          <span>Active associates are excluded</span>
        </div>
        <ol>
          {area === "registration" ? <>
            <li><span>1</span>Invite</li>
            <li><ArrowRight size={13} />Registration</li>
            <li><ArrowRight size={13} />Approval</li>
          </> : <>
            <li><span>1</span>Ready to request</li>
            <li><ArrowRight size={13} />Client checks</li>
            <li><ArrowRight size={13} />ID ready</li>
            <li><ArrowRight size={13} />Mapping</li>
          </>}
        </ol>
      </section>

      {area === "client" ? <nav className="wf-journey-nav wf-onboarding-status-nav" aria-label="Client ID status">
        {clientViews.map(([key, label]) => (
          <PendingLink aria-current={requestedClientView === key ? "page" : undefined} href={`/delivery-network/onboarding?area=client&status=${key}`} key={key}>
            {label}<strong>{countClient(key)}</strong>
          </PendingLink>
        ))}
      </nav> : null}

      <FieldExecutiveList
        basePath="/delivery-network/onboarding"
        canEdit={canEdit}
        directProfileLinks
        emptyLabel={area === "registration" ? "No registrations are waiting for completion or approval." : "No client IDs are waiting in this status."}
        rows={rows}
        showActions={!error}
        title={area === "registration" ? "Registration queue" : "Client ID queue"}
      />
    </AppShell>
  );
}
