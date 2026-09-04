import { Activity, ArrowRight, BadgeCheck, Banknote, CircleDollarSign, CircleDot, Clock3, Fingerprint, Gift, MessageSquareMore, ShieldCheck, UserRoundPlus, WalletCards } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PendingLink } from "@/components/pending-link";
import { hasPermission, requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { firstDesignationBusinessCategory } from "@/lib/designation-business-categories";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadWorkforceCommunicationRecipients } from "@/lib/workforce-communication-recipients";
import { calculateWorkforceEarnings, loadWorkforceEarnings, workforceToday } from "@/lib/workforce-earnings";

type NetworkProfile = {
  id: string;
  onboarding_status: string | null;
  is_active: boolean;
};

export const dynamic = "force-dynamic";

function status(value: string | null) {
  return String(value ?? "pending").trim().toLowerCase().replaceAll(" ", "_");
}

export default async function DeliveryNetworkPage() {
  const authorization = await requirePagePermission("delivery_associates", "access");
  const companyId = requireCompanyId(authorization);
  let profiles: NetworkProfile[] = [];
  let designationCount = 0;
  let mappingCount = 0;
  let legacyRegistrationCount = 0;
  let pendingAdjustmentCount = 0;
  let openPayrollCount = 0;
  let error: string | null = null;
  const today = workforceToday();
  const monthStart = `${today.slice(0, 8)}01`;
  const canReadEarnings = hasPermission(authorization, "workforce_earnings", "access");
  const financeSnapshotPromise = canReadEarnings ? loadWorkforceEarnings(authorization, monthStart, today) : Promise.resolve(calculateWorkforceEarnings({ from: monthStart, to: today, shipments: [], mappings: [], workforce: [], providers: [], stations: [], rateCards: [], campaigns: [], adjustments: [] }));

  if (!supabaseAdmin) {
    error = "Supabase service role key is not configured.";
  } else {
    let mappingQuery = supabaseAdmin
      .from("field_executive_provider_mappings")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .neq("status", "cancelled").lte("effective_from", today).or(`effective_to.is.null,effective_to.gte.${today}`);
    if (!authorization.hasAllLocationAccess) {
      mappingQuery = mappingQuery.in("station_id", authorization.locationScopeIds.length
        ? authorization.locationScopeIds
        : ["00000000-0000-0000-0000-000000000000"]);
    }
    try {
      const [workforceRecipients, designationResult, mappingResult, adjustmentCount, payrollCount] = await Promise.all([
        loadWorkforceCommunicationRecipients(authorization).catch((cause) => { error = cause instanceof Error ? cause.message : "Workforce register is unavailable."; return []; }),
        supabaseAdmin
          .from("designations")
          .select("id, name, designation_category:designation_categories!designations_designation_category_id_fkey(id, code, name, people_module, is_active)")
          .eq("company_id", companyId)
          .eq("is_active", true),
        mappingQuery,
        authorization.hasAllLocationAccess && hasPermission(authorization, "workforce_adjustments", "access") ? supabaseAdmin.from("workforce_adjustments").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "pending") : Promise.resolve({ count: null, error: null }),
        authorization.hasAllLocationAccess && hasPermission(authorization, "workforce_payroll", "access") ? supabaseAdmin.from("workforce_payroll_runs").select("id", { count: "exact", head: true }).eq("company_id", companyId).in("status", ["draft", "review"]) : Promise.resolve({ count: null, error: null })
      ]);
      error = error || designationResult.error?.message || mappingResult.error?.message || null;
      const deliveryDesignations = (designationResult.data ?? []).filter((designation) => (
        firstDesignationBusinessCategory(designation.designation_category)?.people_module === "delivery_network"
      ));
      profiles = workforceRecipients.map((recipient) => ({ id: recipient.accountId, onboarding_status: recipient.status, is_active: recipient.isActive }));
      legacyRegistrationCount = workforceRecipients.filter((recipient) => recipient.compatibilityMode).length;
      designationCount = deliveryDesignations.length;
      mappingCount = mappingResult.count ?? 0;
      pendingAdjustmentCount = adjustmentCount.error ? 0 : adjustmentCount.count ?? 0;
      openPayrollCount = payrollCount.error ? 0 : payrollCount.count ?? 0;
    } catch (loadError) {
      error = loadError instanceof Error ? loadError.message : "Unable to load Workforce data.";
    }
  }
  const financeSnapshot = await financeSnapshotPromise;
  error = [error, ...financeSnapshot.warnings, financeSnapshot.setupRequired ? "Finance setup is incomplete; earnings may be partial." : null].filter(Boolean).join(" ") || null;

  const pending = profiles.filter((profile) => !["active", "under_review", "returned", "rejected", "cancelled"].includes(status(profile.onboarding_status))).length;
  const underReview = profiles.filter((profile) => status(profile.onboarding_status) === "under_review").length;
  const active = profiles.filter((profile) => profile.is_active && status(profile.onboarding_status) === "active").length;
  const pipelineTotal = Math.max(pending + underReview + active, 1);

  const modules = [
    {
      code: "delivery_associates",
      href: "/delivery-network/onboarding",
      title: "Onboard workforce",
      description: "Create and track delivery, sorting, cleaning, driver and van-operation profiles without entering the HR system.",
      metric: `${pending + underReview} open`,
      icon: UserRoundPlus
    },
    {
      code: "executive_id_onboarding",
      href: "/delivery-network/id-onboarding",
      title: "Provider ID onboarding",
      description: "Close transporter IDs, provider-side activation and station action items.",
      metric: "Provider readiness",
      icon: Fingerprint
    },
    {
      code: "provider_mapping",
      href: "/delivery-network/rate-mapping",
      title: "ID & rate mapping",
      description: "Maintain member IDs, payout methods, delivery rates, guarantees and fuel rates.",
      metric: `${mappingCount} active mappings`,
      icon: WalletCards
    },
    {
      code: "people_review",
      href: "/delivery-network/lifecycle",
      title: "Activation & lifecycle",
      description: "Run Workforce activation checklists, agreements, exits and final settlements.",
      metric: `${active} active`,
      icon: BadgeCheck
    },
    {
      code: "workforce_communications",
      href: "/delivery-network/communications",
      title: "Communication center",
      description: "Send Workforce-only DropX One and WhatsApp communication from a validated recipient directory.",
      metric: "2 channels",
      icon: MessageSquareMore
    },
    {
      code: "workforce_activity",
      href: "/delivery-network/activity",
      title: "Attendance & activity",
      description: "Bring biometric attendance, imported shipment output, productivity and ID exceptions into one daily desk.",
      metric: `${financeSnapshot.totalSourceShipments.toLocaleString("en-IN")} MTD shipments`,
      icon: Activity
    },
    {
      code: "workforce_earnings",
      href: "/delivery-network/earnings",
      title: "Live earnings",
      description: "Calculate every associate's accrual from shipments, effective rates, incentives and approved adjustments.",
      metric: `₹${Math.round(financeSnapshot.totalNet).toLocaleString("en-IN")} MTD`,
      icon: CircleDollarSign
    },
    {
      code: "workforce_incentives",
      href: "/delivery-network/incentives",
      title: "Incentives & rewards",
      description: "Roll out provider, station and designation campaigns with automatic daily reward calculation.",
      metric: `₹${Math.round(financeSnapshot.totalIncentives).toLocaleString("en-IN")} MTD`,
      icon: Gift
    },
    {
      code: "workforce_adjustments",
      href: "/delivery-network/adjustments",
      title: "Ad hoc adjustments",
      description: "Control ID exceptions, one-time additions, reimbursements and recoveries through maker-checker approval.",
      metric: `${pendingAdjustmentCount} pending`,
      icon: WalletCards
    },
    {
      code: "workforce_payroll",
      href: "/delivery-network/payroll",
      title: "Payroll runs",
      description: "Snapshot live earnings, clear holds, approve the payable register and record payout completion.",
      metric: `${openPayrollCount} open`,
      icon: Banknote
    }
  ].filter((module) => hasPermission(authorization, module.code, "access"));
  const lifecycleStages = [
    { code: "delivery_associates", href: "/delivery-network/onboarding", label: "Register & verify", helper: "Profile, documents, bank details and engagement", icon: UserRoundPlus },
    { code: "provider_mapping", href: "/delivery-network/rate-mapping", label: "Activate IDs & rates", helper: "Provider member ID, station and commercial mapping", icon: Fingerprint },
    { code: "workforce_activity", href: "/delivery-network/activity", label: "Run daily workforce", helper: "Attendance, shipments and productivity", icon: Activity },
    { code: "workforce_earnings", href: "/delivery-network/earnings", label: "Calculate earnings", helper: "Base pay and incentive accrual with trace", icon: CircleDollarSign },
    { code: "workforce_adjustments", href: "/delivery-network/adjustments", label: "Control exceptions", helper: "Ad hoc additions and deductions with approval", icon: ShieldCheck },
    { code: "workforce_payroll", href: "/delivery-network/payroll", label: "Approve & pay", helper: "Freeze payroll, export and record payout", icon: Banknote }
  ].filter((stage) => hasPermission(authorization, stage.code, "access"));

  return (
    <AppShell active="Workforce Dashboard" pageCode="delivery_associates">
      <section className="wf-command-header">
        <div>
          <span className="wf-live-status"><i /> Live operations desk</span>
          <h1>Run the full workforce lifecycle</h1>
          <p>Own every operational associate from registration and field activation through daily output, live earnings, incentives, payroll approval and payout.</p>
        </div>
        <div className="wf-command-actions">
          <PendingLink className="wf-command-secondary" href="/delivery-network/associates">
            Open register
          </PendingLink>
          {hasPermission(authorization, "delivery_associates", "add") && !authorization.readOnly ? (
            <PendingLink className="wf-command-primary" href="/delivery-network/onboarding">
              <UserRoundPlus size={17} /> Add workforce
            </PendingLink>
          ) : null}
        </div>
      </section>

      {error ? <section className="panel message-panel error"><div className="panel-body"><strong>Action required</strong><p className="subtle" style={{ marginTop: 6 }}>{error}</p></div></section> : null}

      <section className="wf-command-kpis" aria-label="Workforce status summary">
        <article>
          <span className="orange"><Clock3 size={17} /></span>
          <div><small>Awaiting registration</small><strong>{pending}</strong></div>
        </article>
        <article>
          <span className="rose"><ShieldCheck size={17} /></span>
          <div><small>Ready for review</small><strong>{underReview}</strong></div>
        </article>
        <article>
          <span className="green"><BadgeCheck size={17} /></span>
          <div><small>Field active</small><strong>{active}</strong></div>
        </article>
        <article>
          <span className="navy"><Fingerprint size={17} /></span>
          <div><small>Active ID mappings</small><strong>{mappingCount}</strong></div>
        </article>
      </section>

      {hasPermission(authorization, "workforce_earnings", "access") ? <section className="wf-finance-kpis dashboard" aria-label="Workforce earnings summary">
        <article><span><CircleDollarSign size={18} /></span><small>MTD live earnings</small><strong>₹{Math.round(financeSnapshot.totalNet).toLocaleString("en-IN")}</strong><em>Estimated until payroll approval</em></article>
        <article><span><Activity size={18} /></span><small>MTD shipments</small><strong>{Math.round(financeSnapshot.totalSourceShipments).toLocaleString("en-IN")}</strong><em>{financeSnapshot.sourceRowCount.toLocaleString("en-IN")} daily source rows</em></article>
        <article><span><BadgeCheck size={18} /></span><small>Pay ready</small><strong>{financeSnapshot.readyWorkers}</strong><em>{financeSnapshot.heldWorkers} associates on hold</em></article>
        <article className={financeSnapshot.exceptions.length ? "attention" : "healthy"}><span><ShieldCheck size={18} /></span><small>Earning exceptions</small><strong>{financeSnapshot.exceptions.length}</strong><em>Unmapped IDs or missing rates</em></article>
      </section> : null}

      <section className="wf-lifecycle-map">
        <header><div><small>360° operating model</small><h2>One controlled workforce lifecycle</h2></div><span>{lifecycleStages.length} permission-aware stages</span></header>
        <div>
          {lifecycleStages.map((stage, index) => {
            const StageIcon = stage.icon;
            return <PendingLink href={stage.href} key={stage.label}>
              <span className="wf-lifecycle-index">{index + 1}</span>
              <span className="wf-lifecycle-icon"><StageIcon size={16} /></span>
              <strong>{stage.label}</strong>
              <small>{stage.helper}</small>
            </PendingLink>;
          })}
        </div>
      </section>

      <div className="wf-command-board">
        <section className="wf-command-panel wf-pipeline-panel">
          <header>
            <div><span>Registration flow</span><h2>Workforce pipeline</h2></div>
            <small>{pending + underReview + active} tracked</small>
          </header>
          <div className="wf-pipeline-list">
            <article>
              <div><span><CircleDot size={15} /> Registration pending</span><strong>{pending}</strong></div>
              <div className="wf-pipeline-track"><i style={{ width: `${Math.max((pending / pipelineTotal) * 100, pending ? 4 : 0)}%` }} /></div>
              <small>Workforce member action required</small>
            </article>
            <article>
              <div><span><ShieldCheck size={15} /> Workforce review</span><strong>{underReview}</strong></div>
              <div className="wf-pipeline-track"><i style={{ width: `${Math.max((underReview / pipelineTotal) * 100, underReview ? 4 : 0)}%` }} /></div>
              <small>Documents and activation checks</small>
            </article>
            <article>
              <div><span><BadgeCheck size={15} /> Field active</span><strong>{active}</strong></div>
              <div className="wf-pipeline-track"><i style={{ width: `${Math.max((active / pipelineTotal) * 100, active ? 4 : 0)}%` }} /></div>
              <small>Ready for operations</small>
            </article>
          </div>
          <footer>{legacyRegistrationCount} migrated registrations remain protected during the transition.</footer>
        </section>

        <section className="wf-command-panel wf-desk-panel">
          <header>
            <div><span>Work queue</span><h2>Open the right desk</h2></div>
          </header>
          <div className="wf-desk-actions">
            <PendingLink href="/delivery-network/onboarding">
              <span><UserRoundPlus size={18} /></span>
              <div><strong>Registration desk</strong><small>{pending + underReview} applications need progress</small></div>
              <ArrowRight size={17} />
            </PendingLink>
            {hasPermission(authorization, "executive_id_onboarding", "access") ? <PendingLink href="/delivery-network/id-onboarding">
              <span><Fingerprint size={18} /></span>
              <div><strong>Provider ID desk</strong><small>Complete transporter and provider activation</small></div>
              <ArrowRight size={17} />
            </PendingLink> : null}
            {hasPermission(authorization, "provider_mapping", "access") ? <PendingLink href="/delivery-network/rate-mapping">
              <span><WalletCards size={18} /></span>
              <div><strong>Rate readiness</strong><small>{mappingCount} active payout mappings</small></div>
              <ArrowRight size={17} />
            </PendingLink> : null}
            {hasPermission(authorization, "workforce_earnings", "access") ? <PendingLink href="/delivery-network/earnings">
              <span><CircleDollarSign size={18} /></span>
              <div><strong>Live earnings desk</strong><small>{financeSnapshot.heldWorkers + financeSnapshot.exceptions.length} blockers before payroll</small></div>
              <ArrowRight size={17} />
            </PendingLink> : null}
            {hasPermission(authorization, "workforce_payroll", "access") ? <PendingLink href="/delivery-network/payroll">
              <span><Banknote size={18} /></span>
              <div><strong>Payroll desk</strong><small>{openPayrollCount} draft or review runs</small></div>
              <ArrowRight size={17} />
            </PendingLink> : null}
          </div>
        </section>
      </div>

      <section className="wf-workspace-directory">
        <header>
          <div><span>Workforce tools</span><h2>Operational workspaces</h2></div>
          {hasPermission(authorization, "designations", "access") ? (
            <PendingLink href="/delivery-network/designations">Configure {designationCount} designations <ArrowRight size={15} /></PendingLink>
          ) : null}
        </header>
        <div className="wf-workspace-rows">
          {modules.map((module, index) => {
            const ModuleIcon = module.icon;
            return (
              <PendingLink href={module.href} key={module.href}>
                <span className="wf-workspace-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="wf-workspace-icon"><ModuleIcon size={18} /></span>
                <span className="wf-workspace-copy"><strong>{module.title}</strong><small>{module.description}</small></span>
                <span className="wf-workspace-metric">{module.metric}</span>
                <ArrowRight size={17} />
              </PendingLink>
            );
          })}
        </div>
      </section>
    </AppShell>
  );
}
