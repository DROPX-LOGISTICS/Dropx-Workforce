import {
  ArrowRight,
  BadgeCheck,
  Building2,
  ClipboardCheck,
  Fingerprint,
  Route,
  ShieldCheck,
  Truck,
  UserRoundPlus,
  UsersRound
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { PendingLink } from "@/components/pending-link";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { firstDesignationBusinessCategory } from "@/lib/designation-business-categories";
import { normalizeDesignationCategories } from "@/lib/designation-categories";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  loadWorkforceCommunicationRecipients,
  type WorkforceCommunicationRecipient
} from "@/lib/workforce-communication-recipients";

export const dynamic = "force-dynamic";

type DesignationRow = {
  code: string;
  name: string;
  onboarding_categories?: string[] | null;
  designation_category?: unknown;
};

function isOpen(record: WorkforceCommunicationRecipient) {
  return !["active", "rejected", "cancelled"].includes(record.status.trim().toLowerCase());
}

function RoleTags({ roles }: { roles: DesignationRow[] }) {
  return (
    <div className="wf-journey-role-list">
      {roles.map((role) => <span key={role.code}>{role.name}<small>{role.code}</small></span>)}
    </div>
  );
}

export default async function WorkforceOnboardingHubPage() {
  const authorization = await requirePagePermission("delivery_associates", "access");
  const companyId = requireCompanyId(authorization);
  let records: WorkforceCommunicationRecipient[] = [];
  let designations: DesignationRow[] = [];
  let error = "";

  if (!supabaseAdmin) {
    error = "Supabase service role key is not configured.";
  } else {
    try {
      const [recipientRows, designationResult] = await Promise.all([
        loadWorkforceCommunicationRecipients(authorization),
        supabaseAdmin
          .from("designations")
          .select("code, name, onboarding_categories, designation_category:designation_categories!designations_designation_category_id_fkey(id, code, name, people_module, is_active)")
          .eq("company_id", companyId)
          .eq("is_active", true)
          .order("name")
      ]);
      if (designationResult.error) throw new Error(designationResult.error.message);
      records = recipientRows;
      designations = ((designationResult.data ?? []) as DesignationRow[]).filter((designation) => (
        firstDesignationBusinessCategory(designation.designation_category)?.people_module === "delivery_network"
      ));
    } catch (loadError) {
      error = loadError instanceof Error ? loadError.message : "Unable to load Workforce onboarding.";
    }
  }

  const associateRoles = designations.filter((designation) => normalizeDesignationCategories(designation.onboarding_categories).includes("contractors"));
  const operationsRoles = designations.filter((designation) => {
    const categories = normalizeDesignationCategories(designation.onboarding_categories);
    return categories.includes("vendors") || categories.includes("workers");
  });
  const associateRecords = records.filter((record) => record.engagementType === "associate");
  const operationsRecords = records.filter((record) => record.engagementType === "operations");
  const protectedInvitations = records.filter((record) => record.compatibilityMode);

  const lifecycle = [
    { label: "Role master", helper: `${designations.length} Workforce roles`, href: "/delivery-network/designations", icon: ClipboardCheck },
    { label: "Invite", helper: "Choose the right journey", href: "/delivery-network/onboarding", icon: UserRoundPlus },
    { label: "Registration", helper: "DropX One submission", href: "/delivery-network/associates", icon: UsersRound },
    { label: "Verification", helper: "Documents and approval", href: "/delivery-network/lifecycle", icon: ShieldCheck },
    { label: "IDs & rates", helper: "Provider and payout ready", href: "/delivery-network/rate-mapping", icon: Fingerprint },
    { label: "Field active", helper: "Operational lifecycle", href: "/delivery-network/lifecycle?tab=active", icon: BadgeCheck }
  ];

  return (
    <AppShell active="Onboard Workforce" pageCode="delivery_associates">
      <PageHead
        eyebrow="Workforce onboarding"
        title="Choose the right onboarding journey"
        subtitle="The designation master decides what belongs here. Associates, ground support and fleet partners are kept separate from People / HR while sharing one Workforce lifecycle."
      />

      {error ? <section className="panel message-panel error"><div className="panel-body"><strong>Action required</strong><p className="subtle">{error}</p></div></section> : null}

      <section className="wf-onboarding-journeys" aria-label="Workforce onboarding journeys">
        <article>
          <header><span><UsersRound size={18} /></span><div><small>Individual workforce</small><h2>Associate onboarding</h2></div></header>
          <p>Delivery, driving and other contractor-engagement roles. New records follow the existing DropX One registration path.</p>
          <div className="wf-journey-metrics"><span><strong>{associateRoles.length}</strong> roles</span><span><strong>{associateRecords.filter(isOpen).length}</strong> open</span><span><strong>{associateRecords.length}</strong> total</span></div>
          <RoleTags roles={associateRoles} />
          <PendingLink className="wf-journey-action" href="/delivery-network/onboarding/associates">Open associate onboarding <ArrowRight size={15} /></PendingLink>
        </article>

        <article>
          <header><span><Truck size={18} /></span><div><small>Ground and fleet network</small><h2>Operations partner onboarding</h2></div></header>
          <p>Sorter, housekeeping, van renter, van vendor and future vendor/worker roles classified by the master.</p>
          <div className="wf-journey-metrics"><span><strong>{operationsRoles.length}</strong> roles</span><span><strong>{operationsRecords.filter(isOpen).length}</strong> open</span><span><strong>{operationsRecords.length}</strong> total</span></div>
          <RoleTags roles={operationsRoles} />
          <PendingLink className="wf-journey-action" href="/delivery-network/onboarding/operations">Open partner onboarding <ArrowRight size={15} /></PendingLink>
        </article>

        <article className="protected">
          <header><span><ShieldCheck size={18} /></span><div><small>Transition protection</small><h2>Existing mobile invitations</h2></div></header>
          <p>Invitations already sent through the earlier flow continue on the same profile ID, now resolved through the canonical Workforce register.</p>
          <div className="wf-journey-metrics"><span><strong>{protectedInvitations.length}</strong> protected</span><span><strong>{protectedInvitations.filter(isOpen).length}</strong> still open</span></div>
          <div className="wf-protection-note"><ShieldCheck size={14} /> Registration tokens, saved drafts and verification results remain attached during cutover.</div>
          <PendingLink className="wf-journey-action secondary" href="/delivery-network/lifecycle">Track protected invitations <ArrowRight size={15} /></PendingLink>
        </article>
      </section>

      <section className="wf-lifecycle-map">
        <header><div><small>End-to-end product flow</small><h2>From role setup to field activation</h2></div><span><Route size={17} /> Master-driven</span></header>
        <div>
          {lifecycle.map((step, index) => {
            const StepIcon = step.icon;
            return (
              <PendingLink href={step.href} key={step.label}>
                <span className="wf-lifecycle-index">{index + 1}</span>
                <span className="wf-lifecycle-icon"><StepIcon size={16} /></span>
                <strong>{step.label}</strong>
                <small>{step.helper}</small>
              </PendingLink>
            );
          })}
        </div>
      </section>

      <section className="wf-product-principles">
        <article><Building2 size={17} /><div><strong>People / HR isolation</strong><small>HR-classified designations never appear in these journeys or Workforce registers.</small></div></article>
        <article><ShieldCheck size={17} /><div><strong>Registration continuity</strong><small>Existing tokens, drafts and mobile submissions resolve to the same canonical Workforce identity.</small></div></article>
        <article><Route size={17} /><div><strong>One lifecycle</strong><small>Registration, review, provider ID, rates, communication and exit stay connected.</small></div></article>
      </section>
    </AppShell>
  );
}
