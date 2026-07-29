import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import {
  appNotificationDefaults,
  appNotificationEvents,
  type AppNotificationEvent
} from "@/lib/app-notifications";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { saveAppNotificationSettings } from "./actions";

export const dynamic = "force-dynamic";

async function loadSettings(companyId: string) {
  const enabled = Object.fromEntries(
    appNotificationEvents.map((eventCode) => [eventCode, true])
  ) as Record<AppNotificationEvent, boolean>;
  if (!supabaseAdmin) {
    return { enabled, error: "Supabase service role key is not configured." };
  }

  const result = await supabaseAdmin
    .from("mob_app_notification_rules")
    .select("event_code, enabled")
    .eq("company_id", companyId)
    .in("event_code", appNotificationEvents);
  if (result.error) return { enabled, error: result.error.message };

  for (const row of result.data ?? []) {
    const eventCode = row.event_code as AppNotificationEvent;
    if (appNotificationEvents.includes(eventCode)) {
      enabled[eventCode] = row.enabled !== false;
    }
  }
  return { enabled, error: null as string | null };
}

export default async function AppNotificationSettingsPage({
  searchParams
}: {
  searchParams?: { error?: string; saved?: string };
}) {
  const authorization = await requirePagePermission("app_settings", "access");
  const companyId = requireCompanyId(authorization);
  const permission = authorization.permissions.app_settings;
  const settings = await loadSettings(companyId);
  const error = searchParams?.error ?? settings.error;

  return (
    <AppShell active="Settings" pageCode="app_settings">
      <PageHead
        eyebrow="Configuration"
        title="App Notification"
        subtitle="Choose the events that notify DropX One users."
      />
      {searchParams?.saved === "1" ? <div className="success-banner">App notification settings saved.</div> : null}
      {error ? (
        <section className="panel message-panel error">
          <div className="panel-body">
            <strong>Action required</strong>
            <p className="subtle" style={{ marginTop: 6 }}>
              {error} Run scripts/mob_app_notifications_v1.sql in Supabase SQL Editor.
            </p>
          </div>
        </section>
      ) : (
        <section className="panel app-notification-settings">
          <form action={saveAppNotificationSettings}>
            <div className="app-notification-checklist">
              <label>
                <span>Punch</span>
                <input
                  defaultChecked={
                    settings.enabled.attendance_punch_in &&
                    settings.enabled.attendance_punch_out
                  }
                  disabled={!permission.canEdit && !permission.canAdd}
                  name="attendance_punch"
                  type="checkbox"
                />
              </label>
              {appNotificationEvents.filter(
                (eventCode) => eventCode !== "attendance_punch_in" &&
                  eventCode !== "attendance_punch_out"
              ).map((eventCode) => (
                <label key={eventCode}>
                  <span>{appNotificationDefaults[eventCode].label}</span>
                  <input
                    defaultChecked={settings.enabled[eventCode]}
                    disabled={!permission.canEdit && !permission.canAdd}
                    name={eventCode}
                    type="checkbox"
                  />
                </label>
              ))}
            </div>
            {permission.canEdit || permission.canAdd ? (
              <div className="form-actions">
                <button type="submit">Save settings</button>
              </div>
            ) : null}
          </form>
        </section>
      )}
    </AppShell>
  );
}
