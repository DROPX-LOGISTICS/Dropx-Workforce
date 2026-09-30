import { ArrowRight, Upload, UserRoundPlus } from "lucide-react";
import { ClientIdWorkbench, type ClientIdWorkbenchRow } from "@/components/client-id-workbench";
import { FieldExecutivePageContent } from "@/components/field-executive-page-content";
import { FieldExecutiveList, type FieldExecutiveListRow } from "@/components/field-executive-list";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { PendingLink } from "@/components/pending-link";
import { hasPermission, requirePagePermission } from "@/lib/authorization";
import { loadWorkforceLifecycle } from "@/lib/workforce-lifecycle-data";
import { clientIdBucket, clientIdLanes, isClientIdReadiness, type ClientIdLane } from "@/lib/client-id-workbench";
import type { PartnerOnboardingState } from "@/lib/partner-onboarding";
import type { LifecycleReadiness } from "@/lib/workforce-workbench";
import type { WorkforceCommunicationRecipient } from "@/lib/workforce-communication-recipients";

export const dynamic = "force-dynamic";

type OnboardingArea = "registration" | "client";

function profileHref(record: WorkforceCommunicationRecipient, mode: "edit" | "view", area: OnboardingArea) {
  if (record.profileType === "field_executive") return `/delivery-network/onboarding?area=${area}&${mode}=${encodeURIComponent(record.accountId)}`;
  if (record.profileType === "workforce") return `/delivery-network/onboarding/associates?${mode}=${encodeURIComponent(record.accountId)}`;
  if (record.profileType === "contractor") return `/delivery-network/contractor-profiles?${mode}=${encodeURIComponent(record.accountId)}`;
  return undefined;
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
  const requestedClientView = ((clientIdLanes as readonly string[]).includes(searchParams.status ?? "")
    ? searchParams.status
    : "all") as ClientIdLane;
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
  const clientQueue = records.filter((record) => partners.has(record.accountId) && isClientIdReadiness(readiness.get(record.accountId)));
  const registrationRows: FieldExecutiveListRow[] = registrationQueue.map((record) => {
    const state = readiness.get(record.accountId);
    const registrationAction = state?.phase === "review" ? "Review registration" : "Open registration";
    return {
      id: `${record.profileType}:${record.accountId}`,
      dropxId: record.reference || "Pending",
      biometricId: record.biometricId || "-",
      fullName: record.name,
      mobile: record.mobile ? `+${record.countryCode} ${record.mobile}` : "-",
      email: record.email || "-",
      location: record.location || "-",
      provider: record.provider || "-",
      model: record.model || "-",
      designation: record.designation || "-",
      isActive: false,
      status: state?.label || record.status,
      canEdit,
      workforceId: record.accountId,
      viewHref: profileHref(record, "view", "registration"),
      editHref: profileHref(record, "edit", "registration"),
      nextActionHref: profileHref(record, state?.phase === "review" ? "edit" : "view", "registration"),
      nextActionLabel: registrationAction,
    };
  });
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
  const counts = Object.fromEntries(clientIdLanes.map((lane) => [lane, clientQueue.filter((record) => lane === "all" || clientIdBucket(partners.get(record.accountId), readiness.get(record.accountId)) === lane).length])) as Record<ClientIdLane, number>;

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

      {area === "registration" ? <section className="wf-onboarding-command">
        <div>
          <small>{area === "registration" ? "Awaiting DropX approval" : "Awaiting client ID"}</small>
          <strong>{area === "registration" ? registrationQueue.length : clientQueue.length}</strong>
          <span>Active associates are excluded</span>
        </div>
        <ol>
          <>
            <li><span>1</span>Invite</li>
            <li><ArrowRight size={13} />Registration</li>
            <li><ArrowRight size={13} />Approval</li>
          </>
        </ol>
      </section> : null}

      {area === "registration" ? <FieldExecutiveList
        basePath="/delivery-network/onboarding"
        canEdit={canEdit}
        directProfileLinks
        emptyLabel="No registrations are waiting for completion or approval."
        rows={registrationRows}
        showActions={!error}
        title="Registration queue"
      /> : <ClientIdWorkbench activeLane={requestedClientView} canTrigger={canTriggerPartner} counts={counts} rows={clientRows} />}
    </AppShell>
  );
}
