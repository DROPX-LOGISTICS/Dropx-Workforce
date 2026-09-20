import { AlertTriangle, ArrowRight, BadgeCheck, Fingerprint, WalletCards } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PendingLink } from "@/components/pending-link";
import { hasPermission, requirePagePermission } from "@/lib/authorization";
import { loadWorkforceCommunicationRecipients } from "@/lib/workforce-communication-recipients";
import { loadWorkforceEarnings, workforceToday } from "@/lib/workforce-earnings";

export const dynamic = "force-dynamic";

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function WorkforceAttentionPage() {
  const authorization = await requirePagePermission("delivery_associates", "access");
  const today = workforceToday();
  const monthStart = `${today.slice(0, 8)}01`;
  const canReadEarnings = hasPermission(authorization, "workforce_earnings", "access");
  const [recipients, earnings] = await Promise.all([
    loadWorkforceCommunicationRecipients(authorization),
    canReadEarnings ? loadWorkforceEarnings(authorization, monthStart, today) : Promise.resolve(null)
  ]);
  const onboarding = recipients.filter((person) => !person.isActive && !["rejected", "cancelled"].includes(person.status.toLowerCase()));
  const mappingExceptions = earnings?.exceptions.filter((line) => line.status === "unmapped") ?? [];
  const rateExceptions = earnings?.exceptions.filter((line) => line.status === "missing_rate") ?? [];
  const payoutHolds = earnings?.summaries.filter((summary) => summary.status === "hold") ?? [];
  const queues = [
    {
      count: onboarding.length,
      code: "delivery_associates",
      href: "/delivery-network/onboarding",
      icon: BadgeCheck,
      title: "Complete registration",
      detail: "Profiles waiting for documents, bank details, review or activation.",
      rows: onboarding.slice(0, 4).map((person) => ({ title: person.name, meta: `${person.reference || "DropX ID pending"} · ${person.status}` }))
    },
    {
      count: mappingExceptions.length,
      code: "provider_mapping",
      href: "/delivery-network/rate-mapping",
      icon: Fingerprint,
      title: "Map provider IDs",
      detail: "Shipment rows with a provider ID that is not attributable to a Workforce profile.",
      rows: mappingExceptions.slice(0, 4).map((line) => ({ title: line.providerMemberId || line.workerName, meta: `${line.stationCode || "No station"} · ${line.workDate}` }))
    },
    {
      count: rateExceptions.length,
      code: "workforce_rate_cards",
      href: "/delivery-network/rate-cards",
      icon: WalletCards,
      title: "Assign effective rates",
      detail: "Mapped work that cannot be calculated because an active rate is missing.",
      rows: rateExceptions.slice(0, 4).map((line) => ({ title: line.workerName, meta: `${line.providerMemberId || "No provider ID"} · ${line.workDate}` }))
    },
    {
      count: payoutHolds.length,
      code: "workforce_earnings",
      href: "/delivery-network/earnings?state=hold",
      icon: AlertTriangle,
      title: "Clear payout holds",
      detail: "Calculated earnings that cannot enter a payment run yet.",
      rows: payoutHolds.slice(0, 4).map((summary) => ({ title: summary.workerName, meta: summary.holdReasons.join(" · ") || "Review required" }))
    }
  ].filter((queue) => hasPermission(authorization, queue.code, "access"));
  const total = queues.reduce((sum, queue) => sum + queue.count, 0);

  return <AppShell active="Need Attention" pageCode="delivery_associates">
    <section className="wf-finance-hero compact"><div><span>Decision queue</span><h1>Need attention</h1><p>One priority queue for work that blocks associate activation, attributable earnings, or payment. Resolve the issue once at its source—nothing is duplicated here.</p></div><div className="wf-finance-actions"><PendingLink className="wf-command-secondary" href="/delivery-network/reports?report=exceptions">Download exceptions</PendingLink></div></section>
    <section className="wf-finance-kpis mini"><article><span><AlertTriangle size={18} /></span><small>Open blockers</small><strong>{total}</strong><em>Across profile, mapping, rates and payout</em></article><article><span><Fingerprint size={18} /></span><small>Mapping blockers</small><strong>{mappingExceptions.length}</strong><em>Provider IDs need attribution</em></article><article><span><WalletCards size={18} /></span><small>Payment blockers</small><strong>{rateExceptions.length + payoutHolds.length}</strong><em>Rate or payout readiness issue</em></article></section>
    <section className="wf-attention-grid">
      {queues.map((queue) => { const Icon = queue.icon; return <article className={queue.count ? "open" : "clear"} key={queue.title}><header><span><Icon size={18} /></span><div><small>{queue.count ? `${queue.count} to resolve` : "All clear"}</small><h2>{queue.title}</h2></div><PendingLink href={queue.href} aria-label={`Open ${queue.title}`}><ArrowRight size={16} /></PendingLink></header><p>{queue.detail}</p><div>{queue.rows.length ? queue.rows.map((row) => <PendingLink href={queue.href} key={`${row.title}:${row.meta}`}><strong>{row.title}</strong><small>{row.meta}</small></PendingLink>) : <span className="wf-attention-empty">No action is waiting in this queue.</span>}</div><PendingLink className="wf-attention-cta" href={queue.href}>Open queue <ArrowRight size={14} /></PendingLink></article>; })}
    </section>
  </AppShell>;
}
