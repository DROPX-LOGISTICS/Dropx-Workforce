import { AppShell } from "@/components/app-shell";
import { NotificationHistoryPanel } from "@/components/notification-history-panel";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Campaign } from "@/components/campaign-report";

export const dynamic = "force-dynamic";

type CampaignRow = Omit<Campaign, "channel">;

async function loadNotificationHistory(companyId: string) {
  if (!supabaseAdmin) {
    return {
      campaignError: "Supabase service role key is not configured.",
      campaigns: [] as Campaign[]
    };
  }

  const [campaignProfiles, campaigns] = await Promise.all([
    supabaseAdmin.from("whatsapp_profiles").select("id, profile_name").eq("company_id", companyId),
    supabaseAdmin
      .from("whatsapp_campaigns")
      .select("id, campaign_code, whatsapp_profile_id, whatsapp_profile_name, created_at, total_count, sent_count, failed_count, pending_count, status, whatsapp_campaign_recipients (id, row_no, recipient_name, recipient_mobile, country_code, status, provider_message_id, error_message, sent_at, updated_at)")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(100)
  ]);

  const profileNameById = new Map(((campaignProfiles.data ?? []) as Array<{ id: string; profile_name: string }>).map((profile) => [profile.id, profile.profile_name]));
  const campaignSetupMissing = campaigns.error?.message?.includes("whatsapp_campaigns") || campaigns.error?.message?.includes("whatsapp_campaign_recipients");
  const campaignError = campaignProfiles.error?.message
    ?? (campaignSetupMissing ? `${campaigns.error?.message} Run scripts/whatsapp_campaigns_v1.sql in Supabase SQL Editor.` : campaigns.error?.message)
    ?? null;

  return {
    campaignError,
    campaigns: ((campaigns.data ?? []) as CampaignRow[]).map((campaign) => ({
      ...campaign,
      channel: "WhatsApp",
      whatsapp_profile_name: campaign.whatsapp_profile_id ? profileNameById.get(campaign.whatsapp_profile_id) ?? campaign.whatsapp_profile_name : campaign.whatsapp_profile_name,
      whatsapp_campaign_recipients: [...(campaign.whatsapp_campaign_recipients ?? [])].sort((left, right) => left.row_no - right.row_no)
    }))
  };
}

export default async function NotificationHistoryPage() {
  const authorization = await requirePagePermission("notifications_history", "access");
  const data = await loadNotificationHistory(requireCompanyId(authorization));

  return (
    <AppShell active="History" pageCode="notifications_history">
      <NotificationHistoryPanel campaignError={data.campaignError} campaigns={data.campaigns} />
    </AppShell>
  );
}
