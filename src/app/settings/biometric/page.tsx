import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { SearchableSelect } from "@/components/searchable-select";
import { SubmitButton } from "@/components/submit-button";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";
import { saveBiometricSettings } from "./actions";

export const dynamic = "force-dynamic";

type BiometricSettings = {
  communication_password: string | null;
  communication_password_enabled: boolean | null;
  event_transfer_mode: string | null;
  host_pc_address: string | null;
  host_pc_port: number | null;
  enrolment_start_number: number | null;
  is_enabled: boolean | null;
  middleware_server_ip: string | null;
  notes: string | null;
  webhook_url: string | null;
};

const defaultSettings: BiometricSettings = {
  communication_password: null,
  communication_password_enabled: false,
  event_transfer_mode: "TCP/IP",
  host_pc_address: "bio.dropxlogistics.com",
  host_pc_port: 6010,
  enrolment_start_number: 1,
  is_enabled: true,
  middleware_server_ip: "",
  notes: "",
  webhook_url: "https://dashboard.dropxlogistics.com/api/biometric/punch"
};

function loadFlash() {
  const raw = cookies().get("dropx_biometric_settings_flash")?.value;
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

async function loadSettings(companyId: string) {
  if (!supabaseAdmin) return { settings: defaultSettings, error: "Supabase service role key is not configured." };
  const { data, error } = await supabaseAdmin
    .from("biometric_middleware_settings")
    .select("is_enabled, host_pc_address, host_pc_port, enrolment_start_number, event_transfer_mode, communication_password_enabled, communication_password, middleware_server_ip, webhook_url, notes")
    .eq("company_id", companyId)
    .eq("id", true)
    .maybeSingle();
  if (error) return { settings: defaultSettings, error: error.message };
  return {
    settings: { ...defaultSettings, ...(data ?? {}) } as BiometricSettings,
    error: null as string | null
  };
}

export default async function BiometricSettingsPage() {
  const authorization = await requirePagePermission("app_settings", "access");
  const companyId = requireCompanyId(authorization);
  const permission = authorization.permissions.app_settings;
  const data = await loadSettings(companyId);
  const flash = loadFlash();
  const settings = data.settings;
  const canEdit = permission.canEdit || permission.canAdd;
  const communicationPasswordLabel = settings.communication_password_enabled
    ? settings.communication_password || "Enabled"
    : "No / blank";

  return (
    <AppShell active="Settings" pageCode="app_settings">
      <PageHead
        eyebrow="Configuration"
        title="Biometric"
        subtitle="Configure the single middleware endpoint used by physical attendance devices."
        action={<span className={`status-pill ${isSupabaseAdminConfigured ? "good" : "warn"}`}>{isSupabaseAdminConfigured ? "Database connected" : "Database key missing"}</span>}
      />

      {data.error ? (
        <section className="panel message-panel error">
          <div className="panel-body">
            <strong>Biometric database setup needed</strong>
            <p className="subtle" style={{ marginTop: 6 }}>
              {data.error} Run `scripts/biometric_attendance_upgrade_existing_tables.sql` in Supabase SQL Editor, then refresh this page.
            </p>
          </div>
        </section>
      ) : null}

      {!data.error && (flash.error || flash.notice) ? (
        <section className={`panel message-panel ${flash.error ? "error" : "success"}`}>
          <div className="panel-body">
            <strong>{flash.error ? "Action required" : "Completed"}</strong>
            <p className="subtle" style={{ marginTop: 6 }}>{flash.error ?? flash.notice}</p>
          </div>
        </section>
      ) : null}

      {!data.error ? (
        <section className="split-grid">
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Middleware settings</h2>
                <p className="subtle">These values are shared by all compatible TeamOffice/eTime-style devices.</p>
              </div>
            </div>
            <form action={saveBiometricSettings} className="form-grid two">
              <label className="checkbox-row span-2">
                <input name="is_enabled" type="checkbox" defaultChecked={settings.is_enabled !== false} disabled={!canEdit} />
                <span>Enable biometric middleware</span>
              </label>
              <label>Host PC address
                <input className="field" name="host_pc_address" required defaultValue={settings.host_pc_address ?? "bio.dropxlogistics.com"} disabled={!canEdit} />
              </label>
              <label>Host PC port
                <input className="field" inputMode="numeric" name="host_pc_port" required defaultValue={settings.host_pc_port ?? 6010} disabled={!canEdit} />
              </label>
              <label>Biometric enrolment start number
                <input className="field" inputMode="numeric" name="enrolment_start_number" required defaultValue={settings.enrolment_start_number ?? 1} disabled={!canEdit} />
              </label>
              <label>Event transfer mode
                <SearchableSelect
                  name="event_transfer_mode"
                  options={[{ value: "TCP/IP", label: "TCP/IP" }]}
                  defaultValue={settings.event_transfer_mode ?? "TCP/IP"}
                  placeholder="Select mode"
                  required
                  disabled={!canEdit}
                />
              </label>
              <label>Communication password
                <SearchableSelect
                  name="communication_password_enabled"
                  options={[{ value: "false", label: "No / blank" }, { value: "true", label: "Yes" }]}
                  defaultValue={String(Boolean(settings.communication_password_enabled))}
                  placeholder="Select"
                  required
                  disabled={!canEdit}
                />
              </label>
              <label>Communication password value
                <input className="field" name="communication_password" placeholder="Keep blank when password is No" defaultValue={settings.communication_password ?? ""} disabled={!canEdit} />
              </label>
              <label>Middleware server IP
                <input className="field" name="middleware_server_ip" placeholder="Optional fallback IP" defaultValue={settings.middleware_server_ip ?? ""} disabled={!canEdit} />
              </label>
              <label className="span-2">Webhook URL
                <input className="field" name="webhook_url" defaultValue={settings.webhook_url ?? "https://dashboard.dropxlogistics.com/api/biometric/punch"} disabled={!canEdit} />
              </label>
              <label className="span-2">Notes
                <textarea className="field textarea" name="notes" placeholder="Internal setup notes" defaultValue={settings.notes ?? ""} disabled={!canEdit} />
              </label>
              <div className="form-actions span-2 align-right">
                <SubmitButton disabled={!canEdit} disabledText="View only">Save settings</SubmitButton>
              </div>
            </form>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Physical device setup</h2>
                <p className="subtle">Copy these values into the device communication window.</p>
              </div>
            </div>
            <div className="device-config-card">
              <dl>
                <div>
                  <dt>Host PC Addr</dt>
                  <dd>{settings.host_pc_address ?? "bio.dropxlogistics.com"}</dd>
                </div>
                <div>
                  <dt>Host PC Port</dt>
                  <dd>{settings.host_pc_port ?? 6010}</dd>
                </div>
                <div>
                  <dt>Event Transfer Mode</dt>
                  <dd>{settings.event_transfer_mode ?? "TCP/IP"}</dd>
                </div>
                <div>
                  <dt>Next enrolment series</dt>
                  <dd>Starts from {settings.enrolment_start_number ?? 1}</dd>
                </div>
                <div>
                  <dt>Communication Password</dt>
                  <dd>{communicationPasswordLabel}</dd>
                </div>
                <div>
                  <dt>Webhook receiver</dt>
                  <dd>{settings.webhook_url ?? "https://dashboard.dropxlogistics.com/api/biometric/punch"}</dd>
                </div>
              </dl>
            </div>
            <p className="form-note">
              Device Master is only for adding/removing terminals and monitoring live status. Use this page only when the common middleware endpoint changes.
            </p>
          </section>
        </section>
      ) : null}
    </AppShell>
  );
}
