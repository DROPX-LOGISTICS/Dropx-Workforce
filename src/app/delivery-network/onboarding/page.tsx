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

type OnboardingView = "all" | "dropx_pending" | "client_due" | "client_progress" | "bgc_pending" | "blocked";

function profileHref(record: WorkforceCommunicationRecipient, mode: "edit" | "view") {
  if (record.profileType === "field_executive") return `/delivery-network/onboarding?${mode}=${encodeURIComponent(record.accountId)}`;
  if (record.profileType === "workforce") return `/delivery-network/onboarding/associates?${mode}=${encodeURIComponent(record.accountId)}`;
  if (record.profileType === "contractor") return `/delivery-network/contractor-profiles?${mode}=${encodeURIComponent(record.accountId)}`;
  return undefined;
}

export default async function WorkforceOnboardingPage({
  searchParams = {},
}: {
  searchParams?: { edit?: string; view?: string; error?: string; notice?: string; status?: string };
}) {
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
  const requestedView = (["all", "dropx_pending", "client_due", "client_progress", "bgc_pending", "blocked"].includes(searchParams.status ?? "")
    ? searchParams.status
    : "all") as OnboardingView;
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

  const incomplete = records.filter((record) => {
    const phase = readiness.get(record.accountId)?.phase;
    return phase !== "active" && phase !== "closed";
  });
  const bucketFor = (record: WorkforceCommunicationRecipient): Exclude<OnboardingView, "all"> => {
    const phase = readiness.get(record.accountId)?.phase;
    const partner = partners.get(record.accountId);
    if (phase === "registration" || phase === "review") return "dropx_pending";
    if (partner?.stage === "background_check" || /\b(idfy|bgc|background|video verification)\b/i.test(`${partner?.action_item ?? ""} ${partner?.label ?? ""}`)) return "bgc_pending";
    if (partner?.due_kind || ["exception", "invitation_failed"].includes(partner?.stage ?? "")) return "blocked";
    if (partner?.can_trigger || partner?.stage === "partner_setup_pending") return "client_due";
    return "client_progress";
  };
  const inBucket = (record: WorkforceCommunicationRecipient, view: OnboardingView): boolean => view === "all" || bucketFor(record) === view;
  const count = (view: OnboardingView) => incomplete.filter((record) => inBucket(record, view)).length;
  const visible = incomplete.filter((record) => inBucket(record, requestedView));
  const rows: FieldExecutiveListRow[] = visible.map((record) => {
    const state = readiness.get(record.accountId);
    const partner = partners.get(record.accountId);
    const needsDropxAction = state?.phase === "registration" || state?.phase === "review";
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
      status: partner?.due_kind ? `Due · ${partner.label}` : state?.label || record.status,
      canEdit,
      canTriggerPartner,
      partnerOnboarding: partner,
      workforceId: record.accountId,
      viewHref: profileHref(record, "view"),
      editHref: profileHref(record, "edit"),
      nextActionHref: needsDropxAction ? profileHref(record, state?.phase === "review" ? "edit" : "view") : undefined,
      nextActionLabel: needsDropxAction ? (state?.phase === "review" ? "Review registration" : "Open registration") : undefined,
    };
  });

  const viewOptions: Array<[OnboardingView, string]> = [
    ["all", "All pending"],
    ["dropx_pending", "DropX registration"],
    ["client_due", "Client ID due"],
    ["client_progress", "Client ID in progress"],
    ["bgc_pending", "BGC pendency"],
    ["blocked", "Blocked"],
  ];

  return (
    <AppShell active="Onboarding" pageCode="delivery_associates">
      <PageHead
        action={canAdd ? (
          <div className="component-chip-list">
            <PendingLink className="button compact" href="/delivery-network/onboarding/associates"><UserRoundPlus size={15} /> Invite Associate</PendingLink>
            <PendingLink className="button secondary compact" href="/delivery-network/onboarding/associates#bulk-upload"><Upload size={15} /> Bulk upload</PendingLink>
          </div>
        ) : undefined}
        eyebrow="Workforce onboarding"
        title="Onboarding"
        subtitle="One pending journey from DropX registration through the required client ID. Active associates leave this queue automatically."
      />

      {error || searchParams.error ? (
        <section className="panel message-panel error"><div className="panel-body"><strong>Onboarding data is unavailable</strong><p className="subtle">{error || searchParams.error}</p></div></section>
      ) : searchParams.notice ? <div className="message-panel success">{searchParams.notice}</div> : null}

      <section className="wf-onboarding-command">
        <div>
          <small>Pending onboarding</small>
          <strong>{incomplete.length}</strong>
          <span>Active identities are excluded</span>
        </div>
        <ol>
          <li><span>1</span>DropX registration</li>
          <li><ArrowRight size={13} />Client ID trigger</li>
          <li><ArrowRight size={13} />Progress & blockers</li>
          <li><ArrowRight size={13} />Provider mapping</li>
        </ol>
      </section>

      <nav className="wf-journey-nav wf-onboarding-status-nav" aria-label="Onboarding status">
        {viewOptions.map(([key, label]) => (
          <PendingLink aria-current={requestedView === key ? "page" : undefined} href={`/delivery-network/onboarding?status=${key}`} key={key}>
            {label}<strong>{count(key)}</strong>
          </PendingLink>
        ))}
      </nav>

      <FieldExecutiveList
        basePath="/delivery-network/onboarding"
        canEdit={canEdit}
        directProfileLinks
        emptyLabel="No associates are waiting in this onboarding status."
        rows={rows}
        showActions={!error}
        title="Pending onboarding"
      />
    </AppShell>
  );
}
