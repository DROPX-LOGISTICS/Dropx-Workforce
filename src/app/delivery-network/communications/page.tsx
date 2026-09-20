import { readAllRows } from "@/lib/supabase-pagination";
import { ArrowRight, BellRing, MessageCircleMore, ShieldCheck } from "lucide-react";
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
  const [appHistory, whatsAppHistory, campaignRecipients, supportCount] = supabaseAdmin && canReadHistory ? await Promise.all([
    readAllRows(supabaseAdmin.from("mob_app_notifications").select("id,recipient_profile_type,recipient_account_id").eq("company_id", companyId).eq("event_code", "workforce_manual").order("id")),
    readAllRows(supabaseAdmin.from("whatsapp_campaigns").select("id").eq("company_id", companyId).eq("source_mode", "workforce").order("id")),
    authorization.hasAllLocationAccess ? Promise.resolve({ data: [], error: null }) : readAllRows(supabaseAdmin.from("whatsapp_campaign_recipients").select("id,campaign_id,source_id").eq("company_id", companyId).order("id")),
    supabaseAdmin.from("workforce_connect_requests").select("id", { count: "exact", head: true }).eq("company_id", companyId).neq("category", "speak_up").in("status", ["open", "in_review"])
  ]) : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }, { count: null, error: null }];
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
      title: "Company updates",
      description: "Publish targeted DropX One notices for stations, designations and payout programmes.",
      icon: BellRing
    },
    {
      code: "workforce_communications",
      href: "/delivery-network/connect",
      title: "Workforce support desk",
      description: "Own, respond to and close associate requests without exposing confidential reports.",
      icon: MessageCircleMore
    },
    {
      code: "workforce_speak_up",
      href: "/delivery-network/speak-up",
      title: "Confidential Speak Up",
      description: "Restricted review desk for safety, conduct and wrongdoing reports from Workforce associates.",
      icon: ShieldCheck
    }
  ].filter((channel) => hasPermission(authorization, channel.code, "access"));

  return (
    <AppShell active="Workforce Connect Centre" pageCode="workforce_communications">
      <PageHead
        eyebrow="Workforce operations"
        title="Workforce Connect Centre"
        subtitle="The operations communication desk for the field network: publish updates, resolve associate support and safeguard confidential reports."
      />

      <section className="performance-summary-grid wf-connect-metrics">
        <article><span>Total workforce</span><strong>{recipients.length}</strong><small>Defined by the designation master</small></article>
        <article><span>Active workforce</span><strong>{active}</strong><small>Currently active profiles</small></article>
        <article><span>WhatsApp ready</span><strong>{reachable}</strong><small>Profiles with a mobile number</small></article>
        <article><span>Open support</span><strong>{supportCount.error ? "—" : supportCount.count ?? 0}</strong><small>{supportCount.error ? "Support queue is temporarily unavailable" : "Associate requests awaiting action"}</small></article>
      </section>

      <section className="wf-connect-workstreams" aria-label="Workforce Connect Centre workstreams">
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

      <section className="panel wf-connect-boundary">
        <div className="panel-head">
          <div><h2>Workforce-only operating boundary</h2><p className="subtle">This centre targets Workforce designations and routes their conversations to field operations; People, HR and manager conversations stay in their own product.</p></div>
        </div>
        <div className="panel-body">
          <p className="subtle">Only profiles whose designation category belongs to Workforce are available here. The support desk uses station scope. Speak Up is separate and requires an explicit permission, so its reports are never visible in the regular support queue.</p>
        </div>
      </section>
    </AppShell>
  );
}
