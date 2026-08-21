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
  const rules = Object.fromEntries(appNotificationEvents.map((eventCode) => [eventCode, {
    bodyTemplate: appNotificationDefaults[eventCode].bodyTemplate,
    enabled: true,
    titleTemplate: appNotificationDefaults[eventCode].titleTemplate
  }])) as Record<AppNotificationEvent, { bodyTemplate: string; enabled: boolean; titleTemplate: string }>;
  if (!supabaseAdmin) {
    return { rules, error: "Supabase service role key is not configured." };
  }

  const result = await supabaseAdmin
    .from("mob_app_notification_rules")
    .select("event_code, enabled, title_template, body_template")
    .eq("company_id", companyId)
    .in("event_code", appNotificationEvents);
  if (result.error) return { rules, error: result.error.message };

  for (const row of result.data ?? []) {
    const eventCode = row.event_code as AppNotificationEvent;
    if (appNotificationEvents.includes(eventCode)) {
      rules[eventCode] = {
        bodyTemplate: String(row.body_template ?? rules[eventCode].bodyTemplate),
        enabled: row.enabled !== false,
        titleTemplate: String(row.title_template ?? rules[eventCode].titleTemplate)
      };
    }
  }
  return { rules, error: null as string | null };
}

const variableHelp: Partial<Record<AppNotificationEvent, string>> = {
  attendance_punch_in: "Variables: {time}, {date}, {punch_count}, {work_duration}",
  attendance_punch_out: "Variables: {time}, {date}, {punch_count}, {work_duration}",
  attendance_late_in: "Variables: {time}, {date}, {late_minutes}",
  attendance_early_out: "Variables: {time}, {date}, {early_minutes}, {work_duration}",
  attendance_half_day: "Variables: {time}, {date}, {work_duration}, {outcome}",
  attendance_short_day: "Variables: {time}, {date}, {work_duration}, {outcome}, {payable_percent}",
  attendance_overtime: "Variables: {time}, {date}, {work_duration}, {overtime_minutes}, {outcome}",
  attendance_exception_review: "Variables: {time}, {date}, {work_duration}, {outcome}"
};

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
            <div className="app-notification-rule-list">
              {appNotificationEvents.map((eventCode) => (
                <article className="app-notification-rule" key={eventCode}>
                  <label className="app-notification-rule-toggle">
                    <span><strong>{appNotificationDefaults[eventCode].label}</strong><small>{eventCode}</small></span>
                    <input defaultChecked={settings.rules[eventCode].enabled} disabled={!permission.canEdit && !permission.canAdd} name={`${eventCode}_enabled`} type="checkbox" />
                  </label>
                  <label><span>Notification title</span><input defaultValue={settings.rules[eventCode].titleTemplate} disabled={!permission.canEdit && !permission.canAdd} maxLength={120} minLength={1} name={`${eventCode}_title`} required /></label>
                  <label><span>Notification message</span><textarea defaultValue={settings.rules[eventCode].bodyTemplate} disabled={!permission.canEdit && !permission.canAdd} maxLength={1000} minLength={1} name={`${eventCode}_body`} required rows={2} /></label>
                  {variableHelp[eventCode] ? <small className="app-notification-variable-help">{variableHelp[eventCode]}</small> : null}
                </article>
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
