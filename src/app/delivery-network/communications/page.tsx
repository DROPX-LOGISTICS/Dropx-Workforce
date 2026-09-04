import { readAllRows } from "@/lib/supabase-pagination";
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
  const canReadHistory = hasPermission(authorization, "workforce_communications_history", "access");
  const [appHistory, whatsAppHistory, campaignRecipients] = supabaseAdmin && canReadHistory ? await Promise.all([
    readAllRows(supabaseAdmin.from("mob_app_notifications").select("id,recipient_profile_type,recipient_account_id").eq("company_id", companyId).eq("event_code", "workforce_manual").order("id")),
    readAllRows(supabaseAdmin.from("whatsapp_campaigns").select("id").eq("company_id", companyId).eq("source_mode", "workforce").order("id")),
    authorization.hasAllLocationAccess ? Promise.resolve({ data: [], error: null }) : readAllRows(supabaseAdmin.from("whatsapp_campaign_recipients").select("id,campaign_id,source_id").eq("company_id", companyId).order("id"))
  ]) : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
  const allowed = new Set(recipients.map((recipient) => `${recipient.profileType}:${recipient.accountId}`));
  const visibleCampaignIds = new Set((campaignRecipients.data ?? []).filter((row) => allowed.has(row.source_id)).map((row) => row.campaign_id));
  const activityCount = (appHistory.data ?? []).filter((row) => authorization.hasAllLocationAccess || allowed.has(`${row.recipient_profile_type}:${row.recipient_account_id}`)).length
    + (whatsAppHistory.data ?? []).filter((row) => authorization.hasAllLocationAccess || visibleCampaignIds.has(row.id)).length;
  const activityError = appHistory.error || whatsAppHistory.error || campaignRecipients.error;
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
        <article><span>Communication activity</span><strong>{!canReadHistory || activityError ? "—" : activityCount}</strong><small>{activityError ? "History is temporarily unavailable" : canReadHistory ? "Inbox records and campaigns in your scope" : "History access required"}</small></article>
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
