import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { PendingLink } from "@/components/pending-link";
import { requirePagePermission } from "@/lib/authorization";
export const dynamic = "force-dynamic";

export default async function NotificationTemplatesPage() {
  await requirePagePermission("app_settings", "access");

  return (
    <AppShell active="Settings" pageCode="app_settings">
      <PageHead
        eyebrow="Configuration"
        title="Notification Templates"
        subtitle="Maintain message templates used by automated notifications."
        action={<a className="button secondary" href="/settings">Back</a>}
      />

      <section className="panel">
        <div className="panel-head toolbar">
          <div>
            <h2>Notification channels</h2>
            <p className="subtle">Choose a notification channel, then configure each notification template inside it.</p>
          </div>
        </div>
        <div className="settings-grid">
          <PendingLink className="settings-tile actionable" href="/settings/notification-templates/email">
            <div>
              <h3>Email Notifications</h3>
              <p className="subtle">Configure automated email notification templates.</p>
            </div>
          </PendingLink>
        </div>
      </section>
    </AppShell>
  );
}
