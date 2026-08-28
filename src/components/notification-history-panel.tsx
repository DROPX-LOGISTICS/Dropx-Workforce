"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CampaignReport, type Campaign } from "@/components/campaign-report";

export function NotificationHistoryPanel({
  campaignError,
  campaigns,
  emptyMessage = "No notification campaigns found for this period.",
  subtitle = "Track WhatsApp campaign history here. Instagram and Facebook campaigns can use this same report when added.",
  title = "Notification history"
}: {
  campaignError: string | null;
  campaigns: Campaign[];
  emptyMessage?: string;
  subtitle?: string;
  title?: string;
}) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const refreshedOnOpen = useRef(false);

  function refreshHistory() {
    startRefresh(() => router.refresh());
  }

  useEffect(() => {
    if (refreshedOnOpen.current) return;
    refreshedOnOpen.current = true;
    refreshHistory();
  }, []);

  return (
    <CampaignReport
      campaignError={campaignError}
      campaigns={campaigns}
      compactRecipients
      emptyMessage={emptyMessage}
      isRefreshing={isRefreshing}
      onRefresh={refreshHistory}
      recipientIdentifierLabel="User ID"
      showChannel
      subtitle={subtitle}
      title={title}
    />
  );
}
