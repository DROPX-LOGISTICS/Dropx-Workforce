import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { SubmitButton } from "@/components/submit-button";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { saveEmailNotificationConfig, sendTestEmailNotification } from "./actions";

type EmailConfigRow = {
  from_name: string | null;
  is_enabled: boolean;
  smtp_from: string | null;
  smtp_host: string | null;
  smtp_pass: string | null;
  smtp_port: number | null;
  smtp_secure: boolean;
  smtp_user: string | null;
};

const defaultConfig: EmailConfigRow = {
  from_name: null,
  is_enabled: false,
  smtp_from: null,
  smtp_host: null,
  smtp_pass: null,
  smtp_port: 587,
  smtp_secure: false,
  smtp_user: null
};

function loadFlash() {
  const raw = cookies().get("dropx_email_config_flash")?.value;
  if (!raw) return { error: null as string | null, notice: null as string | null };
  try {
    const parsed = JSON.parse(raw) as { error?: unknown; notice?: unknown };
    return {
      error: typeof parsed.error === "string" ? parsed.error : null,
      notice: typeof parsed.notice === "string" ? parsed.notice : null
    };
  } catch {
    return { error: null, notice: null };
  }
}

async function loadConfig(companyId: string) {
  if (!supabaseAdmin) return { config: defaultConfig, error: "Supabase service role key is not configured." };
  const result = await supabaseAdmin
    .from("email_notification_settings")
    .select("is_enabled, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, smtp_from, from_name")
    .eq("company_id", companyId)
    .eq("id", true)
    .maybeSingle();
  if (result.error) return { config: defaultConfig, error: result.error.message };
  return { config: (result.data ?? defaultConfig) as EmailConfigRow, error: null as string | null };
}

export const dynamic = "force-dynamic";

export default async function EmailConfigPage() {
  const authorization = await requirePagePermission("app_settings", "access");
  const companyId = requireCompanyId(authorization);
  const permission = authorization.permissions.app_settings;
  const flash = loadFlash();
  const { config, error } = await loadConfig(companyId);
  const encryptionMode = config.smtp_secure ? "ssl" : "tls";

  return (
    <AppShell active="Settings" pageCode="app_settings">
      <PageHead
        eyebrow="Email Notifications"
        title="Email Config"
        subtitle="Configure SMTP settings used by automated email notifications."
        action={<a className="button secondary" href="/settings/notification-templates/email">Back</a>}
      />

      {error ? (
        <section className="panel message-panel error">
          <div className="panel-body">
            <strong>Email config setup needed</strong>
            <p className="subtle" style={{ marginTop: 6 }}>{error} Run `scripts/email_notification_settings_v1.sql` in Supabase SQL Editor.</p>
          </div>
        </section>
      ) : null}

      {!error && (flash.error || flash.notice) ? (
        <section className={`panel message-panel ${flash.error ? "error" : "success"}`}>
          <div className="panel-body">
            <strong>{flash.error ? "Action required" : "Completed"}</strong>
            <p className="subtle" style={{ marginTop: 6 }}>{flash.error ?? flash.notice}</p>
          </div>
        </section>
      ) : null}

      {!error ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>SMTP email config</h2>
              <p className="subtle">Used by all email notification templates.</p>
            </div>
            {config.is_enabled ? <span className="status-pill good">Enabled</span> : <span className="status-pill warn">Disabled</span>}
          </div>
          <form action={saveEmailNotificationConfig} className="form-grid">
            <label className="check-row business-expiry-check full-span">
              <input defaultChecked={config.is_enabled} disabled={!permission.canEdit} name="is_enabled" type="checkbox" />
              <span>Enable custom email config</span>
            </label>
            <label>
              SMTP host
              <input className="field" defaultValue={config.smtp_host ?? ""} disabled={!permission.canEdit} name="smtp_host" placeholder="smtp.example.com" />
            </label>
            <label>
              SMTP port
              <input className="field" defaultValue={String(config.smtp_port ?? 587)} disabled={!permission.canEdit} max={65535} min={1} name="smtp_port" required type="number" />
            </label>
            <label>
              SMTP user
              <input className="field" defaultValue={config.smtp_user ?? ""} disabled={!permission.canEdit} name="smtp_user" placeholder="user@example.com" />
            </label>
            <label>
              SMTP password
              <input className="field" disabled={!permission.canEdit} name="smtp_pass" placeholder={config.smtp_pass ? "Password saved - leave blank to keep" : "Enter SMTP password"} type="password" />
            </label>
            <label>
              From email
              <input className="field" defaultValue={config.smtp_from ?? ""} disabled={!permission.canEdit} name="smtp_from" placeholder="no-reply@example.com" type="email" />
            </label>
            <label>
              From name
              <input className="field" defaultValue={config.from_name ?? ""} disabled={!permission.canEdit} name="from_name" placeholder="DropX Compliance" />
            </label>
            <label>
              SMTP encryption
              <select className="field" defaultValue={encryptionMode} disabled={!permission.canEdit} name="smtp_encryption">
                <option value="tls">TLS</option>
                <option value="ssl">SSL</option>
              </select>
            </label>
            {permission.canEdit ? (
              <div className="form-actions full-span">
                <SubmitButton pendingText="Saving">Save email config</SubmitButton>
              </div>
            ) : null}
          </form>
        </section>
      ) : null}

      {!error ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Test email</h2>
              <p className="subtle">Send a test using the active email configuration.</p>
            </div>
          </div>
          <form action={sendTestEmailNotification} className="form-grid">
            <label>
              To
              <input className="field" disabled={!permission.canEdit} name="test_to" placeholder="name@example.com" required />
            </label>
            <label>
              Subject
              <input className="field" defaultValue="DropX test email" disabled={!permission.canEdit} name="test_subject" required />
            </label>
            <label className="full-span">
              Email body
              <textarea className="field notification-template-body" defaultValue={"This is a test email from DropX email notifications."} disabled={!permission.canEdit} name="test_body" required />
            </label>
            {permission.canEdit ? (
              <div className="form-actions full-span">
                <SubmitButton className="button secondary" pendingText="Sending">Send test email</SubmitButton>
              </div>
            ) : null}
          </form>
        </section>
      ) : null}
    </AppShell>
  );
}
