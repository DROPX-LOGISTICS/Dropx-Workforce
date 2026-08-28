import { ArrowRight, BellRing, History, MessageCircleMore } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { PendingLink } from "@/components/pending-link";
import { hasPermission, requirePagePermission } from "@/lib/authorization";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadWorkforceCommunicationRecipients } from "@/lib/workforce-communication-recipients";

export const dynamic = "force-dynamic";

export default async function WorkforceCommunicationsPage() {
  const authorization = await requirePagePermission("workforce_communications", "access");
  const recipients = await loadWorkforceCommunicationRecipients(authorization);
  const companyId = authorization.companyId!;
  const [appHistory, whatsAppHistory] = supabaseAdmin ? await Promise.all([
    supabaseAdmin.from("mob_app_notifications").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("event_code", "workforce_manual"),
    supabaseAdmin.from("whatsapp_campaigns").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("source_mode", "workforce")
  ]) : [{ count: 0 }, { count: 0 }];
  const active = recipients.filter((recipient) => recipient.isActive).length;
  const reachable = recipients.filter((recipient) => recipient.mobile).length;

  const channels = [
    {
      code: "workforce_communications_app",
      href: "/delivery-network/communications/dropx-one",
      title: "DropX One notifications",
      description: "Send an inbox and push notification to selected Workforce accounts.",
      icon: BellRing
    },
    {
      code: "workforce_communications_whatsapp",
      href: "/delivery-network/communications/whatsapp",
      title: "WhatsApp",
      description: "Send approved WhatsApp templates to master-classified Workforce recipients.",
      icon: MessageCircleMore
    },
    {
      code: "workforce_communications_history",
      href: "/delivery-network/communications/history",
      title: "Communication history",
      description: "Review Workforce-only DropX One delivery and WhatsApp campaign activity.",
      icon: History
    }
  ].filter((channel) => hasPermission(authorization, channel.code, "access"));

  return (
    <AppShell active="Communication Center" pageCode="workforce_communications">
      <PageHead
        eyebrow="Workforce communications"
        title="Communication Center"
        subtitle="Reach delivery, sorting, cleaning, driver and van operations from one Workforce-only recipient directory."
      />

      <section className="performance-summary-grid">
        <article><span>Total workforce</span><strong>{recipients.length}</strong><small>Defined by the designation master</small></article>
        <article><span>Active workforce</span><strong>{active}</strong><small>Currently active profiles</small></article>
        <article><span>WhatsApp ready</span><strong>{reachable}</strong><small>Profiles with a mobile number</small></article>
        <article><span>Communication activity</span><strong>{(appHistory.count ?? 0) + (whatsAppHistory.count ?? 0)}</strong><small>Workforce-only records</small></article>
      </section>

      <section className="wf-communication-links">
        {channels.map((channel) => {
          const ChannelIcon = channel.icon;
          return (
            <PendingLink href={channel.href} key={channel.href}>
              <span><ChannelIcon size={17} /></span>
              <div><strong>{channel.title}</strong><small>{channel.description}</small></div>
              <ArrowRight size={16} />
            </PendingLink>
          );
        })}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div><h2>Recipient isolation</h2><p className="subtle">The list is generated from the designation master, not from HR users or dashboard users.</p></div>
        </div>
        <div className="panel-body">
          <p className="subtle">Only profiles whose designation category belongs to Workforce are available here. Existing DropX One registration identities remain unchanged, so pending invitations and submissions continue without interruption.</p>
        </div>
      </section>
    </AppShell>
  );
}
