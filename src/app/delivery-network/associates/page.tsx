import { AppShell } from "@/components/app-shell";
import { FieldExecutiveList, type FieldExecutiveListRow } from "@/components/field-executive-list";
import { PageHead } from "@/components/page-head";
import { PendingLink } from "@/components/pending-link";
import { hasPermission, requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  loadWorkforceCommunicationRecipients,
  type WorkforceCommunicationRecipient
} from "@/lib/workforce-communication-recipients";

export const dynamic = "force-dynamic";

function profileHref(record: WorkforceCommunicationRecipient, mode: "edit" | "view") {
  if (record.profileType === "field_executive") return `/delivery-network/onboarding?${mode}=${encodeURIComponent(record.accountId)}`;
  if (record.profileType === "contractor") return `/delivery-network/contractor-profiles?${mode}=${encodeURIComponent(record.accountId)}`;
  return undefined;
}

export default async function WorkforceAssociatesPage() {
  const authorization = await requirePagePermission("delivery_associates", "access");
  const companyId = requireCompanyId(authorization);
  const canAdd = hasPermission(authorization, "delivery_associates", "add");
  const canEdit = hasPermission(authorization, "delivery_associates", "edit");
  let records: WorkforceCommunicationRecipient[] = [];
  const mappedSourceIds = new Set<string>();
  let error: string | null = null;

  try {
    records = await loadWorkforceCommunicationRecipients(authorization);
    if (supabaseAdmin) {
      let mappingQuery = supabaseAdmin
        .from("field_executive_provider_mappings")
        .select("field_executive_id, contractor_id")
        .eq("company_id", companyId)
        .is("effective_to", null);
      if (!authorization.hasAllLocationAccess) {
        mappingQuery = mappingQuery.in("station_id", authorization.locationScopeIds.length
          ? authorization.locationScopeIds
          : ["00000000-0000-0000-0000-000000000000"]);
      }
      const mappingResult = await mappingQuery;
      if (mappingResult.error) throw new Error(mappingResult.error.message);
      for (const mapping of mappingResult.data ?? []) {
        if (mapping.field_executive_id) mappedSourceIds.add(`field_executive:${mapping.field_executive_id}`);
        if (mapping.contractor_id) mappedSourceIds.add(`contractor:${mapping.contractor_id}`);
      }
    }
  } catch (loadError) {
    error = loadError instanceof Error ? loadError.message : "Unable to load the Workforce register.";
  }

  const rows: FieldExecutiveListRow[] = records.map((record) => ({
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
    status: record.status,
    canEdit,
    viewHref: profileHref(record, "view"),
    editHref: profileHref(record, "edit")
  }));
  const pending = records.filter((record) => !["active", "rejected", "cancelled"].includes(record.status.toLowerCase())).length;
  const protectedRegistrations = records.filter((record) => record.compatibilityMode).length;
  const paymentLinked = records.filter((record) => mappedSourceIds.has(`${record.profileType}:${record.accountId}`)).length;

  return (
    <AppShell active="Workforce Register" pageCode="delivery_associates">
      <PageHead
        eyebrow="Workforce"
        title="Workforce Register"
        subtitle="One operational register for delivery, sorting, cleaning, driver, van and every future master-classified Workforce role."
        action={canAdd ? <PendingLink className="button compact" href="/delivery-network/onboarding">Onboard workforce</PendingLink> : null}
      />

      {error ? (
        <section className="panel message-panel error">
          <div className="panel-body"><strong>Workforce data is not ready</strong><p className="subtle" style={{ marginTop: 6 }}>{error}</p></div>
        </section>
      ) : null}

      <section className="performance-summary-grid">
        <article><span>Total workforce</span><strong>{records.length}</strong><small>Designation-master classified profiles</small></article>
        <article><span>Open registration</span><strong>{pending}</strong><small>Pending, submitted or under review</small></article>
        <article><span>Registration protected</span><strong>{protectedRegistrations}</strong><small>Existing DropX One identities remain active</small></article>
        <article><span>Payment linked</span><strong>{paymentLinked}</strong><small>Mapped to the existing rate and payment engine</small></article>
      </section>

      <FieldExecutiveList
        basePath="/delivery-network/associates"
        canEdit={canEdit}
        emptyLabel="No master-classified Workforce profiles are available yet."
        rows={rows}
        showActions={!error}
        title="All Workforce members"
      />
    </AppShell>
  );
}
