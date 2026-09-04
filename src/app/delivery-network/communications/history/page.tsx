import { scopeWorkforceCampaigns } from "@/lib/workforce-campaign-scope";
import { AppShell } from "@/components/app-shell";
import type { Campaign } from "@/components/campaign-report";
import { NotificationHistoryPanel } from "@/components/notification-history-panel";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { formatDashboardDateTime } from "@/lib/date-format";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadWorkforceCommunicationRecipients } from "@/lib/workforce-communication-recipients";

export const dynamic = "force-dynamic";

export default async function WorkforceCommunicationHistoryPage() {
  const authorization = await requirePagePermission("workforce_communications_history", "access");
  const recipients = await loadWorkforceCommunicationRecipients(authorization);
  const companyId = authorization.companyId!;
  const recipientByKey = new Map(recipients.map((recipient) => [`${recipient.profileType}:${recipient.accountId}`, recipient]));

  const [appNotifications, campaignProfiles, whatsAppCampaigns] = supabaseAdmin ? await Promise.all([
    supabaseAdmin
      .from("mob_app_notifications")
      .select("id, recipient_profile_type, recipient_account_id, title, body, created_at, read_at, push_status")
      .eq("company_id", companyId)
      .eq("event_code", "workforce_manual")
      .order("created_at", { ascending: false })
      .limit(100),
    supabaseAdmin.from("whatsapp_profiles").select("id, profile_name").eq("company_id", companyId),
    supabaseAdmin
      .from("whatsapp_campaigns")
      .select("id, campaign_code, whatsapp_profile_id, whatsapp_profile_name, created_at, total_count, sent_count, failed_count, pending_count, status, whatsapp_campaign_recipients (id, source_id, row_no, recipient_name, recipient_mobile, country_code, status, provider_message_id, error_message, sent_at, updated_at)")
      .eq("company_id", companyId)
      .eq("source_mode", "workforce")
      .order("created_at", { ascending: false })
      .limit(100)
  ]) : [{ data: [], error: { message: "Supabase service role key is not configured." } }, { data: [], error: null }, { data: [], error: null }];
  if (!authorization.hasAllLocationAccess) appNotifications.data = (appNotifications.data ?? []).filter((row) => recipientByKey.has(`${row.recipient_profile_type}:${row.recipient_account_id}`));
  const profileNameById = new Map((campaignProfiles.data ?? []).map((profile) => [profile.id, profile.profile_name]));
  const campaigns = scopeWorkforceCampaigns((whatsAppCampaigns.data ?? []) as unknown as Campaign[], recipients, authorization.hasAllLocationAccess).map((campaign) => ({
    ...campaign,
    channel: "WhatsApp",
    whatsapp_profile_name: campaign.whatsapp_profile_id
      ? profileNameById.get(campaign.whatsapp_profile_id) ?? campaign.whatsapp_profile_name
      : campaign.whatsapp_profile_name,
    whatsapp_campaign_recipients: [...(campaign.whatsapp_campaign_recipients ?? [])].sort((left, right) => left.row_no - right.row_no)
  }));

  return (
    <AppShell active="Communication History" pageCode="workforce_communications_history">
      <PageHead
        eyebrow="Workforce communications"
        title="Communication History"
        subtitle="Workforce-only DropX One and WhatsApp activity. Main-dashboard and HR communications are not shown."
      />

      <section className="app-notification-history">
        <div><h2>DropX One history</h2><span>{appNotifications.data?.length ?? 0} latest records</span></div>
        {appNotifications.error ? <div className="error-banner">{appNotifications.error.message}</div> : null}
        <div className="table-scroll">
          <table>
            <thead><tr><th>Sent</th><th>Recipient</th><th>Message</th><th>Inbox</th><th>Push</th></tr></thead>
            <tbody>
              {(appNotifications.data ?? []).map((row) => {
                const recipient = recipientByKey.get(`${row.recipient_profile_type}:${row.recipient_account_id}`);
                return (
                  <tr key={row.id}>
                    <td>{formatDashboardDateTime(row.created_at)}</td>
                    <td><strong>{recipient?.name ?? "Workforce account"}</strong><small>{recipient?.reference || recipient?.designation || "-"}</small></td>
                    <td><strong>{row.title}</strong><small>{row.body}</small></td>
                    <td><span className={row.read_at ? "status-pill read" : "status-pill unread"}>{row.read_at ? "Read" : "Unread"}</span></td>
                    <td><span className="status-pill neutral">{row.push_status === "not_configured" ? "Inbox only" : row.push_status}</span></td>
                  </tr>
                );
              })}
              {!appNotifications.data?.length ? <tr><td colSpan={5}>No Workforce DropX One notifications have been sent.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <NotificationHistoryPanel
        campaignError={whatsAppCampaigns.error?.message ?? campaignProfiles.error?.message ?? null}
        campaigns={campaigns}
        emptyMessage="No Workforce WhatsApp campaigns found for this period."
        subtitle="Only campaigns created from the Workforce recipient directory are shown."
        title="WhatsApp history"
      />
    </AppShell>
  );
}
