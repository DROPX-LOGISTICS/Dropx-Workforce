import { AppNotificationComposer, type AppNotificationRecipient } from "@/components/app-notification-composer";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { loadWorkforceCommunicationRecipients } from "@/lib/workforce-communication-recipients";
import { sendWorkforceAppNotification } from "./actions";

export const dynamic = "force-dynamic";

export default async function WorkforceDropXOnePage({
  searchParams
}: {
  searchParams?: { sent?: string; error?: string };
}) {
  const authorization = await requirePagePermission("workforce_communications_app", "access");
  const recipients = await loadWorkforceCommunicationRecipients(authorization);
  const composerRecipients: AppNotificationRecipient[] = recipients.map((recipient) => ({
    id: recipient.accountId,
    profileType: recipient.profileType,
    name: recipient.name,
    reference: recipient.reference,
    biometricId: recipient.biometricId,
    category: recipient.category,
    location: recipient.location,
    designation: recipient.designation,
    mobile: recipient.mobile,
    countryCode: recipient.countryCode,
    email: recipient.email,
    provider: recipient.provider,
    model: recipient.model,
    status: recipient.status
  }));

  return (
    <AppShell active="DropX One Notifications" pageCode="workforce_communications_app">
      <PageHead
        eyebrow="Workforce communications"
        title="DropX One Notifications"
        subtitle="Send inbox and push notifications only to profiles classified as Workforce in the designation master."
      />
      {searchParams?.sent ? <div className="success-banner">{searchParams.sent} {searchParams.sent === "1" ? "notification" : "notifications"} sent.</div> : null}
      {searchParams?.error ? <div className="error-banner">{searchParams.error}</div> : null}
      <section className="app-notification-composer">
        <div><h2>New Workforce notification</h2><p>The notification appears in the selected members&apos; DropX One inbox and supported devices.</p></div>
        <AppNotificationComposer action={sendWorkforceAppNotification} recipients={composerRecipients} />
      </section>
    </AppShell>
  );
}
