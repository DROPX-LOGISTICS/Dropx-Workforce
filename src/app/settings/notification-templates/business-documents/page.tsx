import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { EmailRecipientInput, type EmailRecipientOption } from "@/components/email-recipient-input";
import { PageHead } from "@/components/page-head";
import { SubmitButton } from "@/components/submit-button";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { saveBusinessDocumentNotificationTemplate } from "./actions";

type TemplateRow = {
  body_template: string;
  cc_recipients: string[];
  custom_cc_emails: string[];
  custom_to_emails: string[];
  is_enabled: boolean;
  subject_template: string;
  to_recipients: string[];
};

const defaultTemplate: TemplateRow = {
  cc_recipients: [],
  custom_cc_emails: [],
  custom_to_emails: [],
  is_enabled: false,
  to_recipients: ["compliance_manager", "location_email", "location_manager"],
  subject_template: "{{reminder_stage}}: {{document_name}} for {{scope_code}}",
  body_template: `Dear Team,

The following business document requires attention.

Document: {{document_name}}
Scope: {{scope_code}}
Reference No: {{reference_no}}
Expiry Date: {{expiry_date}}
{{reminder_line}}

Regards,
DropX Compliance System`
};

function loadFlash() {
  const raw = cookies().get("dropx_notification_templates_flash")?.value;
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

async function loadTemplate(companyId: string) {
  if (!supabaseAdmin) return { template: defaultTemplate, error: "Supabase service role key is not configured." };
  const result = await supabaseAdmin
    .from("business_document_notification_templates")
    .select("is_enabled, to_recipients, cc_recipients, custom_to_emails, custom_cc_emails, subject_template, body_template")
    .eq("company_id", companyId)
    .eq("id", true)
    .maybeSingle();
  if (result.error) return { template: defaultTemplate, error: result.error.message };
  return { template: (result.data ?? defaultTemplate) as TemplateRow, error: null as string | null };
}

async function loadUserOptions(companyId: string): Promise<EmailRecipientOption[]> {
  if (!supabaseAdmin) return [];
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("employee_id, full_name, email, role")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .not("email", "is", null)
    .order("full_name");
  return (data ?? []).map((user) => ({
    email: String(user.email ?? "").trim().toLowerCase(),
    label: user.full_name || user.email || "User",
    helper: [user.employee_id, user.role].filter(Boolean).join(" | ")
  })).filter((user) => user.email.includes("@"));
}

export const dynamic = "force-dynamic";

const recipientOptions = [
  { label: "Compliance manager", value: "compliance_manager" },
  { label: "Location email", value: "location_email" },
  { label: "Location manager", value: "location_manager" }
];

function RecipientCheckboxes({
  disabled,
  name,
  selected
}: {
  disabled: boolean;
  name: string;
  selected: string[];
}) {
  return (
    <div className="notification-recipient-options">
      {recipientOptions.map((option) => (
        <label className="check-row business-expiry-check" key={`${name}-${option.value}`}>
          <input defaultChecked={selected.includes(option.value)} disabled={disabled} name={name} type="checkbox" value={option.value} />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

export default async function BusinessDocumentNotificationsPage() {
  const authorization = await requirePagePermission("app_settings", "access");
  const companyId = requireCompanyId(authorization);
  const permission = authorization.permissions.app_settings;
  const flash = loadFlash();
  const [{ template, error }, userOptions] = await Promise.all([loadTemplate(companyId), loadUserOptions(companyId)]);

  return (
    <AppShell active="Settings" pageCode="app_settings">
      <PageHead
        eyebrow="Email Notifications"
        title="Business document notifications"
        subtitle="Maintain the expiry reminder template used by automated business document emails."
        action={<a className="button secondary" href="/settings/notification-templates/email">Back</a>}
      />

      {error ? (
        <section className="panel message-panel error">
          <div className="panel-body">
            <strong>Template setup needed</strong>
            <p className="subtle" style={{ marginTop: 6 }}>{error} Run `scripts/business_document_notifications_v1.sql` in Supabase SQL Editor.</p>
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
              <h2>Business document expiry email</h2>
              <p className="subtle">Used for 30, 15, 7, 1 day, expiry day, and every 7 days after expiry.</p>
            </div>
            {template.is_enabled ? <span className="status-pill good">Enabled</span> : null}
          </div>
          <form action={saveBusinessDocumentNotificationTemplate} className="notification-template-form">
            <label className="toggle-field">
              <input defaultChecked={template.is_enabled} disabled={!permission.canEdit} name="is_enabled" type="checkbox" />
              <span>Enable business document expiry emails</span>
            </label>
            <div className="settings-subpanel">
              <h3>Recipients</h3>
              <div className="form-grid">
                <div>
                  <label>To</label>
                  <RecipientCheckboxes disabled={!permission.canEdit} name="to_recipients" selected={template.to_recipients ?? defaultTemplate.to_recipients} />
                  <EmailRecipientInput
                    defaultValue={template.custom_to_emails ?? []}
                    disabled={!permission.canEdit}
                    name="custom_to_emails"
                    options={userOptions}
                    placeholder="Search user or enter email"
                  />
                </div>
                <div>
                  <label>CC</label>
                  <RecipientCheckboxes disabled={!permission.canEdit} name="cc_recipients" selected={template.cc_recipients ?? []} />
                  <EmailRecipientInput
                    defaultValue={template.custom_cc_emails ?? []}
                    disabled={!permission.canEdit}
                    name="custom_cc_emails"
                    options={userOptions}
                    placeholder="Search user or enter email"
                  />
                </div>
              </div>
            </div>
            <label>
              Subject
              <input className="field" defaultValue={template.subject_template} disabled={!permission.canEdit} name="subject_template" required />
            </label>
            <label>
              Body
              <textarea className="field notification-template-body" defaultValue={template.body_template} disabled={!permission.canEdit} name="body_template" required />
            </label>
            <div className="settings-subpanel">
              <h3>Available variables</h3>
              <p className="subtle">{"{{document_name}}, {{scope_code}}, {{reference_no}}, {{expiry_date}}, {{days_left}}, {{expired_days}}, {{reminder_stage}}, {{reminder_line}}, {{company_name}}"}</p>
            </div>
            {permission.canEdit ? (
              <div className="form-actions">
                <SubmitButton>Save template</SubmitButton>
              </div>
            ) : null}
          </form>
        </section>
      ) : null}
    </AppShell>
  );
}
