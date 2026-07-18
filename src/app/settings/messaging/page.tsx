import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { MessagingSettingsPanel } from "@/components/messaging-settings-panel";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

function loadFlash() {
  const raw = cookies().get("dropx_messaging_settings_flash")?.value;
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

async function loadMessagingSettings(companyId: string) {
  const defaults = {
    settings: { webhook_verify_token: "" },
    metaStatus: { isEnabled: false, isConfigured: false },
    error: null as string | null
  };
  if (!supabaseAdmin) return { ...defaults, error: "Supabase service role key is not configured." };

  const [metaSettings, whatsAppSettings, whatsAppProfiles] = await Promise.all([
    supabaseAdmin
      .from("meta_messaging_settings")
      .select("is_facebook_enabled, is_instagram_enabled, meta_app_id, page_access_token_secret_id")
      .eq("company_id", companyId)
      .eq("id", true)
      .maybeSingle(),
    supabaseAdmin
      .from("whatsapp_settings")
      .select("is_enabled")
      .eq("company_id", companyId)
      .eq("id", true)
      .maybeSingle(),
    supabaseAdmin
      .from("whatsapp_profiles")
      .select("business_account_id, phone_number_id, token_secret_id")
      .eq("company_id", companyId)
      .eq("is_active", true)
  ]);

  const error = metaSettings.error?.message || whatsAppSettings.error?.message || whatsAppProfiles.error?.message || null;
  const whatsAppConfigured = (whatsAppProfiles.data ?? []).some((profile) => profile.business_account_id && profile.phone_number_id && profile.token_secret_id);
  const metaConfigured = Boolean(metaSettings.data?.meta_app_id && metaSettings.data?.page_access_token_secret_id);

  return {
    settings: { webhook_verify_token: "" },
    metaStatus: {
      isEnabled: Boolean(whatsAppSettings.data?.is_enabled || metaSettings.data?.is_facebook_enabled || metaSettings.data?.is_instagram_enabled),
      isConfigured: Boolean(whatsAppConfigured || metaConfigured)
    },
    error
  };
}

export default async function MessagingSettingsPage() {
  const authorization = await requirePagePermission("app_settings", "access");
  const companyId = requireCompanyId(authorization);
  const permission = authorization.permissions.app_settings;
  const data = await loadMessagingSettings(companyId);
  const flash = loadFlash();

  return (
    <AppShell active="Settings" pageCode="app_settings">
      <PageHead
        eyebrow="Configuration"
        title="Messaging"
        subtitle="Shared messaging settings and platform-specific messaging configuration."
        action={<a className="button secondary" href="/settings">Back</a>}
      />
      {data.error ? (
        <section className="panel message-panel error">
          <div className="panel-body">
            <strong>Messaging database setup needed</strong>
            <p className="subtle" style={{ marginTop: 6 }}>{data.error}</p>
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
        <MessagingSettingsPanel
          canEdit={permission.canEdit || permission.canAdd}
          metaStatus={data.metaStatus}
        />
      ) : null}
    </AppShell>
  );
}
