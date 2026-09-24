import { Activity, ArrowRight, BadgeCheck, Banknote, CircleDollarSign, Clock3, Fingerprint, Gift, MessageSquareMore, ShieldCheck, UserRoundPlus, WalletCards } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PendingLink } from "@/components/pending-link";
import { hasPermission, requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { firstDesignationBusinessCategory } from "@/lib/designation-business-categories";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadWorkforceCommunicationRecipients } from "@/lib/workforce-communication-recipients";
import { calculateWorkforceEarnings, loadWorkforceEarnings, workforceToday } from "@/lib/workforce-earnings";
import {loadWorkforceJoining} from '@/lib/workforce-joining-data';
import {workforceOverview} from '@/lib/workforce-overview';
import {WorkforceJourneySummary} from '@/components/workforce-journey-summary';

export const dynamic = "force-dynamic";

export default async function DeliveryNetworkPage() {
  const authorization = await requirePagePermission("delivery_associates", "access");
  const companyId = requireCompanyId(authorization);
  let overview:ReturnType<typeof workforceOverview>|null=null;
  let journeyError='';
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
      const [workforceRecipients, designationResult, mappingResult, adjustmentCount, payrollCount, joining] = await Promise.all([
        loadWorkforceCommunicationRecipients(authorization).catch((cause) => { error = cause instanceof Error ? cause.message : "Workforce register is unavailable."; return []; }),
        supabaseAdmin
          .from("designations")
          .select("id, name, designation_category:designation_categories!designations_designation_category_id_fkey(id, code, name, people_module, is_active)")
          .eq("company_id", companyId)
          .eq("is_active", true),
        mappingQuery,
        authorization.hasAllLocationAccess && hasPermission(authorization, "workforce_adjustments", "access") ? supabaseAdmin.from("workforce_adjustments").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "pending") : Promise.resolve({ count: null, error: null }),
        authorization.hasAllLocationAccess && hasPermission(authorization, "workforce_payroll", "access") ? supabaseAdmin.from("workforce_payroll_runs").select("id", { count: "exact", head: true }).eq("company_id", companyId).in("status", ["draft", "review"]) : Promise.resolve({ count: null, error: null }),
        loadWorkforceJoining(authorization,{to:today}).catch(cause=>{journeyError=cause instanceof Error?cause.message:'Joining evidence is unavailable.';return null;})
      ]);
      error = error || designationResult.error?.message || mappingResult.error?.message || null;
      const deliveryDesignations = (designationResult.data ?? []).filter((designation) => (
        firstDesignationBusinessCategory(designation.designation_category)?.people_module === "delivery_network"
      ));
      overview=joining?workforceOverview(joining,today):null;
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
  error = [error, journeyError, ...financeSnapshot.warnings, financeSnapshot.setupRequired ? "Finance setup is incomplete; earnings may be partial." : null].filter(Boolean).join(" ") || null;

  const pending=overview?.needsRegistration??0,underReview=overview?.underReview??0,active=overview?.counts.active??0;
  const joiningOpen=overview?overview.counts.awaiting_arrival+overview.counts.training+overview.counts.awaiting_activation+overview.counts.ready:0;

  const modules = [
    {
      code: "delivery_associates",
      href: "/delivery-network/onboarding",
      title: "Onboard workforce",
      description: "Create and track delivery, sorting, cleaning, driver and van-operation profiles without entering the HR system.",
      metric: overview?`${pending + underReview} open`:'Counts unavailable',
      icon: UserRoundPlus
    },
    {
      code:'delivery_associates',href:'/delivery-network/joining',title:'Joining & training',
      description:'Separate applicants, arrivals, training and own-ID activation using approved terms and biometric evidence.',
      metric:overview?`${joiningOpen} joining`:'Counts unavailable',icon:Clock3
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
      metric: overview?`${active} active`:'Counts unavailable',
      icon: BadgeCheck
    },
    {
      code: "workforce_communications",
      href: "/delivery-network/communications",
      title: "Workforce Connect Centre",
      description: "Target workforce updates, resolve associate support and protect confidential Speak Up reviews.",
      metric: "3 workstreams",
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
    },
    {
      code:'workforce_payroll',href:'/delivery-network/payment-ledger',title:'Associate payment ledger',
      description:'Reconcile recorded payroll, individual Finance outcomes and unposted adjustments without double-counting.',
      metric:'Recorded history',icon:WalletCards
    }
  ].filter((module) => hasPermission(authorization, module.code, "access"));
  const lifecycleStages = [
    {code:'delivery_associates', label:'Register', helper:'Invite, documents & review', href:'/delivery-network/associates?view=joining', icon:UserRoundPlus},
    {code:'delivery_associates', label:'Join & train', helper:'Arrival, training days & agreed pay', href:'/delivery-network/joining', icon:Clock3},
    {code:'executive_id_onboarding', label:'Activate provider ID', helper:'Invitation, verification & course', href:'/delivery-network/id-onboarding', icon:Fingerprint},
    {code:'workforce_activity', label:'Work & deliveries', helper:'Attendance and imported shipments', href:'/delivery-network/activity', icon:Activity},
    {code:'workforce_earnings', label:'Review & pay', helper:'Effective rates, exceptions & payroll', href:'/delivery-network/earnings', icon:WalletCards},
    {code:'people_review', label:'Exit & settle', helper:'Dues, assets & final settlement', href:'/delivery-network/lifecycle?tab=exits', icon:ShieldCheck}
  ].filter(stage=>hasPermission(authorization,stage.code,'access'));


  return (
    <AppShell active="Workforce Dashboard" pageCode="delivery_associates">
      <section className="wf-command-header wf-dashboard-intro">
        <div className="wf-command-intro">
          <span className="wf-live-status"><i /> Workforce operations</span>
          <h1>Workforce today</h1>
          <p>Move associates from registration to settlement. Open a queue to act.</p>
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
          <div><small>Needs registration</small><strong>{overview?pending:'—'}</strong><em>Applicant action / returned details</em></div>
        </article>
        <article>
          <span className="rose"><ShieldCheck size={17} /></span>
          <div><small>Ready for review</small><strong>{overview?underReview:'—'}</strong><em>Documents and activation checks</em></div>
        </article>
        <article>
          <span className="green"><BadgeCheck size={17} /></span>
          <div><small>Active in field</small><strong>{overview?active:'—'}</strong><em>Current lifecycle state</em></div>
        </article>
        <article>
          <span className="navy"><Fingerprint size={17} /></span>
          <div><small>Provider ID mappings</small><strong>{mappingCount}</strong><em>Mappings, not unique people</em></div>
        </article>
      </section>

      <section className="wf-lifecycle-map wf-action-lane" aria-label="Workforce lifecycle actions">
        <header><div><small>Associate lifecycle</small><h2>From first arrival to final settlement</h2></div></header>
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
        <WorkforceJourneySummary overview={overview}/>

        <section className="wf-command-panel wf-desk-panel">
          <header>
            <div><span>Resolve now</span><h2>Priority queues</h2></div>
          </header>
          <div className="wf-desk-actions">
            <PendingLink href="/delivery-network/associates?view=joining&stage=applicant">
              <span><UserRoundPlus size={18} /></span>
              <div><strong>Registration desk</strong><small>{overview?`${pending+underReview} applications need progress`:'Registration counts unavailable'}</small></div>
              <ArrowRight size={17} />
            </PendingLink>
            <PendingLink href="/delivery-network/joining">
              <span><Clock3 size={18}/></span><div><strong>Joining &amp; training desk</strong><small>{overview?`${joiningOpen} profiles between approval and field work`:'Review arrival, training and own-ID activation'}</small></div><ArrowRight size={17}/>
            </PendingLink>
            {hasPermission(authorization, "workforce_earnings", "access") ? <PendingLink href="/delivery-network/earnings">
              <span><CircleDollarSign size={18} /></span>
              <div><strong>Live earnings desk</strong><small>{financeSnapshot.exceptions.length} exceptions · {financeSnapshot.heldWorkers} associates held</small></div>
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
      <details className="wf-workspace-directory"><summary>Additional operational tools</summary><section>
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
      </section></details>
    </AppShell>
  );
}
