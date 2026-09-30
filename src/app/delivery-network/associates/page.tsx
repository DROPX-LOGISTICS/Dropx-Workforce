import { loadWorkforceLifecycle } from "@/lib/workforce-lifecycle-data";
import type { LifecycleReadiness } from "@/lib/workforce-workbench";
import type { PartnerOnboardingState } from "@/lib/partner-onboarding";
import { AssociateWorkbench } from "@/components/associate-workbench";
import { WorkforceLifecycleContent } from "@/components/workforce-lifecycle-content";
import { AppShell } from "@/components/app-shell";
import { FieldExecutiveList, type FieldExecutiveListRow } from "@/components/field-executive-list";
import { PageHead } from "@/components/page-head";
import { hasPermission, requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { firstDesignationBusinessCategory } from "@/lib/designation-business-categories";
import type { RegisterDesignation } from "@/lib/workforce-register-designations";
import type { WorkforceCommunicationRecipient } from "@/lib/workforce-communication-recipients";

export const dynamic = "force-dynamic";

function profileHref(record: WorkforceCommunicationRecipient, mode: "edit" | "view") {
  if (record.profileType === "field_executive") return `/delivery-network/onboarding?${mode}=${encodeURIComponent(record.accountId)}`;
  if (record.profileType === "workforce") return `/delivery-network/onboarding/associates?${mode}=${encodeURIComponent(record.accountId)}`;
  if (record.profileType === "contractor") return `/delivery-network/contractor-profiles?${mode}=${encodeURIComponent(record.accountId)}`;
  return undefined;
}

export default async function WorkforceAssociatesPage({
  searchParams = {},
}: {
  searchParams?: { notice?: string; error?: string; person?: string; section?: string };
}) {
  const authorization = await requirePagePermission("delivery_associates", "access");
  const companyId = requireCompanyId(authorization);
  const canEdit = hasPermission(authorization, "delivery_associates", "edit") && !authorization.readOnly;
  let records: WorkforceCommunicationRecipient[] = [];
  let designations: RegisterDesignation[] = [];
  let readiness = new Map<string, LifecycleReadiness>();
  let partners = new Map<string, PartnerOnboardingState>();
  let error: string | null = null;

  try {
    const lifecycle = await loadWorkforceLifecycle(authorization);
    records = lifecycle.records;
    readiness = lifecycle.readiness;
    partners = lifecycle.partners;

    if (supabaseAdmin) {
      const designationResult = await supabaseAdmin
        .from("designations")
        .select("id, code, name, designation_category:designation_categories!designations_designation_category_id_fkey(id, code, name, people_module, is_active)")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("code");
      if (designationResult.error) throw new Error(designationResult.error.message);
      designations = (designationResult.data ?? [])
        .filter((item) => firstDesignationBusinessCategory(item.designation_category)?.people_module === "delivery_network")
        .map(({ id, code, name }) => ({ id, code, name }));
    }
  } catch (loadError) {
    error = loadError instanceof Error ? loadError.message : "Unable to load the active associate register.";
  }

  const activeRecords = records.filter((record) => readiness.get(record.accountId)?.phase === "active" || partners.get(record.accountId)?.mapping_confirmed);
  const workspaceHref = (id: string) => `/delivery-network/associates?person=${encodeURIComponent(id)}&section=journey`;
  const rows: FieldExecutiveListRow[] = activeRecords.map((record) => ({
    id: `${record.profileType}:${record.accountId}`,
    dropxId: record.reference || "-",
    biometricId: record.biometricId || "-",
    fullName: record.name,
    mobile: record.mobile ? `+${record.countryCode} ${record.mobile}` : "-",
    email: record.email || "-",
    location: record.location || "-",
    provider: record.provider || "-",
    model: record.model || "-",
    designation: record.designation || "-",
    isActive: true,
    status: readiness.get(record.accountId)?.phase === "active" ? "Active" : "Client ID active",
    canEdit,
    workforceId: record.accountId,
    viewHref: record.profileType === "workforce" && hasPermission(authorization, "people_review", "access")
      ? workspaceHref(record.accountId)
      : profileHref(record, "view"),
    editHref: profileHref(record, "edit"),
  }));
  const unique = (values: string[]) => new Set(values.filter((value) => value && value !== "-")).size;

  return (
    <AppShell active="Associates" pageCode="delivery_associates">
      <PageHead
        eyebrow="Workforce"
        title="Active Associates"
        subtitle="Only fully activated workforce IDs appear here. Onboarding and mapping work stays under Onboarding."
      />

      {error ? (
        <section className="panel message-panel error">
          <div className="panel-body"><strong>Active associate data is unavailable</strong><p className="subtle" style={{ marginTop: 6 }}>{error}</p></div>
        </section>
      ) : null}
      {searchParams.notice ? <div className="message-panel success">{searchParams.notice}</div> : null}
      {searchParams.error ? <div className="message-panel error">{searchParams.error}</div> : null}

      <section className="performance-summary-grid" aria-label="Active associate coverage">
        <article><span>Active associates</span><strong>{activeRecords.length}</strong><small>Completed workforce setup</small></article>
        <article><span>Stations</span><strong>{unique(activeRecords.map((record) => record.location))}</strong><small>Locations represented</small></article>
        <article><span>Designations</span><strong>{unique(activeRecords.map((record) => record.designation))}</strong><small>Configured active roles</small></article>
        <article><span>Providers</span><strong>{unique(activeRecords.map((record) => record.provider))}</strong><small>Client networks represented</small></article>
      </section>

      <FieldExecutiveList
        basePath="/delivery-network/associates"
        canEdit={canEdit}
        designationSwitches={designations}
        directProfileLinks
        emptyLabel="No associates have completed activation in this scope."
        rows={rows}
        showActions={!error}
        title="Active associate register"
      />
      {searchParams.person ? (
        <AssociateWorkbench closeHref="/delivery-network/associates">
          {hasPermission(authorization, "people_review", "access") && activeRecords.some((record) => record.profileType === "workforce" && record.accountId === searchParams.person)
            ? <WorkforceLifecycleContent embedded searchParams={searchParams} />
            : <p>This active associate is unavailable or you do not have review access.</p>}
        </AssociateWorkbench>
      ) : null}
    </AppShell>
  );
}
