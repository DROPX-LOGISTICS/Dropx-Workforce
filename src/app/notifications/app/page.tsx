import { AppShell } from "@/components/app-shell";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  attendanceNotificationDefaults,
  attendanceNotificationEvents,
  type AttendanceNotificationEvent
} from "@/lib/app-notifications";
import { workforceProfileTypes, workforceTable, type WorkforceProfileType } from "@/lib/workforce-profiles";
import { savePunchNotificationSettings, sendAppNotification } from "./actions";

export const dynamic = "force-dynamic";

type Recipient = {
  id: string;
  profileType: WorkforceProfileType;
  name: string;
  reference: string;
};

const profileLabels: Record<WorkforceProfileType, string> = {
  employee: "Employee",
  field_executive: "Field executive",
  contractor: "Independent contractor",
  vendor: "Vendor",
  worker: "Worker"
};

async function loadRecipients(companyId: string) {
  if (!supabaseAdmin) return [] as Recipient[];
  const results = await Promise.all(workforceProfileTypes.map(async (profileType) => {
    const referenceColumn = profileType === "employee" ? "employee_code" : "dropx_id";
    const result = await supabaseAdmin!
      .from(workforceTable(profileType))
      .select(`id, full_name, ${referenceColumn}`)
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("full_name")
      .limit(5000);
    if (result.error) return [] as Recipient[];
    return (result.data ?? []).map((row) => ({
      id: String(row.id),
      profileType,
      name: String(row.full_name ?? "Unnamed"),
      reference: String((row as Record<string, unknown>)[referenceColumn] ?? "")
    }));
  }));
  return results.flat();
}

async function loadHistory(companyId: string) {
  if (!supabaseAdmin) return [];
  const result = await supabaseAdmin
    .from("mob_app_notifications")
    .select("id, event_code, recipient_profile_type, recipient_account_id, title, body, created_at, read_at, push_status")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(100);
  return result.error ? [] : result.data ?? [];
}

async function loadPunchRules(companyId: string) {
  const defaults = Object.fromEntries(attendanceNotificationEvents.map((eventCode) => [
    eventCode,
    {
      body_template: attendanceNotificationDefaults[eventCode].bodyTemplate,
      enabled: true,
      event_code: eventCode,
      title_template: attendanceNotificationDefaults[eventCode].titleTemplate
    }
  ])) as Record<AttendanceNotificationEvent, {
    body_template: string;
    enabled: boolean;
    event_code: AttendanceNotificationEvent;
    title_template: string;
  }>;
  if (!supabaseAdmin) return defaults;

  const result = await supabaseAdmin
    .from("mob_app_notification_rules")
    .select("event_code, enabled, title_template, body_template")
    .eq("company_id", companyId)
    .in("event_code", attendanceNotificationEvents);
  if (result.error) return defaults;
  for (const row of result.data ?? []) {
    const eventCode = row.event_code as AttendanceNotificationEvent;
    if (attendanceNotificationEvents.includes(eventCode)) {
      defaults[eventCode] = {
        body_template: String(row.body_template),
        enabled: row.enabled !== false,
        event_code: eventCode,
        title_template: String(row.title_template)
      };
    }
  }
  return defaults;
}

export default async function AppNotificationsPage({
  searchParams
}: {
  searchParams?: { sent?: string; saved?: string; error?: string };
}) {
  const authorization = await requirePagePermission("notifications_app", "access");
  const companyId = requireCompanyId(authorization);
  const recipients = await loadRecipients(companyId);
  const history = await loadHistory(companyId);
  const punchRules = await loadPunchRules(companyId);
  const recipientByKey = new Map(recipients.map((row) => [`${row.profileType}:${row.id}`, row]));

  return (
    <AppShell active="App Notifications" pageCode="notifications_app">
      <main className="app-notifications-page">
        <header>
          <p>NOTIFICATIONS</p>
          <h1>App notifications</h1>
          <span>Send an in-app message to an individual DropX One account.</span>
        </header>
        {searchParams?.sent === "1" ? <div className="success-banner">Notification sent.</div> : null}
        {searchParams?.saved === "1" ? <div className="success-banner">Punch notification settings saved.</div> : null}
        {searchParams?.error ? <div className="error-banner">{searchParams.error}</div> : null}
        <section className="app-notification-composer app-notification-rules">
          <div>
            <h2>Attendance triggers</h2>
            <p>Send notifications automatically when a biometric punch is recorded.</p>
          </div>
          <form action={savePunchNotificationSettings}>
            {attendanceNotificationEvents.map((eventCode) => {
              const rule = punchRules[eventCode];
              const label = eventCode === "attendance_punch_in" ? "Punch In" : "Punch Out";
              return <fieldset key={eventCode}>
                <legend>{label}</legend>
                <label className="notification-rule-toggle">
                  <input defaultChecked={rule.enabled} name={`${eventCode}_enabled`} type="checkbox" />
                  Enable automatic {label} notification
                </label>
                <label>
                  Title
                  <input defaultValue={rule.title_template} maxLength={120} name={`${eventCode}_title`} required />
                </label>
                <label>
                  Message
                  <textarea defaultValue={rule.body_template} maxLength={1000} name={`${eventCode}_body`} required rows={3} />
                </label>
              </fieldset>;
            })}
            <p className="notification-rule-variables">
              Available variables: <code>{"{time}"}</code> <code>{"{date}"}</code> <code>{"{work_duration}"}</code> <code>{"{punch_count}"}</code>
            </p>
            <button type="submit">Save trigger settings</button>
          </form>
        </section>
        <section className="app-notification-composer">
          <div>
            <h2>New notification</h2>
            <p>The notification appears in both the Android and web inbox.</p>
          </div>
          <form action={sendAppNotification}>
            <label>
              Category
              <select name="profileType" required>
                <option value="">Select category</option>
                {workforceProfileTypes.map((type) => <option key={type} value={type}>{profileLabels[type]}</option>)}
              </select>
            </label>
            <label className="wide">
              Recipient
              <select name="accountId" required>
                <option value="">Select account</option>
                {workforceProfileTypes.map((type) => (
                  <optgroup key={type} label={profileLabels[type]}>
                    {recipients.filter((row) => row.profileType === type).map((row) => (
                      <option key={`${type}:${row.id}`} value={row.id}>
                        {[row.reference, row.name].filter(Boolean).join(" - ")}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label>
              Title
              <input maxLength={120} name="title" placeholder="Notification title" required />
            </label>
            <label>
              Open page
              <select name="route">
                <option value="">No linked page</option>
                <option value="dashboard">Dashboard</option>
                <option value="profile">My Profile</option>
                <option value="attendance">Attendance</option>
                <option value="settings">Settings</option>
              </select>
            </label>
            <label className="wide">
              Message
              <textarea maxLength={1000} name="body" placeholder="Write the notification message" required rows={4} />
            </label>
            <button type="submit">Send notification</button>
          </form>
        </section>
        <section className="app-notification-history">
          <div>
            <h2>Notification history</h2>
            <span>{history.length} latest records</span>
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Sent</th><th>Recipient</th><th>Message</th><th>Inbox</th><th>Push</th></tr></thead>
              <tbody>
                {history.map((row) => {
                  const recipient = recipientByKey.get(`${row.recipient_profile_type}:${row.recipient_account_id}`);
                  return <tr key={row.id}>
                    <td>{new Date(row.created_at).toLocaleString("en-IN")}</td>
                    <td><strong>{recipient?.name ?? "Account"}</strong><small>{recipient?.reference} · {profileLabels[row.recipient_profile_type as WorkforceProfileType] ?? row.recipient_profile_type}</small></td>
                    <td>
                      <strong>{row.title}</strong>
                      <small>{row.body}</small>
                      <small>{row.event_code === "attendance_punch_in" ? "Punch In" : row.event_code === "attendance_punch_out" ? "Punch Out" : "Manual"}</small>
                    </td>
                    <td><span className={row.read_at ? "status-pill read" : "status-pill unread"}>{row.read_at ? "Read" : "Unread"}</span></td>
                    <td><span className="status-pill neutral">{row.push_status === "not_configured" ? "Inbox only" : row.push_status}</span></td>
                  </tr>;
                })}
                {!history.length ? <tr><td colSpan={5}>No app notifications have been sent.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </AppShell>
  );
}
