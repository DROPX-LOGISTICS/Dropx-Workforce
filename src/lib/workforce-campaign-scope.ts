import type { Campaign, CampaignRecipient } from "@/components/campaign-report";
import type { WorkforceCommunicationRecipient } from "@/lib/workforce-communication-recipients";

export function scopeWorkforceCampaigns(campaigns: Campaign[], recipients: WorkforceCommunicationRecipient[], allLocations: boolean) {
  if (allLocations) return campaigns;
  const allowed = new Set(recipients.map((recipient) => `${recipient.profileType}:${recipient.accountId}`));
  return campaigns.flatMap((campaign) => {
    const visible = (campaign.whatsapp_campaign_recipients ?? []).filter((recipient) =>
      allowed.has((recipient as CampaignRecipient & { source_id?: string }).source_id ?? ""));
    if (!visible.length) return [];
    const pending = visible.filter((recipient) => ["pending", "processing"].includes(recipient.status)).length;
    return [{ ...campaign, whatsapp_campaign_recipients: visible, total_count: visible.length,
      sent_count: visible.filter((recipient) => ["sent", "delivered", "read"].includes(recipient.status)).length,
      failed_count: visible.filter((recipient) => recipient.status === "failed").length,
      pending_count: pending, status: pending ? "processing" : "completed" }];
  });
}
